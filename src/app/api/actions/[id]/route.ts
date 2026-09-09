import { NextRequest, NextResponse } from 'next/server';
import { getActionItemById, getActionItemByMeetingAndOriginalId, updateActionItem, getMeetingById, updateMeeting, getTaskBatchById, getAllActionItems, getMeetings, createActionItem } from '@/storage';
import { resolveActionOwnerIdentity, resolveDeptByName } from '@/lib/action-owner';
import { autoDetectStatus } from '@/lib/action-status';
import { logOperation } from '@/lib/operation-log';
import { getAppPool, pushMeetingTasksToOA } from '@/lib/oa-task-push';
import { rescheduleActionItem } from '@/lib/oa-pull-runner';
import { upsertContinuousProgress } from '@/storage/database/continuous-progress-storage';
import { updateActionAutoFetch } from '@/storage/database/action-storage';
import { firstAutoFetchSourceKey } from '@/lib/auto-fetch-sources-meta';
import { guardWrite } from '@/lib/api-guard';
import { getCurrentUser } from '@/lib/session';

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

    // JSON-only 项惰性回填：历史双写分歧遗留的"仅在会议 JSON"行动项，首次编辑时补建台账行
    if (!existing && body._meetingId) {
      try {
        const meeting = await getMeetingById(body._meetingId);
        const legacy = (meeting?.actionItems || []).find((it: any) => it.id === actionId);
        if (legacy) {
          const created = await createActionItem({
            meetingId: body._meetingId,
            originalId: legacy.id,
            description: legacy.description || '',
            owner: legacy.owner || legacy.assignee || null,
            ownerLoginId: legacy.ownerLoginId || null,
            ownerOaId: legacy.ownerOaId || legacy.owner_oa_id || null,
            dept: legacy.dept || null,
            proposer: legacy.proposer || null,
            proposerLoginId: legacy.proposerLoginId || null,
            proposerOaId: legacy.proposerOaId || null,
            proposerDept: legacy.proposer_dept || legacy.proposerDept || null,
            dueDate: legacy.dueDate || legacy.due_date || null,
            dueDateType: legacy.dueDateType || legacy.due_date_type || null,
            priority: legacy.priority || 'medium',
            status: legacy.status || 'pending',
            sourceText: legacy.sourceText || legacy.source_sentence || null,
            confidenceOwner: legacy.confidence?.assignee ?? legacy.confidence_owner ?? null,
            confidenceDate: legacy.confidence?.dueDate ?? legacy.confidence_date ?? null,
          } as any);
          existing = created;
          targetActionId = created.id;
          console.log(`[PUT action] JSON-only 项已回填台账: ${actionId} -> ${created.id}`);
        }
      } catch (e) {
        console.warn('[PUT action] JSON-only 回填失败:', e instanceof Error ? e.message : e);
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

    // ── 分层权限校验（顺序：404 → 转派锁定 → 本分层校验 → 业务逻辑）──
    // 责任人自助汇报：进展/附件 + 完成自报（done=V(+1) / blocked=X(-1)+下次日期重派）；
    // 自报分数由前端提交、后端按状态兜底；改责任人/描述/日期等结构字段仍仅 admin
    const FORBIDDEN_KEYS = [
      'next_due_date',
      'owner', 'ownerLoginId', 'ownerOaId', 'dept',
      'proposer', 'proposerLoginId', 'proposerOaId', 'proposer_dept',
      'description', 'due_date', 'dueDate', 'due_date_type', 'priority',
      'auto_fetch',
    ];
    const SELF_REPORT_STATUSES = ['in_progress', 'done', 'blocked'];
    // tbd（自动转派）任务：责任人允许带 due_date/due_date_type 填节点（可只设日期不做汇报）
    let tbdSelfDueDate: string | null = null;
    if (existing.dueDateType === 'tbd' && body.due_date !== undefined) {
      tbdSelfDueDate = String(body.due_date).slice(0, 10) || null;
      delete body.due_date;
      delete body.dueDate;
      delete body.due_date_type;
    }
    const hasAdminOnlyFields = FORBIDDEN_KEYS.some(k => k in body);
    const statusOk = body.status === undefined || SELF_REPORT_STATUSES.includes(body.status);
    const currentUser = await getCurrentUser();
    const isOwner = !!currentUser && (
      existing.owner === currentUser.name || existing.ownerLoginId === currentUser.loginid
    );
    const isSelfReport = !hasAdminOnlyFields && statusOk && isOwner;

    // 自报"未完成"带下次完成时间：责任人允许，不触发 admin 校验（后面走重派逻辑）
    let selfNextDueDate: string | null = null;
    if (body.next_due_date !== undefined && body.status === 'blocked' && isOwner) {
      selfNextDueDate = String(body.next_due_date).slice(0, 10) || null;
      delete body.next_due_date;
    }
    // 重新计算（next_due_date 已摘除）
    const hasAdminOnlyFieldsFinal = FORBIDDEN_KEYS.some(k => k in body);
    const isSelfReportFinal = !hasAdminOnlyFieldsFinal && statusOk && isOwner;

    if (!isSelfReportFinal) {
      const guard = await guardWrite('admin');
      if (!guard.ok) return guard.response;
    }

    // 持续项「自动取数」标记 + 绑定取数源：仅 admin（已在 FORBIDDEN_KEYS 兜底）；独立轻量更新后直接返回
    if (body.auto_fetch !== undefined) {
      const enabled = !!body.auto_fetch;
      const sourceKey: string | null = enabled ? (body.auto_fetch_source ?? firstAutoFetchSourceKey()) : null;
      if (enabled && !sourceKey) {
        return NextResponse.json({ success: false, error: '尚未配置任何自动取数源，无法开启' }, { status: 400 });
      }
      await updateActionAutoFetch(targetActionId, enabled, sourceKey);
      return NextResponse.json({ success: true, data: { id: targetActionId, auto_fetch: enabled ? 1 : 0, auto_fetch_source: sourceKey } });
    }

    // tbd 只设日期（轻量路径）：不做汇报、不触发通知/重派/日志等副作用
    if (tbdSelfDueDate && Object.keys(body).filter(k => !k.startsWith('_')).length === 0) {
      await updateActionItem(targetActionId, { dueDate: tbdSelfDueDate, dueDateType: 'date' } as any);
      return NextResponse.json({ success: true, data: { id: targetActionId, dueDate: tbdSelfDueDate, dueDateType: 'date' } });
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
    // 行内编辑日期联动类型：填了日期而类型还是 tbd（历史固化）→ 自动转为 date，
    // 防止库里"tbd+有日期"残留导致企微卡片/看板显示"待定"而详情页自愈不一致
    if ((body.due_date !== undefined || body.dueDate !== undefined) && body.due_date_type === undefined) {
      const newDue = (patch.dueDate ?? existing.dueDate) || '';
      if (newDue && String(newDue).trim() && existing.dueDateType === 'tbd') {
        patch.dueDateType = 'date';
      }
    }
    if (body.priority !== undefined) patch.priority = body.priority;
    if (body.dept !== undefined) patch.dept = body.dept;
    if (body.proposer !== undefined) patch.proposer = (body.proposer || '').trim() || null;
    if (body.proposerLoginId !== undefined) patch.proposerLoginId = body.proposerLoginId;
    if (body.proposerOaId !== undefined) patch.proposerOaId = body.proposerOaId;
    if (body.proposer_dept !== undefined) patch.proposerDept = body.proposer_dept;
    if (body.completion_note !== undefined) patch.completionNote = body.completion_note;

    if (body.proposer !== undefined) {
      // 提出人变更时重新反查提出部门，避免台账显示旧部门
      const proposerDept = await resolveDeptByName(patch.proposer ?? existing.proposer);
      if (proposerDept) patch.proposerDept = proposerDept;
    }

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
      patch.completedBy = body.completed_by || currentUser?.name || existing.owner || '未知用户';
      patch.completedAt = now;
      patch.completionNote = body.completion_note || null;
      patch.evidenceFiles = body.evidence_files || existing.evidenceFiles || [];
    }
    if (body.status === 'in_progress' && !existing.confirmedAt) {
      patch.confirmedBy = body.confirmed_by || currentUser?.name || existing.owner || '未知用户';
      patch.confirmedAt = now;
    }
    if (body.status === 'blocked') {
      patch.blockedBy = body.blocked_by || currentUser?.name || existing.owner || '未知用户';
      patch.blockedAt = now;
      patch.blockReason = body.block_reason || null;
    }

    if (body.oa_result !== undefined) patch.oaResult = body.oa_result;
    if (body.oa_result_at !== undefined) patch.oaResultAt = body.oa_result_at;
    if (body.oa_score !== undefined) patch.oaScore = body.oa_score;
    if (body.oa_auto_detected !== undefined) patch.oaAutoDetected = body.oa_auto_detected;
    if (body.oa_attachments !== undefined) patch.oaAttachments = body.oa_attachments;

    // 自报分数强制对齐状态（防任意传分）：已完成=V(+1)、未完成=X(-1)，其余状态不允许带分；
    // 稽核改分（V/X/0 任意切换）仅 admin（走 guardWrite 分支）
    if (isSelfReport) {
      if (body.status === 'done') patch.oaScore = 1;
      else if (body.status === 'blocked') patch.oaScore = -1;
      else delete patch.oaScore;
    }

    // 从汇报文本自动判定：文字写了"已完成"但状态选的"未完成"→ 自动纠正为 done
    if (patch.oaResult && body.status !== 'done' && body.status !== 'blocked' && patch.oaScore == null) {
      const detected = autoDetectStatus(patch.oaResult);
      if (detected.autoDetected && detected.status === 'done') {
        patch.status = 'done' as any;
        patch.completedBy = currentUser?.name || existing.owner || '未知用户';
        patch.completedAt = now;
        patch.oaScore = detected.score;
        patch.oaAutoDetected = true;
      }
    }

    const updated = await updateActionItem(targetActionId, patch);

    // tbd 自报填节点：责任人首次给自动转派任务设定节点日期（tbd → date）
    if (tbdSelfDueDate && updated?.dueDateType === 'tbd') {
      try {
        await updateActionItem(targetActionId, { dueDate: tbdSelfDueDate, dueDateType: 'date' } as any);
        console.log(`[PUT action] tbd 自报填节点: ${targetActionId} → ${tbdSelfDueDate}`);
      } catch (e) {
        console.warn(`[PUT action] tbd 填节点失败 ${targetActionId}:`, e instanceof Error ? e.message : e);
      }
    }

    // ── 完成闭环通知：首次标记"已完成"时异步通知提出人（企微卡片，不阻塞提交）──
    if (body.status === 'done' && existing.status !== 'done') {
      void import('@/lib/wecom-action-push').then(m =>
        m.notifyProposerOnComplete({
          actionId: targetActionId,
          description: (updated?.description ?? existing.description) || '',
          ownerName: updated?.owner ?? existing.owner ?? null,
          proposerName: updated?.proposer ?? existing.proposer ?? null,
          dueDate: updated?.dueDate ?? existing.dueDate ?? null,
          resultRemark: String(body.oa_result ?? existing.oaResult ?? ''),
          meetingId: updated?.meetingId ?? existing.meetingId ?? null,
        })
      ).catch(() => { /* 后台通知失败不影响提交 */ });
    }

    // ── 行动项「未完成 + 下次完成时间」→ 自动重派（打X + 生成新记录），与 OA 回拉逻辑一致 ──
    let rescheduled = false;
    let rescheduledError: string | null = null;
    if (
      body.status === 'blocked' &&
      (body.next_due_date || selfNextDueDate) &&
      existing.dueDateType !== 'continuous' &&
      !existing.reassignedTo
    ) {
      try {
        const r = await rescheduleActionItem(existing as any, String(body.next_due_date || selfNextDueDate).slice(0, 10));
        if (r.ok) {
          rescheduled = true;
          console.log(`[actions/${targetActionId}] 未完成重派成功，新记录 ${r.newItemId}`);

          // ── 企微通知责任人：新任务已生成，请按新节点处理 ──
          void (async () => {
            try {
              const { sendTextCardMessage, resolveUserIdsByNames } = await import('@/lib/wecom-message');
              const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
              if (!baseUrl) return;
              const ownerName = String(existing.owner || '').trim();
              if (!ownerName) return;
              const map = await resolveUserIdsByNames([ownerName], false);
              const uid = map.get(ownerName) || map.get(String(existing.ownerLoginId || ''));
              if (!uid) return;
              const newDue = String(body.next_due_date || selfNextDueDate).slice(0, 10);
              await sendTextCardMessage([uid],
                '🔄 任务重派通知',
                `您报告"未完成"的任务已重派：\n任务：${String(existing.description || '').slice(0, 30)}\n新节点：${newDue}\n请按新节点继续处理`,
                `${baseUrl}/kanban?view=my&shared=true&taskIds=${r.newItemId}`);
              console.log(`[actions/${targetActionId}] 重派企微通知已发送 → ${ownerName}`);
            } catch (e) {
              console.warn(`[actions/${targetActionId}] 重派企微通知失败:`, e instanceof Error ? e.message : e);
            }
          })();
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
        const isNoneFill = body.oa_none === true; // 持续项填报「无进展/无完成情况」：仅系统内结构化选择会置 true
        await upsertContinuousProgress({
          actionId: progressActionId,
          cycleDate,
          oaTaskId: `MYTODO_${targetActionId}_${cycleDate}`,
          progress: isNoneFill ? '无' : (patch.oaResult ?? null),
          oaStatus: patch.status === 'done' ? 2 : (patch.status === 'in_progress' ? 1 : null),
          source: '会议助手',
          dataMonth: monthlyMonth || null,
          isNone: isNoneFill,
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
    // 汇报/稽核均记一条完整上下文：操作人来自会话（logOperation 内取），责任人、节点、来源一并入 detail
    const reportBase = {
      owner: updated?.owner ?? existing.owner,
      dept: updated?.dept ?? existing.dept,
      dueDate: updated?.dueDate ?? existing.dueDate,
      meetingId: existing.meetingId,
      source: existing.sourceType || 'meeting',
      description: updated?.description ?? existing.description,
      result: (body.oa_result || existing.oaResult || '')?.toString().slice(0, 200) || null,
      attachments: Array.isArray(body.oa_attachments) ? body.oa_attachments.length : undefined,
      rescheduled: rescheduled || undefined,
      rescheduledTo: rescheduled ? undefined : (rescheduledError || undefined),
    };
    if (body.oa_score !== undefined && afterScore !== beforeScore) {
      await logOperation({
        action: 'audit',
        targetType: 'action_item',
        targetId: updated?.id || targetActionId,
        summary: `人工稽核 ${fmtScore(beforeScore)} → ${fmtScore(afterScore)}：${desc}`,
        detail: { before: beforeScore, after: afterScore, autoDetected: updated?.oaAutoDetected, ...reportBase },
      });
    } else if (body.status !== undefined && updated?.status !== existing.status) {
      const statusLabel: Record<string, string> = { done: '已完成', blocked: '未完成', in_progress: '进行中', pending: '未处理' };
      const newStatus = updated?.status ?? '';
      await logOperation({
        action: 'status_change',
        targetType: 'action_item',
        targetId: updated?.id || targetActionId,
        summary: `${statusLabel[existing.status] || existing.status} → ${statusLabel[newStatus] || newStatus}（${reportBase.owner || '待分配'}）：${desc}`,
        detail: { before: existing.status, after: newStatus, ...reportBase },
      });
    } else if (body.owner !== undefined && updated?.owner !== existing.owner) {
      await logOperation({
        action: 'reassign',
        targetType: 'action_item',
        targetId: updated?.id || targetActionId,
        summary: `责任人 ${existing.owner || '空'} → ${updated?.owner || '空'}：${desc}`,
        detail: { before: existing.owner, after: updated?.owner, ...reportBase },
      });
    } else if (body.oa_result !== undefined) {
      // 仅更新汇报内容（状态/稽核没变）也要留痕，谁在什么时候补交/修改了汇报
      await logOperation({
        action: 'report',
        targetType: 'action_item',
        targetId: updated?.id || targetActionId,
        summary: `提交汇报（${reportBase.owner || '待分配'}）：${desc}`,
        detail: reportBase,
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

    // JSON-only 项：无台账行，仅从会议 JSON 移除即可（不产生 404，避免前端"删不掉"）
    if (!existing && meetingId) {
      const meeting = await getMeetingById(meetingId);
      const legacy = meeting ? (meeting.actionItems || []).find((it: any) => it.id === actionId) : null;
      if (legacy && meeting) {
        const items = (meeting.actionItems || []).filter((it: any) => it.id !== actionId);
        await updateMeeting(meetingId, { actionItems: items });
        await logOperation({
          action: 'delete',
          targetType: 'action_item',
          targetId: actionId,
          summary: `删除行动项（仅会议JSON，无台账行）：${(legacy.description || '').slice(0, 30)}`,
          detail: { description: legacy.description },
        });
        return NextResponse.json({ success: true, data: { cancelled: false, jsonOnly: true } });
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
