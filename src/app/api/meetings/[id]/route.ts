import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById, deleteMeeting, updateMeeting, createActionItem, getAllActionItems } from '@/storage';
import { getAppPool, deleteOATasksByMeetingId } from '@/lib/oa-task-push';
import { deleteActionItemsByMeetingId, updateActionItem, getActionItemByMeetingAndOriginalId } from '@/storage/database/action-storage';
import { resolveActionOwnerIdentity, resolveDeptByName } from '@/lib/action-owner';
import { getTraceFromRequest } from '@/lib/trace';
import * as sql from 'mssql';

// 同步行动项到数据库（插入新的、更新已有的；删除仅显式允许时执行，且为软取消）
async function syncActionItemsToDatabase(meetingId: string, actionItems: any[], opts?: { allowRemove?: boolean }) {
  // 获取数据库中现有的行动项
  const existingItems = await getAllActionItems({ meetingId });
  const existingMap = new Map(existingItems.map(item => [item.originalId || item.id, item]));

  // 记录哪些行动项在新列表中
  const currentIds = new Set<string>();

  // ── 补全部门信息：会议生成时只填了责任人/提出人姓名，这里按姓名反查部门 ──
  // 收集所有 owner / proposer 姓名，统一反查部门，避免重复请求
  const nameDeptCache = new Map<string, string | null>();
  const namesToResolve = new Set<string>();
  for (const item of actionItems) {
    const ownerName = (item.owner || item.assignee || '').trim();
    const proposerName = (item.proposer || '').trim();
    if (ownerName && !item.dept) namesToResolve.add(ownerName);
    if (proposerName && !item.proposerDept) namesToResolve.add(proposerName);
  }
  await Promise.all([...namesToResolve].map(async (name) => {
    const dept = await resolveDeptByName(name);
    nameDeptCache.set(name, dept);
  }));
  // 对每条 item 补全 owner 部门；proposer 部门在落库时填入
  for (const item of actionItems) {
    if (!item.dept) {
      const ownerName = (item.owner || item.assignee || '').trim();
      if (ownerName && nameDeptCache.has(ownerName)) {
        item.dept = nameDeptCache.get(ownerName);
      }
    }
    if (!item.proposerDept) {
      const proposerName = (item.proposer || '').trim();
      if (proposerName && nameDeptCache.has(proposerName)) {
        item.proposerDept = nameDeptCache.get(proposerName);
      }
    }
  }

  for (const item of actionItems) {
    const originalId = item.id;
    currentIds.add(originalId);

    const existingItem = existingMap.get(originalId);

    if (existingItem) {
      // 更新已有的行动项
      await updateActionItem(existingItem.id, {
        description: item.description || '',
        owner: item.owner || item.assignee || null,
        ownerLoginId: item.ownerLoginId || null,
        ownerOaId: item.ownerOaId || null,
        dept: item.dept || null,
        proposerDept: item.proposerDept || null,
        dueDate: item.dueDate || item.due_date || null,
        dueDateType: item.dueDateType || item.due_date_type || null,
        priority: item.priority || 'medium',
        status: item.status || 'pending',
      });
    } else {
      // 插入新的行动项
      await createActionItem({
        meetingId,
        originalId,
        description: item.description || '',
        owner: item.owner || item.assignee || null,
        ownerLoginId: item.ownerLoginId || null,
        ownerOaId: item.ownerOaId || null,
        dept: item.dept || null,
        proposer: item.proposer || null,
        proposerLoginId: item.proposerLoginId || null,
        proposerOaId: item.proposerOaId || null,
        proposerDept: item.proposerDept || null,
        dueDate: item.dueDate || item.due_date || null,
        dueDateType: item.dueDateType || item.due_date_type || null,
        priority: item.priority || 'medium',
        status: item.status || 'pending',
        sourceText: item.sourceText || null,
        confidenceOwner: item.confidence?.assignee ?? item.confidence_owner ?? null,
        confidenceDate: item.confidence?.dueDate ?? item.confidence_date ?? null,
      });
    }
  }

  // 删除不在新列表中的行动项：改为软取消（与手动删除口径一致，台账留痕可追溯）。
  // 仅显式 allowRemove 时执行；纪要派生/负责人匹配等"部分字段同步"路径绝不删除，
  // 防止误删手动维护的台账行（历史"归档后行动项消失"的根因）。
  if (opts?.allowRemove) {
    for (const existingItem of existingItems) {
      const originalId = existingItem.originalId || existingItem.id;
      if (!currentIds.has(originalId)) {
        try {
          await updateActionItem(existingItem.id, {
            status: 'cancelled',
            completionNote: '同步时不在最新列表中，已自动取消（台账留痕）',
          } as any);
          console.log(`[sync] 软取消行动项: ${existingItem.id} (${originalId})`);
        } catch (e) {
          console.warn(`[sync] 软取消失败: ${existingItem.id}`, e instanceof Error ? e.message : e);
        }
      }
    }
  }

  console.log(`[sync] 同步完成: 当前${actionItems.length}条, 数据库原有${existingItems.length}条`);
}

// 按姓名查 OA loginid：优先企业微信，降级 SQL 链接服务器
async function resolveLoginId(ownerName: string): Promise<string> {
  if (!ownerName) return ownerName;

  // 1. 企业微信通讯录（更准确、不依赖链接服务器）
  try {
    const { resolveUserIdByName } = await import('@/lib/wecom');
    const userid = await resolveUserIdByName(ownerName);
    if (userid) return userid;
  } catch { /* 降级 */ }

  // 2. SQL 链接服务器（兜底）
  try {
    const pool = await getAppPool();
    const linked = process.env.OA_LINKED_SERVER || 'FWsv';
    const oaDb = process.env.OA_DATABASE_NAME || 'ecology';
    // 使用参数化查询防止SQL注入
    const res = await pool.request()
      .input('name', sql.NVarChar, ownerName)
      .query(
        `SELECT TOP 1 loginid FROM [${linked}].[${oaDb}].[dbo].[hrmresource] WHERE lastname = @name AND status = 1`
      );
    if (res.recordset[0]?.loginid) return res.recordset[0].loginid;
  } catch { /* 最终兜底 */ }

  return ownerName;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = getTraceFromRequest(request, 'mtg');
  const log = (step: string, extra: Record<string, unknown> = {}) => {
    console.log('[share-trace]', JSON.stringify({ traceId, step, ...extra }));
  };
  try {
    const { id: meetingId } = await params;
    const isShared = request.nextUrl.searchParams.get('shared') === 'true';
    log('meeting.detail.start', { meetingId, isShared });

    const [meetingResult, actionItemsResult] = await Promise.allSettled([
      getMeetingById(meetingId),
      getAllActionItems({ meetingId }),
    ]);

    if (meetingResult.status === 'rejected') {
      throw meetingResult.reason;
    }

    const meeting = meetingResult.value;

    if (!meeting) {
      return NextResponse.json(
        { success: false, error: 'Meeting not found' },
        { status: 404 }
      );
    }

    // 权限控制：只允许参会人员和主持人查看
    // 可通过环境变量 DISABLE_MEETING_ACCESS_CONTROL=true 临时关闭
    const accessControlDisabled = process.env.DISABLE_MEETING_ACCESS_CONTROL === 'true';

    // 分享链接走企业微信 OAuth 登录后，session 一样是真实用户，
    // 仍然要走下面这套参与人校验，否则任意登录用户都能看任意会议。
    if (accessControlDisabled) {
      log('meeting.detail.access-control.disabled');
    } else {
      const currentUserEncoded = request.headers.get('x-user-name'); // 从middleware设置的header获取当前用户
      const currentUser = currentUserEncoded ? decodeURIComponent(currentUserEncoded) : null;
      const currentLoginId = request.headers.get('x-user-loginid') || '';

      log('meeting.detail.access-check', { currentUser, currentLoginId });

      if (currentUser) {
        const organizer = (meeting as any).organizer;
        const participants = (meeting as any).participants || [];

        log('meeting.detail.participants', { organizer, participants });

        // 标准化姓名（去除空格和特殊字符）
        const normalizedCurrentUser = currentUser.trim();
        const normalizedOrganizer = organizer?.trim();
        const normalizedParticipants = participants.map((p: string) => p?.trim()).filter(Boolean);

        // 检查是否是主持人或参会人员
        const isOrganizer = normalizedOrganizer && normalizedCurrentUser === normalizedOrganizer;
        const isParticipant = normalizedParticipants.includes(normalizedCurrentUser);

        log('meeting.detail.access-result', { isOrganizer, isParticipant });

        if (!isOrganizer && !isParticipant) {
          log('meeting.detail.forbidden', { currentUser });
          return NextResponse.json(
            { success: false, error: '无权访问此会议', code: 'FORBIDDEN' },
            { status: 403 }
          );
        }

        log('meeting.detail.access.ok', { role: isOrganizer ? 'organizer' : 'participant' });
      } else {
        log('meeting.detail.no-user-info', { isShared });
      }
    }

    let dbActionItems: Awaited<ReturnType<typeof getAllActionItems>> = [];
    if (actionItemsResult.status === 'fulfilled') {
      dbActionItems = actionItemsResult.value;
    } else {
      const error = actionItemsResult.reason;
      const message = error instanceof Error ? error.message : String(error);
      if ((error as any)?.code !== 'ETIMEOUT' && !/Failed to connect|ConnectionError|connect timeout/i.test(message)) {
        throw error;
      }
      console.warn('[meeting detail] 行动项数据库不可用，降级使用会议内 actionItems:', message);
    }
    const dbById = new Map(dbActionItems.map(item => [item.id, item]));
    const dbByOriginalId = new Map(
      dbActionItems
        .filter(item => item.originalId)
        .map(item => [item.originalId as string, item])
    );

    const mergeItem = (legacy: any | null, dbItem: typeof dbActionItems[number] | null) => {
      const description = dbItem?.description ?? legacy?.description ?? '';
      const owner = dbItem?.owner ?? legacy?.assignee ?? legacy?.owner ?? null;
      const ownerLoginId = dbItem?.ownerLoginId ?? legacy?.ownerLoginId ?? null;
      const ownerOaId = dbItem?.ownerOaId ?? legacy?.ownerOaId ?? legacy?.owner_oa_id ?? null;
      const dept = dbItem?.dept ?? legacy?.dept ?? null;
      const proposer = dbItem?.proposer ?? legacy?.proposer ?? null;
      const proposerLoginId = dbItem?.proposerLoginId ?? legacy?.proposerLoginId ?? null;
      const proposerOaId = dbItem?.proposerOaId ?? legacy?.proposerOaId ?? null;
      const proposerDept = dbItem?.proposerDept ?? legacy?.proposerDept ?? legacy?.proposer_dept ?? null;
      const dueDate = dbItem?.dueDate ?? legacy?.dueDate ?? legacy?.due_date ?? null;
      const dueDateType = dbItem?.dueDateType ?? legacy?.dueDateType ?? legacy?.due_date_type ?? (dueDate ? 'date' : 'tbd');
      // 数据自愈：有日期但被误标为 tbd 的，按 date 处理（历史新增对话框缺陷遗留）
      const effectiveDueDateType = dueDate && dueDateType === 'tbd' ? 'date' : dueDateType;
      const priority = dbItem?.priority ?? legacy?.priority ?? 'medium';
      const status = dbItem?.status ?? legacy?.status ?? 'pending';
      const confidenceOwner =
        dbItem?.confidenceOwner ?? legacy?.confidence?.assignee ?? legacy?.confidence_owner ?? null;
      const confidenceDate =
        dbItem?.confidenceDate ?? legacy?.confidence?.dueDate ?? legacy?.confidence_date ?? null;
      const sourceText = dbItem?.sourceText ?? legacy?.sourceText ?? legacy?.source_sentence ?? null;
      const initialResult = dbItem?.initialResult ?? legacy?.initialResult ?? legacy?.initial_result ?? null;

      const originalId = dbItem?.originalId ?? legacy?.id ?? null;
      const id = legacy?.id ?? dbItem?.originalId ?? dbItem?.id ?? originalId ?? '';

      return {
        id,
        dbId: dbItem?.id ?? null,
        originalId,
        description,
        assignee: owner,
        owner,
        ownerLoginId,
        ownerOaId,
        dept,
        proposer,
        proposerLoginId,
        proposerOaId,
        proposerDept,
        dueDate,
        due_date: dueDate,
        due_date_type: effectiveDueDateType,
        priority,
        status,
        confidence: {
          assignee: confidenceOwner,
          dueDate: confidenceDate,
        },
        confidence_owner: confidenceOwner ?? undefined,
        confidence_date: confidenceDate ?? undefined,
        sourceText,
        source_sentence: sourceText,
        initialResult,
        initial_result: initialResult,
        confirmed_by: dbItem?.confirmedBy ?? legacy?.confirmed_by ?? null,
        confirmed_at: dbItem?.confirmedAt ?? legacy?.confirmed_at ?? null,
        completed_by: dbItem?.completedBy ?? legacy?.completed_by ?? null,
        completed_at: dbItem?.completedAt ?? legacy?.completed_at ?? null,
        completion_note: dbItem?.completionNote ?? legacy?.completion_note ?? null,
        evidence_files: dbItem?.evidenceFiles ?? legacy?.evidence_files ?? [],
        block_reason: dbItem?.blockReason ?? legacy?.block_reason ?? null,
        blocked_by: dbItem?.blockedBy ?? legacy?.blocked_by ?? null,
        blocked_at: dbItem?.blockedAt ?? legacy?.blocked_at ?? null,
        oa_result: dbItem?.oaResult ?? legacy?.oa_result ?? null,
        oa_result_at: dbItem?.oaResultAt ?? legacy?.oa_result_at ?? null,
        oa_score: dbItem?.oaScore ?? legacy?.oa_score ?? null,
        oa_auto_detected: dbItem?.oaAutoDetected ?? legacy?.oa_auto_detected ?? null,
        oa_attachments: dbItem?.oaAttachments ?? legacy?.oa_attachments ?? [],
        created_at: dbItem?.createdAt ?? legacy?.created_at ?? null,
        updated_at: dbItem?.updatedAt ?? legacy?.updated_at ?? null,
      };
    };

    const legacyItems = Array.isArray(meeting.actionItems) ? meeting.actionItems : [];
    const merged: any[] = [];

    // 并集合并：台账为主（cancelled 已被存储层过滤，已删项不会复活），
    // JSON 独有项（历史双写分歧遗留）补入，保证加载即可见；首次编辑时惰性回填台账
    for (const dbItem of dbActionItems) {
      // 尝试找到对应的legacy数据用于补充字段
      const legacy = legacyItems.find(item =>
        item.id === dbItem.originalId || item.id === dbItem.id
      );
      merged.push(mergeItem(legacy ?? null, dbItem));
    }
    const matchedJsonIds = new Set<string>(
      dbActionItems.flatMap(dbItem => [dbItem.originalId, dbItem.id].filter(Boolean) as string[])
    );
    let unionBackfilled = 0;
    for (const legacy of legacyItems) {
      if (!legacy || !legacy.id || matchedJsonIds.has(legacy.id)) continue;
      unionBackfilled++;
      merged.push(mergeItem(legacy, null));
    }
    if (unionBackfilled > 0) {
      console.log(`[GET merge] meeting=${meetingId} 补入 ${unionBackfilled} 条 JSON 独有行动项（首次编辑时回填台账）`);
    }

    return NextResponse.json({
      success: true,
      data: {
        meeting,
        summary: meeting?.summary || null,
        actionItems: merged,
      },
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;
    const body = await request.json();

    // 特殊语义：addActionItem → 追加行动项 + 同步推送 OA
    if (body.addActionItem) {
      const current = await getMeetingById(meetingId);
      if (!current) {
        return NextResponse.json({ success: false, error: 'Meeting not found' }, { status: 404 });
      }
      const input = body.addActionItem;
      // 客户端临时 id 作为 originalId：前端行 key 保持稳定，后续 PUT/DELETE 均可通过它定位台账行
      const originalId: string = (typeof input.id === 'string' && input.id.trim()) || `rd-${Date.now()}`;
      const hasOwn = (k: string) => (input as any)[k] !== undefined;

      // 责任人身份：仅在传入责任人相关字段时解析，避免用 null 覆盖既有值
      let resolvedOwner: any = null;
      if (hasOwn('owner') || hasOwn('assignee') || hasOwn('ownerLoginId') || hasOwn('ownerOaId') || hasOwn('dept')) {
        resolvedOwner = await resolveActionOwnerIdentity({
          owner: input.assignee || input.owner || null,
          ownerLoginId: input.ownerLoginId || null,
          ownerOaId: input.ownerOaId || null,
          dept: input.dept || null,
        });
      }

      const dueDateVal = (input as any).due_date !== undefined ? (input as any).due_date : (input as any).dueDate;
      const dueTypeVal = (input as any).due_date_type !== undefined ? (input as any).due_date_type : (input as any).dueDateType;

      const newItem: any = {
        ...input,
        id: originalId,
        created_at: new Date().toISOString(),
      };
      if (resolvedOwner) {
        newItem.assignee = resolvedOwner.owner || input.assignee || input.owner || null;
        newItem.owner = resolvedOwner.owner || input.owner || input.assignee || null;
        newItem.ownerLoginId = resolvedOwner.ownerLoginId;
        newItem.ownerOaId = resolvedOwner.ownerOaId;
        newItem.dept = resolvedOwner.dept || input.dept || null;
      }

      try {
        // 1. 台账（主数据源）：按 originalId 幂等 upsert。
        //    - 不存在 → 新建
        //    - 已存在 → 更新（修复：此前命中已存在直接跳过，导致"新增"项后续行内编辑
        //      (类型/日期/责任人/优先级)只堆在会议 JSON、永远写不进台账）
        //    更新时不写 status / confidence / 稽核类字段：前端对新增项每次都强塞
        //    status='confirmed'，无脑写入会把已流转为 done/blocked 的项打回。
        const existed = await getActionItemByMeetingAndOriginalId(meetingId, originalId);
        let dbItem: Awaited<ReturnType<typeof createActionItem>>;
        if (existed) {
          const patch: Record<string, any> = {};
          if (input.description !== undefined) patch.description = input.description || '';
          if (resolvedOwner) {
            patch.owner = newItem.owner;
            patch.ownerLoginId = newItem.ownerLoginId;
            patch.ownerOaId = newItem.ownerOaId;
            patch.dept = newItem.dept;
          }
          if (hasOwn('proposer')) patch.proposer = String(input.proposer || '').trim() || null;
          if (hasOwn('proposerLoginId')) patch.proposerLoginId = String(input.proposerLoginId || '').trim() || null;
          if (hasOwn('proposerOaId')) patch.proposerOaId = String(input.proposerOaId || '').trim() || null;
          if (hasOwn('proposerDept') || hasOwn('proposer_dept')) patch.proposerDept = String(input.proposerDept || input.proposer_dept || '').trim() || null;
          if (dueDateVal !== undefined) patch.dueDate = dueDateVal || null;
          if (dueTypeVal !== undefined) patch.dueDateType = dueTypeVal || null;
          // 日期/类型一致性：填了日期而类型仍是空/tbd → 按 date（与 PUT 口径一致）
          const effDate = patch.dueDate !== undefined ? patch.dueDate : existed.dueDate;
          const effType = patch.dueDateType !== undefined ? patch.dueDateType : existed.dueDateType;
          if (effDate && String(effDate).trim() && (!effType || effType === 'tbd')) {
            patch.dueDateType = 'date';
            newItem.due_date_type = 'date';
            newItem.dueDateType = 'date';
          }
          if (input.priority !== undefined) patch.priority = input.priority || 'medium';
          if (hasOwn('sourceText') || hasOwn('source_sentence')) patch.sourceText = input.sourceText || input.source_sentence || null;
          if (hasOwn('reassigned_from')) patch.reassignedFrom = input.reassigned_from || null;

          const row = await updateActionItem(existed.id, patch as any);
          dbItem = (row ?? existed) as Awaited<ReturnType<typeof createActionItem>>;
          console.log(`[PATCH addActionItem] 已存在，更新台账 ${existed.id} (${originalId})`);
        } else {
          dbItem = await createActionItem({
            meetingId,
            originalId,
            description: newItem.description || '',
            owner: resolvedOwner?.owner || input.owner || input.assignee || null,
            ownerLoginId: resolvedOwner?.ownerLoginId || input.ownerLoginId || null,
            ownerOaId: resolvedOwner?.ownerOaId || input.ownerOaId || null,
            dept: resolvedOwner?.dept || input.dept || null,
            // 提出/责任人姓名 trim：手输易带首尾空格，导致部门精确匹配失败
            proposer: ((input as any).proposer || '').trim() || null,
            proposerLoginId: ((input as any).proposerLoginId || '').trim() || null,
            proposerOaId: ((input as any).proposerOaId || '').trim() || null,
            proposerDept: ((input as any).proposerDept || '').trim() || null,
            dueDate: newItem.dueDate || newItem.due_date || null,
            // 类型兜底：未显式指定时按有无日期判定（防新增项先算出 tbd 后填日期被固化）
            dueDateType: dueTypeVal || (newItem.dueDate || newItem.due_date ? 'date' : 'tbd'),
            priority: newItem.priority || 'medium',
            status: input.status || 'confirmed',
            sourceText: newItem.sourceText || (input as any).source_sentence || null,
            confidenceOwner: (newItem as any).confidence?.assignee ?? (newItem as any).confidence_owner ?? null,
            confidenceDate: (newItem as any).confidence?.dueDate ?? (newItem as any).confidence_date ?? null,
            reassignedFrom: (input as any).reassigned_from || null,
          } as any);
        }

        // 2. 台账成功后再写会议 JSON：失败仅告警不回滚（GET 以台账为主并集，不影响展示）
        //    按 id 合并去重：命中同 id 就地替换，不再无脑追加（历史堆叠同一 id 多份副本，
        //    会导致下次"保存纪要"派生时匹配到旧副本、把类型刷回 tbd）
        let updated: any = current;
        try {
          const rawItems: any[] = Array.isArray(current.actionItems) ? [...current.actionItems] : [];
          const at = rawItems.findIndex((it: any) => it && String(it.id) === originalId);
          if (at >= 0) rawItems[at] = { ...rawItems[at], ...newItem };
          else rawItems.push(newItem);
          const byId = new Map<string, any>();
          for (const it of rawItems) {
            if (!it || it.id === undefined || it.id === null) continue;
            const key = String(it.id);
            const prev = byId.get(key);
            if (prev) {
              const merged: any = { ...prev };
              for (const [k, v] of Object.entries(it)) {
                if (v !== undefined && v !== null) merged[k] = v;
              }
              byId.set(key, merged);
            } else {
              byId.set(key, it);
            }
          }
          const deduped = Array.from(byId.values());
          if (deduped.length !== rawItems.length) {
            console.log(`[PATCH addActionItem] 会议 JSON 去重: ${rawItems.length} → ${deduped.length}`);
          }
          updated = await updateMeeting(meetingId, { actionItems: deduped });
        } catch (e) {
          console.warn('[PATCH addActionItem] 会议 JSON 更新失败（台账已写入，不影响展示）:', e instanceof Error ? e.message : e);
        }

        // 2.1 若为重新派发：给原 X 项写入反向关联（reassigned_to），与独立任务重派口径一致
        if ((input as any).reassigned_from) {
          try {
            await updateActionItem((input as any).reassigned_from, { reassignedTo: dbItem.id } as any);
          } catch (e) {
            console.warn('[PATCH addActionItem] 写回原项 reassigned_to 失败:', e instanceof Error ? e.message : e);
          }
        }

        // 3. 推送到 OA（仅已归档会议才推送）
        let oaPushResult: { pushed: number; failed: number; errors: string[] } = { pushed: 0, failed: 0, errors: [] };
        if (current.status === 'locked') {
          try {
            const { pushMeetingTasksToOA } = await import('@/lib/oa-task-push');
            const ownerLoginId = newItem.ownerLoginId || await resolveLoginId(newItem.owner || '');
            oaPushResult = await pushMeetingTasksToOA({
              id: meetingId,
              title: (current as any).title || '',
              meetingDate: (current as any).meeting_date || (current as any).meetingDate || '',
              actionItems: [{
                ...newItem,
                ownerLoginId,
                owner: newItem.owner || '',
                proposer: (newItem as any).proposer || (current as any).defaultProposer || null,
                proposerLoginId: (newItem as any).proposerLoginId || (current as any).defaultProposerLoginId || null,
                proposerOaId: (newItem as any).proposerOaId || (current as any).defaultProposerOaId || null,
              }],
            });
            console.log('[PATCH addActionItem] OA 推送结果:', oaPushResult);
          } catch (e) {
            console.error('[PATCH addActionItem] OA 推送失败:', (e as Error).message);
            oaPushResult.errors.push((e as Error).message);
            // OA推送失败不回滚数据库，但返回错误信息
          }
        }

        // createdAction：单条返回，前端只替换对应临时行（不整表替换，防行重挂载/焦点丢失）
        return NextResponse.json({ success: true, data: updated, createdAction: dbItem, oaPush: oaPushResult });
      } catch (error) {
        console.error('[PATCH addActionItem] 台账写入失败:', error);
        return NextResponse.json(
          { success: false, error: error instanceof Error ? error.message : '添加行动项失败' },
          { status: 500 }
        );
      }
    }

    // 乐观锁：纪要保存携带 base_updated_at 与服务端不一致 → 409 让前端确认后决定是否覆盖
    if (body.base_updated_at && body.minutes) {
      const cur = await getMeetingById(meetingId);
      const curUpdatedAt = (cur as any)?.updatedAt ?? (cur as any)?.updated_at;
      if (cur && curUpdatedAt && curUpdatedAt !== body.base_updated_at) {
        return NextResponse.json(
          { success: false, conflict: true, error: '会议已被他人修改，请确认后再保存', current_updated_at: curUpdatedAt },
          { status: 409 }
        );
      }
    }
    delete body.base_updated_at;

    // 如果更新了纪要，自动派生摘要和行动项（手动项永不丢失：匹配的合并、手动项保留、纯派生零编辑项随表格移除）
    let derivedData: { summary?: any; actionItems?: any[] } = {};
    if (body.minutes) {
      const { deriveSummary, deriveActionItems } = await import('@/lib/minutes-derive');
      const summary = deriveSummary(body.minutes);
      const fresh = deriveActionItems(body.minutes);

      const current = await getMeetingById(meetingId);
      const dbRows = await getAllActionItems({ meetingId }).catch(() => [] as Awaited<ReturnType<typeof getAllActionItems>>);

      // 现有项 = 会议 JSON ∪ 台账（台账独有行也参与保留判定，防止"台账有、JSON 无"的项在保存纪要后被清掉）
      const existing: any[] = [...(current?.actionItems || [])];
      const knownIds = new Set(existing.map((e: any) => String(e.id)));
      for (const row of dbRows) {
        const key = String(row.originalId || row.id);
        if (!knownIds.has(key)) {
          knownIds.add(key);
          existing.push({
            id: key,
            description: row.description,
            owner: row.owner, assignee: row.owner,
            ownerLoginId: row.ownerLoginId, ownerOaId: row.ownerOaId, dept: row.dept,
            proposer: row.proposer, proposerLoginId: row.proposerLoginId, proposerOaId: row.proposerOaId,
            due_date: row.dueDate, dueDate: row.dueDate,
            due_date_type: row.dueDateType, dueDateType: row.dueDateType,
            priority: row.priority, status: row.status,
            confirmed_by: row.confirmedBy, completed_by: row.completedBy,
            oa_result: row.oaResult, oa_score: row.oaScore,
          });
        }
      }

      // 派生时保留的手动维护字段（派生值不覆盖手动值）
      const PRESERVE = ['due_date_type', 'dueDateType', 'status', 'ownerLoginId', 'ownerOaId', 'dept',
        'proposer', 'proposerLoginId', 'proposerOaId', 'proposerDept', 'proposer_dept', 'priority',
        'oa_result', 'oa_result_at', 'oa_score', 'oa_auto_detected', 'confirmed_by', 'confirmed_at',
        'completed_by', 'completed_at', 'completion_note', 'evidence_files',
        'block_reason', 'blocked_by', 'blocked_at'];

      // 判定"被手动维护过"：任一手动字段有值，或状态流转过（派生默认 pending/medium/无负责人）
      const isManuallyTouched = (it: any) => Boolean(
        it.owner || it.assignee || it.ownerLoginId || it.ownerOaId ||
        it.proposer || it.proposerLoginId || it.proposerOaId ||
        it.due_date || it.dueDate ||
        (it.priority && it.priority !== 'medium') ||
        (it.status && it.status !== 'pending') ||
        it.oa_result != null || it.oa_score != null ||
        it.confirmed_by || it.completed_by || it.block_reason || it.blocked_by
      );

      const consumed = new Set<string>();
      const actionItems: any[] = fresh.map((item: any) => {
        // 匹配顺序：① 描述前30字（覆盖表格重排/删行后 action-N 重编号）② id 精确相等（覆盖改了行文字的派生行）。
        // 不做按序号兜底——会把手动项错配给表格行，导致手动项被"吞并"后消失（历史 bug 变体）
        let match = existing.find((e: any) => !consumed.has(String(e.id)) &&
          e.description && item.description &&
          e.description.slice(0, 30) === item.description.slice(0, 30));
        if (!match) {
          match = existing.find((e: any) => !consumed.has(String(e.id)) && String(e.id) === String(item.id));
        }
        if (!match) return item;
        consumed.add(String(match.id));
        // 沿用现有项 id（= 台账 originalId），保证保存纪要后行动项 id/React key 稳定
        const merged: any = { ...item, id: match.id };
        for (const k of PRESERVE) {
          if (match[k] !== undefined && match[k] !== null) merged[k] = match[k];
        }
        // 表格为空的责任人/日期/描述：保留现有手动值（表格有值则以表格为准）
        if (!merged.owner && !merged.assignee) {
          if (match.owner) { merged.owner = match.owner; merged.assignee = match.owner; }
          else if (match.assignee) { merged.owner = match.assignee; merged.assignee = match.assignee; }
        }
        if (!merged.dueDate && !merged.due_date && (match.dueDate || match.due_date)) {
          merged.dueDate = match.dueDate || match.due_date;
          merged.due_date = merged.dueDate;
        }
        if (!merged.description && match.description) merged.description = match.description;
        return merged;
      });

      // 未匹配的现有项：手动维护过的一律保留；纯派生（action-N）且零编辑的视为"已从表格移除"→ 软取消台账行
      let removedCount = 0, keptCount = 0;
      for (const e of existing) {
        if (consumed.has(String(e.id))) continue;
        if (isManuallyTouched(e) || !/^action-\d+$/.test(String(e.id))) {
          actionItems.push(e);
          keptCount++;
        } else {
          removedCount++;
          const row = dbRows.find((r: any) => String(r.originalId || r.id) === String(e.id));
          if (row) {
            try {
              await updateActionItem(row.id, {
                status: 'cancelled',
                completionNote: '纪要表格已移除该派生项，自动取消（台账留痕）',
              } as any);
            } catch (err) {
              console.warn(`[PATCH minutes] 软取消失败 action=${e.id}:`, err instanceof Error ? err.message : err);
            }
          }
        }
      }

      body.summary = summary;
      body.actionItems = actionItems;
      derivedData = { summary, actionItems };
      console.log(`[PATCH] Minutes updated → 派生${fresh.length}条，保留手动项${keptCount}条，随表格移除${removedCount}条`);
    }

    const updated = await updateMeeting(meetingId, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Meeting not found' }, { status: 404 });
    }

    // 同步行动项到数据库（如果有更新）
    if (body.actionItems) {
      try {
        await syncActionItemsToDatabase(meetingId, body.actionItems);
      } catch (error) {
        console.error('[PATCH] 同步行动项到数据库失败:', error);
        // 不阻塞主流程，只记录错误
      }
    }

    return NextResponse.json({ success: true, data: updated, derived: derivedData });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;

    const deleted = await deleteMeeting(meetingId);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Meeting not found' },
        { status: 404 }
      );
    }

    // 等待清理操作完成，确保数据一致性
    const [actionCleanResult, oaCleanResult] = await Promise.allSettled([
      deleteActionItemsByMeetingId(meetingId),
      deleteOATasksByMeetingId(meetingId),
    ]);

    // 记录清理结果
    if (actionCleanResult.status === 'fulfilled') {
      console.log(`[delete] 已清理 ${actionCleanResult.value} 条 hyzs_action_items for meeting=${meetingId}`);
    } else {
      console.error('[delete] 清理action_items失败:', actionCleanResult.reason);
    }

    if (oaCleanResult.status === 'rejected') {
      console.error('[delete] 清理OA行动项失败:', oaCleanResult.reason);
    }

    // 如果关键清理失败，返回警告
    if (actionCleanResult.status === 'rejected') {
      return NextResponse.json({
        success: true,
        warning: '会议已删除，但清理关联数据时出现错误，请联系管理员',
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
