import { getMeetings, updateMeeting, getAllActionItems, updateActionItem, createActionItem } from '@/storage';
import { getAppPool, pushTasksToOA } from '@/lib/oa-task-push';
import { logOperation } from '@/lib/operation-log';
import { upsertContinuousProgress } from '@/storage/database/continuous-progress-storage';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';

// 未完成自动重派：原记录打X，生成带新截止时间的新记录并推 OA，防重复
// 供 OA 回拉 与 会议助手平台填报共用
export async function rescheduleActionItem(
  dbItem: {
    id: string;
    sourceType?: string | null;
    sourceId?: string | null;
    meetingId?: string | null;
    originalId?: string | null;
    dueDate?: string | null;
    dueDateType?: string | null;
    description?: string | null;
    owner?: string | null;
    ownerLoginId?: string | null;
    ownerOaId?: string | null;
    dept?: string | null;
    proposer?: string | null;
    proposerLoginId?: string | null;
    proposerOaId?: string | null;
    priority?: string | null;
    status?: string | null;
    sourceText?: string | null;
    initialResult?: string | null;
  },
  nextDueDate: string,
): Promise<{ ok: boolean; newItemId?: string; error?: string }> {
  try {
    if (!nextDueDate) return { ok: false, error: '缺少下次完成时间' };
    // 新节点必须晚于原节点：同节点转派会在台账里产生重复行（原X项 + 同日期新V项）
    const origDue = String(dbItem.dueDate || '').slice(0, 10);
    const nextDue = String(nextDueDate).slice(0, 10);
    if (origDue && nextDue <= origDue) {
      return { ok: false, error: `下次完成时间（${nextDue}）必须晚于原节点（${origDue}），已在同节点留痕，无需转派` };
    }
    await updateActionItem(dbItem.id, { oaScore: -1, oaAutoDetected: true } as any);

    // 重派时按当前组织架构固化责任人部门（快照，避免脏 dept 或部门漂移）
    const resolvedOwner = await resolveActionOwnerIdentity({
      owner: dbItem.owner,
      ownerLoginId: dbItem.ownerLoginId,
      ownerOaId: dbItem.ownerOaId,
      dept: dbItem.dept,
    });

    const newItem = await createActionItem({
      sourceType: dbItem.sourceType || 'batch',
      sourceId: dbItem.sourceId || dbItem.meetingId || '',
      meetingId: dbItem.meetingId || null, // 转派保留会议来源（否则新任务丢失会议类型，显示为"独立任务"）
      originalId: dbItem.originalId || dbItem.id,
      dueDateType: dbItem.dueDateType || 'date',
      description: dbItem.description || '',
      owner: resolvedOwner.owner || dbItem.owner,
      ownerLoginId: resolvedOwner.ownerLoginId || dbItem.ownerLoginId,
      ownerOaId: resolvedOwner.ownerOaId || dbItem.ownerOaId,
      dept: resolvedOwner.dept || dbItem.dept,
      proposer: dbItem.proposer,
      proposerLoginId: dbItem.proposerLoginId,
      proposerOaId: dbItem.proposerOaId,
      dueDate: nextDueDate,
      priority: (dbItem.priority || 'medium') as 'medium' | 'high' | 'low',
      status: 'pending',
      sourceText: dbItem.sourceText,
      initialResult: dbItem.initialResult,
      reassignedFrom: dbItem.id,
    });

    try {
      await pushTasksToOA({
        id: newItem.sourceId || newItem.id,
        title: '重派行动项',
        date: new Date().toISOString().slice(0, 10),
        actionItems: [{
          id: newItem.id,
          description: newItem.description,
          owner: newItem.owner,
          assignee: newItem.owner,
          ownerLoginId: newItem.ownerLoginId,
          dept: newItem.dept,
          due_date: newItem.dueDate,
          dueDate: newItem.dueDate,
          priority: newItem.priority,
          status: 'pending',
        }],
      });
    } catch (e) {
      console.warn(`[reschedule] 重派新记录推OA失败 ${newItem.id}:`, e instanceof Error ? e.message : e);
    }

    await updateActionItem(dbItem.id, { reassignedTo: newItem.id } as any);
    console.log(`[reschedule] 未完成自动重派: ${dbItem.id} → ${newItem.id} (下次 ${nextDueDate})`);
    try {
      await logOperation({
        action: 'reschedule',
        targetType: 'action_item',
        targetId: dbItem.id,
        summary: `未完成自动重派（${dbItem.owner || '待分配'}，${String(dbItem.dueDate || '').slice(0, 10)} → ${nextDue}）：${(dbItem.description || '').slice(0, 30)}`,
        detail: {
          fromId: dbItem.id, toId: newItem.id,
          before: dbItem.dueDate, after: nextDue,
          owner: dbItem.owner, dept: dbItem.dept,
          meetingId: dbItem.meetingId,
          source: dbItem.sourceType || 'meeting',
          description: dbItem.description,
        },
      });
    } catch { /* 日志失败不影响重派 */ }
    return { ok: true, newItemId: newItem.id };
  } catch (e) {
    console.warn(`[reschedule] 未完成重派失败 ${dbItem.id}:`, e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 执行一次 OA 回拉（可被 route / settings / 调度器直接调用，不依赖 HTTP/cookie）
export interface OaPullResult {
  success: boolean;
  synced: number;
  contSynced: number;
  rescheduled: number;
  message: string;
  error?: string;
}

export async function executeOaPullResults(cursorAt?: string | null): Promise<OaPullResult> {
  try {
    const pool = await getAppPool();
    const linked = process.env.OA_LINKED_SERVER || 'FWsv';
    const db = process.env.OA_DATABASE_NAME || 'ecology';
    const tbl = `[${linked}].[${db}].[dbo].[uf_meetingplan]`;

    const cursorCond = cursorAt
      ? `AND modedatamodifydatetime > '${cursorAt.replace(/'/g, "''")}'`
      : '';

    // ── 行动项回拉 ──
    const oaRes = await pool.request().query(`
      SELECT task_id, status, wcjgsm, wcqkfj, sfwc, xcwcsj, modedatamodifydatetime
      FROM ${tbl}
      WHERE CAST(source_app AS NVARCHAR(50)) = 'HYZS'
        AND (
          (wcjgsm IS NOT NULL AND DATALENGTH(wcjgsm) > 0)
          OR status >= 2
        )
        ${cursorCond}
    `);

    const oaMap = new Map<string, any>();
    for (const row of oaRes.recordset) {
      const taskId = String(row.task_id || '').trim();
      const wcjgsm = row.wcjgsm != null ? String(row.wcjgsm).trim() : null;
      const wcqkfj = row.wcqkfj != null ? String(row.wcqkfj).trim() : null;
      oaMap.set(taskId, { ...row, task_id: taskId, wcjgsm, wcqkfj });
    }

    const [meetings, dbItems] = await Promise.all([
      getMeetings(),
      getAllActionItems({ includeCancelled: true }),
    ]);

    const dbItemMap = new Map<string, (typeof dbItems)[number]>();
    for (const item of dbItems) {
      const meetingId = String(item.meetingId || '').trim();
      if (meetingId) {
        dbItemMap.set(`${meetingId}__${item.id}`, item);
        if (item.originalId) dbItemMap.set(`${meetingId}__${item.originalId}`, item);
      }
      if (item.sourceType === 'batch' && item.sourceId) {
        dbItemMap.set(`${item.sourceId}__${item.id}`, item);
        if (item.originalId) dbItemMap.set(`${item.sourceId}__${item.originalId}`, item);
      }
    }

    let synced = 0;
    let meetingJsonSynced = 0;
    let ledgerSynced = 0;
    let rescheduledCount = 0;

    for (const [taskId, oaRow] of oaMap.entries()) {
      const splitIndex = taskId.indexOf('__');
      if (splitIndex <= 0) continue;

      const meetingId = taskId.slice(0, splitIndex);
      const itemKey = taskId.slice(splitIndex + 2);
      const newResult = oaRow.wcjgsm || null;
      const newStatus = oaRow.status >= 2 ? 'done' : undefined;
      const oaResultAt = oaRow.modedatamodifydatetime
        ? String(oaRow.modedatamodifydatetime)
        : new Date().toISOString();

      // 附件不再从 OA 回拉覆盖：用户现均在系统内填报（附件存本系统），
      // OA 直链（weaver.file.FileDownload）无会话打不开，历史上曾把本地上传的附件顶掉导致"碎片"

      const dbItem = dbItemMap.get(taskId) || dbItemMap.get(`${meetingId}__${itemKey}`);
      if (dbItem) {
        // 已重派且原项已打 X 的：锁定，OA 回拉也不允许改稽核/状态（转派旧任务必须保持 X）
        const isRescheduledX = Boolean(dbItem.reassignedTo) && dbItem.oaScore === -1;
        const alreadySynced =
          dbItem.oaResult === newResult &&
          (!newStatus || dbItem.status === newStatus) &&
          dbItem.oaResultAt;
        if (!alreadySynced && !isRescheduledX) {
          await updateActionItem(dbItem.id, {
            ...(newStatus ? { status: newStatus as any } : {}),
            oaResult: newResult || dbItem.oaResult,
            oaResultAt: oaResultAt,
            ...(oaRow.status >= 2 && dbItem.oaScore == null
              ? { oaScore: 1, oaAutoDetected: true }
              : {}),
            ...(newStatus === 'done' && !dbItem.completedAt
              ? { completedAt: new Date().toISOString(), completedBy: dbItem.owner || 'OA用户' }
              : {}),
          });
          synced++;
          ledgerSynced++;
        }

        // 未完成自动重派
        const sfwc = Number(oaRow.sfwc ?? null);
        const xcwcsj = String(oaRow.xcwcsj || '').trim();
        if (sfwc === 1 && xcwcsj && !dbItem.reassignedTo) {
          const r = await rescheduleActionItem(dbItem, xcwcsj);
          if (r.ok) rescheduledCount++;
          else console.warn(`[pull-results] 未完成重派失败 ${dbItem.id}:`, r.error);
        }
      }

      const meeting = meetings.find(m => m.id === meetingId);
      if (!meeting || !dbItem?.meetingId) continue;

      const items: any[] = meeting.actionItems || [];
      const idx = items.findIndex((item: any) => item.id === itemKey || item.id === dbItem?.originalId || item.id === dbItem?.id);
      if (idx === -1) continue;

      const target = items[idx];
      const alreadySynced =
        target.oa_result === newResult &&
        (!newStatus || target.status === newStatus) &&
        target.oa_result_at;
      if (alreadySynced) continue;

      items[idx] = {
        ...target,
        ...(newStatus ? { status: newStatus } : {}),
        oa_result: newResult || target.oa_result,
        oa_result_at: oaResultAt,
        ...(oaRow.status >= 2 && target.oa_score == null
          ? { oa_score: 1, oa_auto_detected: true }
          : {}),
        ...(newStatus === 'done' && !target.completed_at
          ? { completed_at: new Date().toISOString(), completed_by: target.owner || 'OA用户' }
          : {}),
      };

      await updateMeeting(meeting.id, { actionItems: items });
      synced++;
      meetingJsonSynced++;
    }

    // ── 持续项回传同步 ──
    let contSynced = 0;
    try {
      const contRes = await pool.request().query(`
        SELECT task_id, status, wcjgsm, modedatacreatedate, modedatamodifydatetime
        FROM ${tbl}
        WHERE CAST(source_app AS NVARCHAR(50)) = 'HYZS_CONT'
          AND (wcjgsm IS NOT NULL AND DATALENGTH(wcjgsm) > 0)
          ${cursorCond}
      `);
      for (const row of contRes.recordset) {
        const taskId = String(row.task_id || '').trim();
        const parts = taskId.split('__');
        let actionId = '';
        let cycleDate = '';
        if (parts.length === 2) {
          const itemIdPart = parts[1];
          const lastUnderscore = itemIdPart.lastIndexOf('_');
          if (lastUnderscore > 0) {
            actionId = itemIdPart.slice(0, lastUnderscore);
            cycleDate = itemIdPart.slice(lastUnderscore + 1);
          }
        }
        if (!actionId) {
          actionId = `ACT_${taskId}`;
          // 非标准 task_id：用 OA 填报日期（modedatacreatedate），而不是回拉当天
          const oaDate = String(row.modedatacreatedate || '').trim().slice(0, 10);
          cycleDate = oaDate || new Date().toISOString().slice(0, 10);
        }
        if (!actionId || !cycleDate) continue;

        const progress = String(row.wcjgsm || '').trim();
        await upsertContinuousProgress({
          actionId, cycleDate, oaTaskId: taskId,
          progress, oaStatus: row.status,
        });
        try {
          await updateActionItem(actionId, {
            oaResult: progress,
            oaResultAt: String(row.modedatamodifydatetime || new Date().toISOString()),
          } as any);
        } catch { /* 持续项可能已删 */ }
        contSynced++;
      }
      if (contSynced > 0) console.log(`[pull-results] 持续项进展同步: ${contSynced} 条`);
    } catch (e) {
      console.warn('[pull-results] 持续项回传同步失败:', e instanceof Error ? e.message : e);
    }

    await logOperation({
      action: 'oa_sync',
      targetType: 'system',
      targetId: 'oa-pull-results',
      summary: synced > 0 || contSynced > 0 || rescheduledCount > 0
        ? `拉取OA完成结果：行动项 ${synced} 条，持续项进展 ${contSynced} 条${rescheduledCount ? `，未完成重派 ${rescheduledCount} 条` : ''}`
        : '拉取OA完成结果：无新增',
      detail: { synced, ledgerSynced, meetingJsonSynced, contSynced, rescheduledCount },
    });

    return {
      success: true,
      synced,
      contSynced,
      rescheduled: rescheduledCount,
      message: synced > 0 || contSynced > 0 || rescheduledCount > 0
        ? `已同步行动项 ${synced} 条、持续项进展 ${contSynced} 条${rescheduledCount ? `、未完成重派 ${rescheduledCount} 条` : ''}`
        : 'OA暂无新的完成结果',
    };
  } catch (error) {
    console.error('[pull-results]', error);
    return {
      success: false,
      synced: 0,
      contSynced: 0,
      rescheduled: 0,
      message: '同步失败',
      error: error instanceof Error ? error.message : '同步失败',
    };
  }
}
