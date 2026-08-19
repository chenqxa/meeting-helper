// 持续项推送引擎：按会议类型打包持续项，推 OA + 企微提醒
// 注意：不在系统内复制周期任务（sourceType='cycle'）——OA 待办/企微提醒照常推送，
// 填报进度由 OA 回拉归集到源持续项，系统内无需影子副本（曾导致持续项列表重复）
import { getAllActionItems } from '@/storage/database/action-storage';
import { getMeetings } from '@/storage';
import { pushTasksToOA } from '@/lib/oa-task-push';
import { logOperation } from '@/lib/operation-log';
import { batchSendOAUserMessage } from '@/lib/chat-client';
import { getBeijingParts } from '@/lib/beijing-time';
import { recordPushLog } from '@/storage/database/continuous-push-log-storage';
import { getAllProgress } from '@/storage/database/continuous-progress-storage';

// 按月开的会（产销会/公司月会）：填报归属「最近一次已开完同类会议」所在月份
const MONTHLY_MEETING_TYPES = new Set(['产销会', '公司月会']);

// 判断持续项是否"本周期已填报"：
// - 产销会/公司月会：填报的 data_month（数据归属月）== 最近已开会所在月 → 已填
// - 周例会：最近周五起的本周内有填报记录 → 已填
// 已填报的本周期项，推送时跳过（避免重复催）
async function buildFilledInCycleSet(
  itemIds: string[],
  meetingType: string,
): Promise<Set<string>> {
  const filled = new Set<string>();
  try {
    const [progressMap, meetings] = await Promise.all([getAllProgress(), getMeetings()]);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // 各类型最近一次已开完会议日期（meeting_date <= 今天 的最大值）
    const latestMeeting: Record<string, string> = {};
    for (const m of meetings) {
      const d = m.meetingDate ? String(m.meetingDate).slice(0, 10) : '';
      if (!d) continue;
      const dd = new Date(d + 'T00:00:00');
      if (dd <= today && (!latestMeeting[m.type] || d > latestMeeting[m.type])) {
        latestMeeting[m.type] = d;
      }
    }

    // 周例会周期起点：最近周五
    const diff = (today.getDay() + 7 - 5) % 7;
    const recentFriday = new Date(today); recentFriday.setDate(today.getDate() - diff);
    recentFriday.setHours(0, 0, 0, 0);

    for (const id of itemIds) {
      const recs = progressMap[id] || [];
      if (recs.length === 0) continue;

      let inCycle = false;
      if (MONTHLY_MEETING_TYPES.has(meetingType)) {
        // 月度：取最近一条填报，比较 data_month 与最近已开会所在月
        const lm = latestMeeting[meetingType];
        if (lm) {
          const lmMonth = lm.slice(0, 7); // YYYY-MM
          inCycle = recs.some(rec => (rec as any).dataMonth === lmMonth);
        } else {
          const latest = [...recs].sort((a, b) => String(b.cycleDate).localeCompare(String(a.cycleDate)))[0];
          const cd = latest?.cycleDate ? new Date(latest.cycleDate + 'T00:00:00') : null;
          inCycle = !!cd && cd >= new Date(today.getFullYear(), today.getMonth(), 1);
        }
      } else {
        // 周例会：cycleDate >= 最近周五
        const latest = [...recs].sort((a, b) => String(b.cycleDate).localeCompare(String(a.cycleDate)))[0];
        const cd = latest?.cycleDate ? new Date(latest.cycleDate + 'T00:00:00') : null;
        inCycle = !!cd && cd >= recentFriday;
      }
      if (inCycle) filled.add(id);
    }
  } catch (e) {
    console.warn('[continuous-push] 判断本周期已填报失败（将按未填推送）:', e instanceof Error ? e.message : e);
  }
  return filled;
}

export async function pushContinuousByType(
  meetingType: string,
  now: Date = new Date(),
  itemIds?: string[],
  triggerSource: 'auto' | 'manual' = 'auto'
): Promise<{ items: number; pushed: number; failed: number }> {
  const today = getBeijingParts(now).dateStr;

  // 会议类型可能来自批次来源(sourceText)或所属会议(type)
  const meetings = await getMeetings();
  const typeByMeetingId = new Map(meetings.map(m => [m.id, m.type]));
  const all = await getAllActionItems();
  let items = all.filter(i =>
    i.dueDateType === 'continuous' &&
    i.oaScore === null &&
    (i.sourceText === meetingType || (i.meetingId && typeByMeetingId.get(i.meetingId) === meetingType))
  );
  // 指定 itemIds 时只推送这些项（用于测试单条/局部推送）
  if (itemIds && itemIds.length > 0) {
    const idSet = new Set(itemIds);
    items = items.filter(i => idSet.has(i.id));
  }

  // 跳过"本周期已填报"的持续项（避免重复催）
  if (items.length > 0) {
    const filledInCycle = await buildFilledInCycleSet(items.map(i => i.id), meetingType);
    if (filledInCycle.size > 0) {
      items = items.filter(i => !filledInCycle.has(i.id));
      console.log(`[continuous-push] ${meetingType} 跳过本周期已填报 ${filledInCycle.size} 条`);
    }
  }

  if (items.length === 0) return { items: 0, pushed: 0, failed: 0 };

  // 持续项 due_date 保持 NULL 不动
  // OA 任务的 due_date = 当天，只在 pushTasksToOA 参数里传

  const sourceId = `CONT_${meetingType}_${today}`;
  const oaResult = await pushTasksToOA({
    id: sourceId,
    title: `${meetingType}持续项跟进（${today}）`,
    date: today,
    sourceApp: 'HYZS_CONT',
    meetingType,
    actionItems: items.map(item => ({
      id: `${item.id}_${today}`,
      description: item.description,
      owner: item.owner,
      assignee: item.owner,
      ownerLoginId: item.ownerLoginId,
      ownerOaId: item.ownerOaId,
      dept: item.dept,
      proposer: item.proposer,
      proposerLoginId: item.proposerLoginId,
      due_date: today,
      dueDate: today,
      priority: item.priority || 'medium',
      status: item.status || 'pending',
    })),
  }, false);

  // 企业微信提醒（按责任人聚合）
  await sendContinuousIM(items, meetingType, today);

  await logOperation({
    action: 'oa_sync',
    targetType: 'system',
    targetId: `continuous-${meetingType}`,
    summary: `${meetingType}持续项打包：${items.length} 项，OA ${oaResult.pushed}`,
    detail: { meetingType, date: today, items: items.length, pushed: oaResult.pushed, failed: oaResult.failed },
  });

  // 记录推送历史（自动/手动）
  await recordPushLog({
    meetingType,
    triggerSource,
    items: items.length,
    pushed: oaResult.pushed,
    failed: oaResult.failed,
  });

  return { items: items.length, pushed: oaResult.pushed, failed: oaResult.failed };
}

async function sendContinuousIM(items: any[], meetingType: string, date: string) {
  const byOwner = new Map<string, any[]>();
  for (const it of items) {
    const key = it.ownerLoginId || it.owner || '';
    if (!key) continue;
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key)!.push(it);
  }

  for (const [loginId, tasks] of byOwner) {
    const list = tasks.map((t, i) => `${i + 1}. ${t.description}`).join('\n');
    const content = JSON.stringify({
      noticeType: '1000',
      title: `📋 ${meetingType}持续项跟进（${date}）`,
      text: `您有 ${tasks.length} 项持续跟进事项需推进`,
      body: list,
      footer: '请在 OA 中更新进展',
    });
    try {
      await batchSendOAUserMessage({
        oaUserIds: [loginId],
        content,
        idempotencyKey: `continuous-${date}-${loginId}`,
      });
    } catch (e) {
      console.warn(`[ContinuousPush] IM 发送失败 ${loginId}:`, e instanceof Error ? e.message : e);
    }
  }
}
