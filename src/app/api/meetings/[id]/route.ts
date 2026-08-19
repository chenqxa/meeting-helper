import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById, deleteMeeting, updateMeeting, createActionItem, getAllActionItems } from '@/storage';
import { getAppPool, deleteOATasksByMeetingId } from '@/lib/oa-task-push';
import { deleteActionItemsByMeetingId, updateActionItem } from '@/storage/database/action-storage';
import { resolveActionOwnerIdentity, resolveDeptByName } from '@/lib/action-owner';
import { getTraceFromRequest } from '@/lib/trace';
import * as sql from 'mssql';

// 同步行动项到数据库（插入新的、更新已有的、删除缺失的）
async function syncActionItemsToDatabase(meetingId: string, actionItems: any[]) {
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

  // 删除不在新列表中的行动项（用户删除了）
  for (const existingItem of existingItems) {
    const originalId = existingItem.originalId || existingItem.id;
    if (!currentIds.has(originalId)) {
      const { deleteActionItem } = await import('@/storage/database/action-storage');
      await deleteActionItem(existingItem.id);
      console.log(`[sync] 删除行动项: ${existingItem.id} (${originalId})`);
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
      const dueDate = dbItem?.dueDate ?? legacy?.dueDate ?? legacy?.due_date ?? null;
      const dueDateType = dbItem?.dueDateType ?? legacy?.dueDateType ?? legacy?.due_date_type ?? (dueDate ? 'date' : 'tbd');
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
        dueDate,
        due_date: dueDate,
        due_date_type: dueDateType,
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

    // 如果数据库中有行动项数据，优先使用数据库（尊重用户的删除和修改操作）
    if (dbActionItems.length > 0) {
      // 只显示数据库中存在的行动项
      for (const dbItem of dbActionItems) {
        // 尝试找到对应的legacy数据用于补充字段
        const legacy = legacyItems.find(item =>
          item.id === dbItem.originalId || item.id === dbItem.id
        );
        merged.push(mergeItem(legacy ?? null, dbItem));
      }
    } else {
      // 数据库中没有数据时，使用会议JSON中的数据（兜底）
      for (const legacy of legacyItems) {
        merged.push(mergeItem(legacy, null));
      }
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
      const resolvedOwner = await resolveActionOwnerIdentity({
        owner: body.addActionItem.assignee || body.addActionItem.owner || null,
        ownerLoginId: body.addActionItem.ownerLoginId || null,
        ownerOaId: body.addActionItem.ownerOaId || null,
        dept: body.addActionItem.dept || null,
      });
      const newItem = {
        ...body.addActionItem,
        assignee: resolvedOwner.owner || body.addActionItem.assignee || body.addActionItem.owner || null,
        owner: resolvedOwner.owner || body.addActionItem.owner || body.addActionItem.assignee || null,
        ownerLoginId: resolvedOwner.ownerLoginId,
        ownerOaId: resolvedOwner.ownerOaId,
        dept: resolvedOwner.dept || body.addActionItem.dept || null,
        id: `rd-${Date.now()}`,
        created_at: new Date().toISOString(),
      };

      // 使用事务确保数据一致性
      try {
        const items = [...(current.actionItems || []), newItem];

        // 1. 更新会议表
        const updated = await updateMeeting(meetingId, { actionItems: items });

        // 2. 写入行动项表（必须成功，否则回滚）
        const createdItem = await createActionItem({
          meetingId,
          originalId: newItem.id,
          description: newItem.description || '',
          owner: newItem.assignee || newItem.owner || null,
          ownerLoginId: newItem.ownerLoginId || null,
          ownerOaId: newItem.ownerOaId || null,
          dept: newItem.dept || null,
          proposer: (newItem as any).proposer || null,
          proposerLoginId: (newItem as any).proposerLoginId || null,
          proposerOaId: (newItem as any).proposerOaId || null,
          dueDate: newItem.dueDate || newItem.due_date || null,
          dueDateType: (newItem as any).due_date_type || ((newItem.dueDate || newItem.due_date) ? 'date' : 'tbd'),
          priority: newItem.priority || 'medium',
          status: 'pending',
          sourceText: newItem.sourceText || (newItem as any).source_sentence || null,
          confidenceOwner: newItem.confidence?.assignee ?? newItem.confidence_owner ?? null,
          confidenceDate: newItem.confidence?.dueDate ?? newItem.confidence_date ?? null,
          reassignedFrom: (newItem as any).reassigned_from || null,
        });

        // 2.1 若为重新派发：给原 X 项写入反向关联（reassigned_to），与独立任务重派口径一致
        if ((newItem as any).reassigned_from) {
          try {
            await updateActionItem((newItem as any).reassigned_from, { reassignedTo: createdItem.id } as any);
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

        return NextResponse.json({ success: true, data: updated, oaPush: oaPushResult });
      } catch (error) {
        console.error('[PATCH addActionItem] 操作失败:', error);
        return NextResponse.json(
          { success: false, error: error instanceof Error ? error.message : '添加行动项失败' },
          { status: 500 }
        );
      }
    }

    // 如果更新了纪要，自动派生摘要和行动项（保留已有 due_date、状态等手动字段）
    let derivedData: { summary?: any; actionItems?: any[] } = {};
    if (body.minutes) {
      const { deriveSummary, deriveActionItems } = await import('@/lib/minutes-derive');
      const summary = deriveSummary(body.minutes);
      const fresh = deriveActionItems(body.minutes);

      // 读取当前已存储的 actionItems，按描述相似度合并手动设置的字段
      const current = await getMeetingById(meetingId);
      const existing: any[] = (current?.actionItems || []);
      const PRESERVE = ['due_date','dueDate','status','ownerLoginId','ownerOaId','dept',
        'oa_result','oa_result_at','oa_score','oa_auto_detected','confirmed_by','confirmed_at'];
      const actionItems = fresh.map((item, i) => {
        // 按序号匹配，否则按描述前30字匹配
        const match = existing[i] || existing.find((e: any) =>
          e.description && item.description &&
          e.description.slice(0, 30) === item.description.slice(0, 30));
        if (!match) return item;
        const merged: any = { ...item };
        for (const k of PRESERVE) {
          if (match[k] !== undefined && match[k] !== null) merged[k] = match[k];
        }
        // 若纪要 actionTable 里该行没有填负责人，保留之前手动设置的
        if (!merged.owner && !merged.assignee) {
          if (match.owner) { merged.owner = match.owner; merged.assignee = match.owner; }
          else if (match.assignee) { merged.owner = match.assignee; merged.assignee = match.assignee; }
        }
        return merged;
      });

      body.summary = summary;
      body.actionItems = actionItems;
      derivedData = { summary, actionItems };
      console.log(`[PATCH] Minutes updated → derived ${actionItems.length} action items`);
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
