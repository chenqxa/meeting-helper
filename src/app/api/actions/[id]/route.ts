import { NextRequest, NextResponse } from 'next/server';
import { getActionItemById, getActionItemByMeetingAndOriginalId, updateActionItem, getMeetingById, updateMeeting, getTaskBatchById, getAllActionItems, getMeetings } from '@/storage';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';
import { autoDetectStatus } from '@/lib/action-status';
import { logOperation } from '@/lib/operation-log';
import { getAppPool, pushMeetingTasksToOA } from '@/lib/oa-task-push';
import { rescheduleActionItem } from '@/lib/oa-pull-runner';
import { upsertContinuousProgress } from '@/storage/database/continuous-progress-storage';

// 按月开的会（产销会/公司月会）：看的是上月数据 → 填报归属「最近一次已开完同类会议」所在月份
const MONTHLY_MEETING_TYPES = new Set(['产销会', '公司月会']);

// 判断持续项的会议类型（meeting_id → 会议 type；无会议则看 source_text）
async function resolveMeetingType(item: { meetingId?: string | null; sourceText?: string | null }): Promise<string> {
  if (item.meetingId) {
    try {
      const m = await getMeetingById(item.meetingId);
      if (m?.type) return m.type;
    } catch { /* ignore */ }
  }
  return item.sourceText || '';
}

// 按月开的会：返回「最近一次已开完（meeting_date <= 今天）」的同类会议所在月份，如 7 → 2026-07
// 找不到最近会议则返回 null（保持原填报当天逻辑）
async function resolveMonthlyCycleMonth(
  item: { meetingId?: string | null; sourceText?: string | null },
): Promise<string | null> {
  const type = await resolveMeetingType(item);
  if (!MONTHLY_MEETING_TYPES.has(type)) return null;
  try {
    const meetings = await getMeetings();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let latest: string | null = null;
    for (const m of meetings) {
      if (m.type !== type) continue;
      const d = m.meetingDate ? String(m.meetingDate).slice(0, 10) : '';
      if (!d) continue;
      const dd = new Date(d + 'T00:00:00');
      if (dd <= today && (!latest || d > latest)) latest = d;
    }
    if (!latest) return null;
    return latest.slice(0, 7); // YYYY-MM
  } catch {
    return null;
  }
}

function fmtScore(v: number | null | undefined): string {
  if (v == null) return '无';
  return v === 1 ? 'V' : v === -1 ? 'X' : String(v);
}

// PUT /api/actions/[id] - 更新行动项（新表 + 同步回会议 JSON）
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: actionId } = await params;
    const body = await request.json();
    const now = new Date().toISOString();

    let existing = await getActionItemById(actionId);
    let targetActionId = actionId;

    if (!existing && body._meetingId) {
      const fallback = await getActionItemByMeetingAndOriginalId(body._meetingId, actionId);
      if (fallback) {
        existing = fallback;
        targetActionId = fallback.id;
      }
    }

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Action item not found' }, { status: 404 });
    }

    // ── 已重派且原项已打 X 的：锁定，任何人（含 admin）不可再改稽核/状态 ──
    // 转派链上的旧任务表示"未完成→已重新派发"，必须保持 X，防误改回 V/0
    const isRescheduledX = Boolean(existing.reassignedTo) && existing.oaScore === -1;
    const tryingToAlterAudit =
      body.oa_score !== undefined ||
      body.status !== undefined ||
      body.oa_result !== undefined ||
      body.oa_result_at !== undefined;
    if (isRescheduledX && tryingToAlterAudit) {
      return NextResponse.json({
        success: false,
        error: '该任务已重新派发且原项标记为未完成(X)，已锁定，不允许修改稽核/状态',
      }, { status: 403 });
    }

    const patch: Record<string, any> = {};
    if (body.status !== undefined) patch.status = body.status;
    if (body.description !== undefined) patch.description = body.description;
    if (body.owner !== undefined) patch.owner = body.owner;
    if (body.ownerLoginId !== undefined) patch.ownerLoginId = body.ownerLoginId;
    if (body.ownerOaId !== undefined) patch.ownerOaId = body.ownerOaId;
    if (body.due_date !== undefined) patch.dueDate = body.due_date;
    if (body.dueDate !== undefined) patch.dueDate = body.dueDate;
    if (body.due_date_type !== undefined) patch.dueDateType = body.due_date_type;
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.dept !== undefined) patch.dept = body.dept;
    if (body.proposer !== undefined) patch.proposer = body.proposer;
    if (body.proposerLoginId !== undefined) patch.proposerLoginId = body.proposerLoginId;
    if (body.proposerOaId !== undefined) patch.proposerOaId = body.proposerOaId;
    if (body.proposer_dept !== undefined) patch.proposerDept = body.proposer_dept;
    if (body.completion_note !== undefined) patch.completionNote = body.completion_note;

    if (
      body.owner !== undefined ||
      body.ownerLoginId !== undefined ||
      body.ownerOaId !== undefined ||
      body.dept !== undefined
    ) {
      const resolvedOwner = await resolveActionOwnerIdentity({
        owner: patch.owner ?? existing.owner,
        ownerLoginId: patch.ownerLoginId ?? existing.ownerLoginId,
        ownerOaId: patch.ownerOaId ?? existing.ownerOaId,
        dept: patch.dept ?? existing.dept,
      });
      patch.owner = resolvedOwner.owner;
      patch.ownerLoginId = resolvedOwner.ownerLoginId;
      patch.ownerOaId = resolvedOwner.ownerOaId;
      patch.dept = resolvedOwner.dept;
    }

    if (body.status === 'done') {
      patch.completedBy = body.completed_by || '当前用户';
      patch.completedAt = now;
      patch.completionNote = body.completion_note || null;
      patch.evidenceFiles = body.evidence_files || existing.evidenceFiles || [];
    }
    if (body.status === 'in_progress' && !existing.confirmedAt) {
      patch.confirmedBy = body.confirmed_by || '当前用户';
      patch.confirmedAt = now;
    }
    if (body.status === 'blocked') {
      patch.blockedBy = body.blocked_by || '当前用户';
      patch.blockedAt = now;
      patch.blockReason = body.block_reason || null;
    }

    if (body.oa_result !== undefined) patch.oaResult = body.oa_result;
    if (body.oa_result_at !== undefined) patch.oaResultAt = body.oa_result_at;
    if (body.oa_score !== undefined) patch.oaScore = body.oa_score;
    if (body.oa_auto_detected !== undefined) patch.oaAutoDetected = body.oa_auto_detected;
    if (body.oa_attachments !== undefined) patch.oaAttachments = body.oa_attachments;

    // 从汇报文本自动判定：文字写了"已完成"但状态选的"进行中"→ 自动纠正为 V
    if (patch.oaResult && body.status !== 'done' && body.status !== 'blocked' && patch.oaScore == null) {
      const detected = autoDetectStatus(patch.oaResult);
      if (detected.autoDetected && detected.status === 'done') {
        patch.status = 'done' as any;
        patch.completedBy = existing.owner || '当前用户';
        patch.completedAt = now;
        patch.oaScore = detected.score;
        patch.oaAutoDetected = true;
      }
    }

    const updated = await updateActionItem(targetActionId, patch);

    // ── 行动项「未完成 + 下次完成时间」→ 自动重派（打X + 生成新记录），与 OA 回拉逻辑一致 ──
    let rescheduled = false;
    let rescheduledError: string | null = null;
    if (
      body.status === 'blocked' &&
      body.next_due_date &&
      existing.dueDateType !== 'continuous' &&
      !existing.reassignedTo
    ) {
      try {
        const r = await rescheduleActionItem(existing as any, String(body.next_due_date).slice(0, 10));
        if (r.ok) {
          rescheduled = true;
          console.log(`[actions/${targetActionId}] 未完成重派成功，新记录 ${r.newItemId}`);
        } else {
          rescheduledError = r.error || null;
        }
      } catch (e) {
        rescheduledError = e instanceof Error ? e.message : String(e);
      }
    }

    // ── 持续项在「我的待办」里汇报进展时，同步写入周期进展表 ──
    if (patch.oaResult !== undefined && (existing.dueDateType === 'continuous' || updated?.dueDateType === 'continuous')) {
      try {
        // 周期任务（sourceType='cycle'）：progress 归到源持续项(sourceId)，周期用任务自带 cycleDate
        const isCycle = existing.sourceType === 'cycle';
        const progressActionId = isCycle ? (existing.sourceId || targetActionId) : targetActionId;
        const cycleDate = isCycle
          ? (existing.cycleDate || new Date().toISOString().slice(0, 10))
          : new Date().toISOString().slice(0, 10);
        // 产销会/公司月会（按月开的会，看上月数据）：额外记录「数据归属月」
        // cycle_date 仍是填报当天（事实不可改）；data_month 标明这条填报属于哪个月的数据
        // 例：8/17 填的 7 月内容 → cycle_date=2026-08-17, data_month=2026-07
        const monthlyMonth = await resolveMonthlyCycleMonth(existing);
        await upsertContinuousProgress({
          actionId: progressActionId,
          cycleDate,
          oaTaskId: `MYTODO_${targetActionId}_${cycleDate}`,
          progress: patch.oaResult ?? null,
          oaStatus: patch.status === 'done' ? 2 : (patch.status === 'in_progress' ? 1 : null),
          source: '会议助手',
          dataMonth: monthlyMonth || null,
        });
        console.log(`[actions/${targetActionId}] 持续项「我的待办」汇报已写入周期进展表 cycleDate=${cycleDate} dataMonth=${monthlyMonth || '无'}`);
      } catch (e) {
        console.warn(`[actions/${targetActionId}] 写入周期进展表失败（不影响汇报）:`, e instanceof Error ? e.message : e);
      }
    }

    // ── 操作日志 ──
    const desc = (updated?.description || existing.description || '').slice(0, 30);
    const beforeScore = existing.oaScore ?? null;
    const afterScore = updated?.oaScore ?? null;
    if (body.oa_score !== undefined && afterScore !== beforeScore) {
      await logOperation({
        action: 'audit',
        targetType: 'action_item',
        targetId: updated?.id || targetActionId,
        summary: `人工稽核 ${fmtScore(beforeScore)} → ${fmtScore(afterScore)}：${desc}`,
        detail: { before: beforeScore, after: afterScore, description: updated?.description, autoDetected: updated?.oaAutoDetected },
      });
    } else if (body.status !== undefined && updated?.status !== existing.status) {
      await logOperation({
        action: 'status_change',
        targetType: 'action_item',
        targetId: updated?.id || targetActionId,
        summary: `状态 ${existing.status} → ${updated?.status}：${desc}`,
        detail: { before: existing.status, after: updated?.status, description: updated?.description },
      });
    } else if (body.owner !== undefined && updated?.owner !== existing.owner) {
      await logOperation({
        action: 'reassign',
        targetType: 'action_item',
        targetId: updated?.id || targetActionId,
        summary: `责任人 ${existing.owner || '空'} → ${updated?.owner || '空'}：${desc}`,
        detail: { before: existing.owner, after: updated?.owner, description: updated?.description },
      });
    }
    // ── 操作日志结束 ──

    // 同步回会议 JSON（向后兼容 meeting detail page）
    if (updated?.meetingId) {
      const meeting = await getMeetingById(updated.meetingId);
      if (meeting) {
        const items = [...(meeting.actionItems || [])];
        const idx = items.findIndex((it: any) =>
          it.id === updated.originalId || it.id === actionId || it.id === targetActionId
        );
        if (idx !== -1) {
          items[idx] = {
            ...items[idx],
            description: updated.description,
            status: updated.status,
            assignee: updated.owner,
            owner: updated.owner,
            ownerLoginId: updated.ownerLoginId,
            ownerOaId: updated.ownerOaId,
            proposer: updated.proposer,
            proposerLoginId: updated.proposerLoginId,
            proposerOaId: updated.proposerOaId,
            dueDate: updated.dueDate,
            due_date: updated.dueDate,
            priority: updated.priority,
            confirmed_by: updated.confirmedBy,
            confirmed_at: updated.confirmedAt,
            completed_by: updated.completedBy,
            completed_at: updated.completedAt,
            completion_note: updated.completionNote,
            evidence_files: updated.evidenceFiles,
            block_reason: updated.blockReason,
            blocked_by: updated.blockedBy,
            blocked_at: updated.blockedAt,
            oa_result: updated.oaResult,
            oa_result_at: updated.oaResultAt,
            oa_score: updated.oaScore,
            oa_auto_detected: updated.oaAutoDetected,
            oa_attachments: updated.oaAttachments,
            updated_at: now,
          };
          await updateMeeting(updated.meetingId, { actionItems: items });
        }
      }
    }

    // ── OA 同步：会议已锁定 + 关键字段（内容/责任人/截止日/优先级）变更时，推送到 OA ──
    // 已在 OA 填写完成情况(wcjgsm)的任务会被 pushMeetingTasksToOA 内部自动跳过，不会覆盖
    let oaSync: { status: 'synced' | 'skipped' | 'failed'; message?: string } | undefined;
    const keyFieldsChanged =
      body.description !== undefined ||
      body.owner !== undefined ||
      body.ownerLoginId !== undefined ||
      body.ownerOaId !== undefined ||
      body.due_date !== undefined ||
      body.dueDate !== undefined ||
      body.priority !== undefined ||
      body.dept !== undefined;

    if (keyFieldsChanged && updated?.meetingId) {
      try {
        const meeting = await getMeetingById(updated.meetingId);
        if (meeting && (meeting as any).status === 'locked') {
          // 传该会议的全部行动项（否则只传一条会导致其他项被误作废）
          const allMeetingActions = await getAllActionItems({ meetingId: meeting.id });
          const oaResult = await pushMeetingTasksToOA({
            id: meeting.id,
            title: (meeting as any).title || '',
            meetingDate: (meeting as any).meeting_date || (meeting as any).meetingDate || '',
            actionItems: allMeetingActions.map((a: any) => ({
              id: a.originalId || a.id,
              description: a.description,
              owner: a.owner,
              assignee: a.owner,
              ownerLoginId: a.ownerLoginId,
              ownerOaId: a.ownerOaId,
              dept: a.dept,
              proposer: a.proposer,
              proposerLoginId: a.proposerLoginId,
              proposerOaId: a.proposerOaId,
              dueDate: a.dueDate,
              due_date: a.dueDate,
              priority: a.priority,
              status: a.status,
            })),
          }, false);

          if (oaResult.summary.skippedProcessedUpdates > 0 && oaResult.summary.updated === 0) {
            oaSync = { status: 'skipped', message: oaResult.notices[0] || '该任务在OA中已有回传内容，未覆盖' };
          } else if (oaResult.failed > 0 && oaResult.summary.updated === 0 && oaResult.summary.added === 0) {
            oaSync = { status: 'failed', message: oaResult.errors[0] || 'OA同步失败' };
          } else {
            const parts = [
              oaResult.summary.updated > 0 ? `更新${oaResult.summary.updated}条` : '',
              oaResult.summary.unchanged > 0 ? `无变化${oaResult.summary.unchanged}条` : '',
              oaResult.summary.skippedProcessedUpdates > 0 ? `已处理未覆盖${oaResult.summary.skippedProcessedUpdates}条` : '',
            ].filter(Boolean).join('，');
            oaSync = { status: 'synced', message: `OA已同步（${parts || '完成'}）` };
          }
          console.log(`[PUT action] OA同步 meeting=${meeting.id} action=${updated.id}:`, oaSync);
        }
      } catch (e) {
        console.error('[PUT action] OA同步异常（不影响本地更新）:', e);
        oaSync = { status: 'failed', message: e instanceof Error ? e.message : 'OA同步异常' };
      }
    }

    return NextResponse.json({ success: true, data: updated, oaSync, rescheduled, rescheduledError });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/actions/[id] - 删除行动项
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: actionId } = await params;
    const url = new URL(request.url);
    const meetingId = url.searchParams.get('meetingId') || undefined;

    let existing = await getActionItemById(actionId);
    let targetActionId = actionId;
    if (!existing && meetingId) {
      const fallback = await getActionItemByMeetingAndOriginalId(meetingId, actionId);
      if (fallback) {
        existing = fallback;
        targetActionId = fallback.id;
      }
    }

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Action item not found' }, { status: 404 });
    }

    // 同步删除会议 JSON 中的行动项
    if (existing.meetingId) {
      const meeting = await getMeetingById(existing.meetingId);
      if (meeting) {
        const items = (meeting.actionItems || []).filter((it: any) =>
          it.id !== existing.originalId && it.id !== actionId && it.id !== targetActionId
        );
        await updateMeeting(existing.meetingId, { actionItems: items });
      }
    }

    // 如果属于已推送的批次，同步作废 OA 记录
    if (existing.sourceType === 'batch' && existing.sourceId) {
      try {
        const batch = await getTaskBatchById(existing.sourceId);
        if (batch?.status === 'pushed') {
          const taskId = `${existing.sourceId}__${targetActionId}`;
          const pool = await getAppPool();
          const linked = process.env.OA_LINKED_SERVER || 'FWsv';
          const db = process.env.OA_DATABASE_NAME || 'ecology';
          const tbl = `[${linked}].[${db}].[dbo].[uf_meetingplan]`;
          await pool.request().query(`
            UPDATE ${tbl} SET source_app = 'HYZS_CANCELLED', remindflag = 0
            WHERE task_id = '${taskId.replace(/'/g, "''")}'
          `);
          console.log(`[OA Cancel] 已作废 ${taskId}`);
        }
      } catch (e) {
        console.warn('[OA Cancel] OA 同步失败（不影响删除）:', (e as Error).message);
      }
    }

    await updateActionItem(targetActionId, {
      status: 'cancelled' as any,
      completionNote: '用户已从会议中删除该行动项，台账保留留痕',
    });

    await logOperation({
      action: 'delete',
      targetType: 'action_item',
      targetId: targetActionId,
      summary: `删除行动项：${(existing.description || '').slice(0, 30)}`,
      detail: { description: existing.description },
    });

    return NextResponse.json({ success: true, data: { cancelled: true } });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
