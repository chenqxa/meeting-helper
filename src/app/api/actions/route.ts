import { NextRequest, NextResponse } from 'next/server';
import { getAllActionItems, createActionItem, updateActionItem } from '@/storage/database/action-storage';
import { getCurrentUser } from '@/lib/session';
import { resolveRole } from '@/lib/roles';
import { resolveActionOwnerIdentity, resolveDeptByName } from '@/lib/action-owner';
import { logOperation } from '@/lib/operation-log';
import { pushTasksToOA } from '@/lib/oa-task-push';
import { guardWrite } from '@/lib/api-guard';
import * as sql from 'mssql';
import { getPool } from '@/storage/database/sqlserver-storage';

// POST /api/actions - 创建一条独立行动项（重新派发/手动新增，无会议关联）
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;

    const body = await request.json();
    if (!body.description?.trim()) {
      return NextResponse.json({ success: false, error: '缺少任务内容' }, { status: 400 });
    }

    const resolved = await resolveActionOwnerIdentity({
      owner: body.owner || null,
      ownerLoginId: body.ownerLoginId || null,
      dept: body.dept || null,
    });

    const item = await createActionItem({
      meetingId: null,
      description: body.description.trim(),
      owner: resolved.owner || body.owner || null,
      ownerLoginId: resolved.ownerLoginId || null,
      ownerOaId: resolved.ownerOaId || null,
      dept: resolved.dept || body.dept || null,
      dueDate: body.due_date || null,
      dueDateType: body.due_date_type || 'date',
      priority: body.priority || 'medium',
      status: 'pending',
      sourceType: 'batch',
      sourceId: null,
      proposer: body.proposer || null,
      proposerDept: body.proposer ? await resolveDeptByName(body.proposer) : null,
      sourceText: body.sourceText || body.category || '手动任务',
      oaScore: body.oa_score ?? null,
      initialResult: null,
      reassignedFrom: body.reassigned_from || null,
    });

    // 若为重新派发，给原 X 项写入反向关联
    if (body.reassigned_from) {
      try {
        await updateActionItem(body.reassigned_from, { reassignedTo: item.id } as any);
      } catch (e) {
        console.warn('[actions POST] 写回原项关联失败:', e instanceof Error ? e.message : e);
      }
    }

    // ── 推送 OA：独立任务（含重新派发的新任务）同步到 OA ──
    // 重新派发时 sourceId 用原任务 id，保证 OA task_id 可关联
    let oaPush: { pushed: number; failed: number; errors: string[] } | null = null;
    try {
      const sourceId = body.reassigned_from || item.id;
      const oaResult = await pushTasksToOA({
        id: sourceId,
        title: '重派行动项',
        date: new Date().toISOString().slice(0, 10),
        actionItems: [{
          id: item.id,
          description: item.description,
          owner: item.owner,
          assignee: item.owner,
          ownerLoginId: item.ownerLoginId,
          dept: item.dept,
          due_date: item.dueDate,
          dueDate: item.dueDate,
          priority: item.priority,
          status: 'pending',
        }],
      });
      oaPush = { pushed: oaResult.pushed, failed: oaResult.failed, errors: oaResult.errors };
    } catch (e) {
      console.warn('[actions POST] 推OA失败（不影响创建）:', e instanceof Error ? e.message : e);
      oaPush = { pushed: 0, failed: 1, errors: [e instanceof Error ? e.message : '推OA失败'] };
    }

    await logOperation({
      action: 'create',
      targetType: 'action_item',
      targetId: item.id,
      summary: `新增独立任务：${(item.description || '').slice(0, 30)}`,
      detail: { description: item.description, owner: item.owner, dueDate: item.dueDate, fromReassign: !!body.from_reassign },
    });

    return NextResponse.json({ success: true, data: item, oaPush });
  } catch (error) {
    console.error('[actions POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '创建失败' },
      { status: 500 }
    );
  }
}

// GET /api/actions - 从 hyzs_action_items 读取，支持 ?project_id= / ?meeting_id= 过滤
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id') || undefined;
    const meetingId = searchParams.get('meeting_id') || undefined;
    const statusFilter = searchParams.get('status') || undefined;

    const user = await getCurrentUser();

    // 权限过滤：允许访问的 meeting_id 集合（用SQL查询优化）
    let allowedMeetingIds: Set<string> | null = null;
    let viewerRole: string | null = null;
    if (user && !projectId) {
      const role = await resolveRole(user.loginid);
      viewerRole = role;
      if (role !== 'admin') {
        const pool = await getPool();
        const dept = user.dept || '';
        const loginid = user.loginid;
        const name = user.name;

        const roleCond = (role === 'manager' || role === 'secretary')
          ? `(department = @dept OR organizer_login_id = @loginid OR organizer = @loginid OR organizer = @name OR participants LIKE @loginidLike OR participants LIKE @nameLike)`
          : `(organizer_login_id = @loginid OR organizer = @loginid OR organizer = @name OR participants LIKE @loginidLike OR participants LIKE @nameLike)`;

        const result = await pool.request()
          .input('dept', sql.NVarChar, dept)
          .input('loginid', sql.NVarChar, loginid)
          .input('name', sql.NVarChar, name)
          .input('loginidLike', sql.NVarChar, '%' + loginid + '%')
          .input('nameLike', sql.NVarChar, '%' + name + '%')
          .query(`SELECT id FROM hyzs_meetings WHERE ${roleCond}`);

        allowedMeetingIds = new Set(result.recordset.map((r: any) => r.id));
      }
    }

    const items = await getAllActionItems({ projectId, meetingId, status: statusFilter });

    // 批量获取会议信息（只获取需要的）
    const meetingIds = [...new Set(items.map(i => i.meetingId).filter(Boolean))];
    const meetingMap: Record<string, { title: string; type: string; meetingDate: string; organizer: string; department?: string; status?: string; createdAt?: string }> = {};
    if (meetingIds.length > 0) {
      const pool = await getPool();
      // 使用参数化查询防止SQL注入
      const placeholders = meetingIds.map((_, i) => `@id${i}`).join(',');
      const req = pool.request();
      meetingIds.forEach((id, i) => req.input(`id${i}`, sql.NVarChar, id as string));
      const result = await req.query(`SELECT id, title, type, meeting_date, organizer, department, status, created_at FROM hyzs_meetings WHERE id IN (${placeholders})`);
      for (const r of result.recordset) {
        if (r.id) {
          meetingMap[r.id] = {
            title: r.title,
            type: r.type || '',
            meetingDate: r.meeting_date || '',
            organizer: r.organizer || '',
            department: r.department || '',
            status: r.status || 'draft',
            // 会议记录创建时刻 ≈ 开完会传纪要，用作持续项"新一周"分界线
            createdAt: r.created_at ? String(r.created_at) : undefined,
          };
        }
      }
    }

    // 批量获取批次信息
    const batchIds = [...new Set(items.map(i => i.sourceType === 'batch' ? i.sourceId : null).filter(Boolean))];
    const batchMap: Record<string, { title: string; createdBy: string; createdAt: string }> = {};
    if (batchIds.length > 0) {
      try {
        const { getAllTaskBatches } = await import('@/storage');
        const batches = await getAllTaskBatches();
        for (const b of batches) {
          if (batchIds.includes(b.id)) {
            batchMap[b.id] = { title: b.title, createdBy: b.createdBy || '', createdAt: b.createdAt };
          }
        }
      } catch { /* batch table may not exist yet */ }
    }

    const filtered = items.filter(item => {
      // 自己相关的任务（责任人=我 或 提出人=我）始终可见——干活的和提事的都要能看到自己的项
      if (user && (item.owner === user.name || item.ownerLoginId === user.loginid)) {
        if (!item.meetingId || meetingMap[item.meetingId]?.status === 'locked') return true;
      }
      if (user && (item.proposer === user.name || item.proposerLoginId === user.loginid)) {
        if (!item.meetingId || meetingMap[item.meetingId]?.status === 'locked') return true;
      }
      if (allowedMeetingIds && item.meetingId && !allowedMeetingIds.has(item.meetingId)) return false;
      if (item.meetingId && meetingMap[item.meetingId]?.status !== 'locked') return false;
      // 批次项权限：admin/manager 可见全部；其他角色只能看自己相关的
      if (!item.meetingId && allowedMeetingIds && user && viewerRole !== 'manager') {
        const isMine = item.owner === user.name || item.ownerLoginId === user.loginid
          || item.proposer === user.name || item.proposerLoginId === user.loginid;
        if (!isMine) return false;
      }
      return true;
    });

    const data = filtered.map(item => {
      const meeting = item.meetingId ? meetingMap[item.meetingId] : null;
      const batch = (!item.meetingId && item.sourceType === 'batch' && item.sourceId) ? batchMap[item.sourceId] : null;
      let effectiveDate = meeting?.meetingDate || item.createdAt?.slice(0, 10) || '';
      return {
        id: item.id,
        description: item.description,
        owner: item.owner,
        ownerLoginId: item.ownerLoginId,
        ownerOaId: item.ownerOaId,
        dept: item.dept,
        proposer: item.proposer,
        proposer_dept: item.proposerDept,
        proposerLoginId: item.proposerLoginId,
        proposerOaId: item.proposerOaId,
        due_date: item.dueDate,
        due_date_type: item.dueDateType || 'date',
        source_type: item.sourceType || null,
        priority: item.priority,
        status: item.status,
        confidence_owner: item.confidenceOwner ?? 0.5,
        confidence_date: item.confidenceDate ?? 0.5,
        source_sentence: item.sourceText || '',
        initial_result: item.initialResult,
        project_id: item.projectId,
        meeting_id: item.meetingId,
        meeting_title: meeting?.title || batch?.title || '',
        meeting_type: meeting?.type
          || (item.sourceType === 'batch' ? (item.sourceText || '手动任务') : '')
          || (item.sourceType === 'gsmalt' ? (item.sourceText || '绩效面谈') : ''),
        meeting_date: effectiveDate,
        meeting_created_at: meeting?.createdAt || null,
        meeting_status: meeting?.status || 'locked',
        meeting_organizer: meeting?.organizer === '褰撳墠鐢ㄦ埛' ? '' : (meeting?.organizer || (item.sourceType === 'batch' ? (item.confirmedBy || batch?.createdBy || '') : batch?.createdBy || '')),
        confirmed_by: item.confirmedBy,
        confirmed_at: item.confirmedAt,
        completed_by: item.completedBy,
        completed_at: item.completedAt,
        completion_note: item.completionNote,
        evidence_files: item.evidenceFiles || [],
        reassigned_from: item.reassignedFrom,
        reassigned_to: item.reassignedTo,
        block_reason: item.blockReason,
        blocked_by: item.blockedBy,
        blocked_at: item.blockedAt,
        oa_result: item.oaResult,
        oa_result_at: item.oaResultAt,
        oa_score: item.oaScore,
        oa_auto_detected: item.oaAutoDetected ?? false,
        oa_attachments: item.oaAttachments || [],
        auto_fetch: item.autoFetch ? 1 : 0,
        auto_fetch_source: item.autoFetchSource || null,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
