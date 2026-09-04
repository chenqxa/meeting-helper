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
import { isGroupOwner } from '@/lib/group-owners';

// 按月开的会（产销会/公司月会）：填报归属「最近一次已开完同类会议」所在月份
const MONTHLY_MEETING_TYPES = new Set(['产销会', '公司月会']);

// 周期分界线（业务口径）：开完会传完纪要（≈会议记录创建时刻）之后 = 新一周
// ISO 时间转北京日期；无创建时间的历史数据回退为"会议次日"
function cycleBoundaryOf(latest: { date: string; createdAt?: string }): Date {
  if (latest.createdAt) {
    const iso = new Date(latest.createdAt);
    if (!isNaN(iso.getTime())) {
      const bj = new Date(iso.getTime() + 8 * 3600 * 1000);
      return new Date(bj.toISOString().slice(0, 10) + 'T00:00:00');
    }
  }
  const d = new Date(latest.date + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d;
}

// 判断持续项是否"本周期已填报"：
// - 产销会/公司月会：填报的 data_month（数据归属月）== 最近已开会所在月 → 已填
// - 周例会：最近一次周例会「会议记录创建（≈传纪要）」之后有填报 → 已填（新一周）
// 已填报的本周期项，推送时跳过（避免重复催）
async function buildFilledInCycleSet(
  itemIds: string[],
  meetingType: string,
): Promise<Set<string>> {
  const filled = new Set<string>();
  try {
    const [progressMap, meetings] = await Promise.all([getAllProgress(), getMeetings()]);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // 各类型最近一次已开完会议（meeting_date <= 今天 的最大值），带记录创建时刻
    const latestMeeting: Record<string, { date: string; createdAt?: string }> = {};
    for (const m of meetings) {
      const d = m.meetingDate ? String(m.meetingDate).slice(0, 10) : '';
      if (!d) continue;
      const dd = new Date(d + 'T00:00:00');
      if (dd <= today && (!latestMeeting[m.type] || d > latestMeeting[m.type].date)) {
        latestMeeting[m.type] = { date: d, createdAt: (m as any).createdAt || undefined };
      }
    }

    // 兜底锚点：最近一个自然周一（查不到会议记录时用）
    const dow = (today.getDay() + 6) % 7; // 周一=0
    const lastMonday = new Date(today);
    lastMonday.setDate(today.getDate() - dow - (dow === 0 ? 7 : 0));
    lastMonday.setHours(0, 0, 0, 0);

    for (const id of itemIds) {
      const recs = progressMap[id] || [];
      if (recs.length === 0) continue;

      let inCycle = false;
      if (MONTHLY_MEETING_TYPES.has(meetingType)) {
        // 月度：取最近一条填报，比较 data_month 与最近已开会所在月
        const lm = latestMeeting[meetingType];
        if (lm) {
          const lmMonth = lm.date.slice(0, 7); // YYYY-MM
          inCycle = recs.some(rec => (rec as any).dataMonth === lmMonth);
        } else {
          const latest = [...recs].sort((a, b) => String(b.cycleDate).localeCompare(String(a.cycleDate)))[0];
          const cd = latest?.cycleDate ? new Date(latest.cycleDate + 'T00:00:00') : null;
          inCycle = !!cd && cd >= new Date(today.getFullYear(), today.getMonth(), 1);
        }
      } else {
        // 周例会：填报日 >= 周期分界线（最近会议记录创建日 ≈ 纪要上传日）→ 本周已填
        const latest = [...recs].sort((a, b) => String(b.cycleDate).localeCompare(String(a.cycleDate)))[0];
        const cd = latest?.cycleDate ? new Date(latest.cycleDate + 'T00:00:00') : null;
        const lm = latestMeeting[meetingType];
        if (lm) {
          const boundary = cycleBoundaryOf(lm);
          inCycle = !!cd && cd >= boundary;
        } else {
          inCycle = !!cd && cd > lastMonday; // 查不到会议记录：回退自然周一起算
        }
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
): Promise<{ items: number; pushed: number; failed: number; wecomSent?: number; wecomFailed?: number }> {
  const today = getBeijingParts(now).dateStr;

  // 会议类型可能来自批次来源(sourceText)或所属会议(type)
  const meetings = await getMeetings();
  const typeByMeetingId = new Map(meetings.map(m => [m.id, m.type]));
  const all = await getAllActionItems();
  const allCont = all.filter(i => i.dueDateType === 'continuous');
  const sample = allCont.slice(0, 3).map(i => ({ id: i.id.slice(0, 10), src: i.sourceText, mt: i.meetingId ? typeByMeetingId.get(i.meetingId) : null }));
  console.log(`[continuous-push] DEBUG all=${all.length} cont=${allCont.length} meetingType="${meetingType}" sample=${JSON.stringify(sample)}`);
  let items = all.filter(i =>
    i.dueDateType === 'continuous' &&
    i.oaScore === null &&
    !i.autoFetch && // 开启「自动取数」的持续项：由系统定时自动取数，不再催人填报
    (i.sourceText === meetingType || (i.meetingId && typeByMeetingId.get(i.meetingId) === meetingType))
  );
  // 群体责任人项（所有人/各部门等）不推送：没有具体接收人，OA/企微都落不到人头上，
  // 只在系统内「群体项」视图按周期出现，由管理员代填（与企微完成通知跳过群体提出人口径一致）
  const groupSkipped = items.filter(i => isGroupOwner(i.owner));
  if (groupSkipped.length > 0) {
    items = items.filter(i => !isGroupOwner(i.owner));
    console.log(`[continuous-push] ${meetingType} 跳过群体责任人项 ${groupSkipped.length} 条（${[...new Set(groupSkipped.map(g => g.owner))].join('、')}）`);
  }
  // 指定 itemIds 时只推送这些项（用于测试单条/局部推送）
  if (itemIds && itemIds.length > 0) {
    const idSet = new Set(itemIds);
    items = all.filter(i =>
      i.dueDateType === 'continuous' &&
      i.oaScore === null &&
      !i.autoFetch && // 自动取数项同样不手动催
      idSet.has(i.id)
    );
  }

  // 跳过"本周期已填报"的持续项（避免重复催）；手动指定 itemIds 强制推单条时跳过该过滤
  if (items.length > 0 && !(itemIds && itemIds.length > 0)) {
    const filledInCycle = await buildFilledInCycleSet(items.map(i => i.id), meetingType);
    if (filledInCycle.size > 0) {
      items = items.filter(i => !filledInCycle.has(i.id));
      console.log(`[continuous-push] ${meetingType} 跳过本周期已填报 ${filledInCycle.size} 条`);
    }
  }

  if (items.length === 0) { console.log(`[continuous-push] ${meetingType} 候选为空 itemIds=${JSON.stringify(itemIds)}`); return { items: 0, pushed: 0, failed: 0 }; }

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

  // 企微卡片（并行新通道，与 OA/IM 不互斥；WECOM_ACTION_PUSH_ENABLED 总开关）
  const wecomResult = await sendContinuousWeCom(items, meetingType, today);

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

  return { items: items.length, pushed: oaResult.pushed, failed: oaResult.failed, wecomSent: wecomResult.sent, wecomFailed: wecomResult.failed };
}

// 持续项企微卡片：按责任人聚合一条汇总卡片，点击直达待办中心"我的任务"（OAuth 免密填写）
// 与行动项归档推送同款引擎/开关（WECOM_ACTION_PUSH_ENABLED + WECOM_TEST_MODE 白名单）
// 每次推送生成 pushId 批次落表，卡片 URL 带批次 → 点进来精确显示本批持续项（不同类型/批次不混）
async function sendContinuousWeCom(
  items: { id: string; description: string; owner?: string | null; ownerLoginId?: string | null; dueDateType?: string | null }[],
  meetingType: string,
  date: string,
): Promise<{ sent: number; failed: number; pushId?: string }> {
  const result = { sent: 0, failed: 0, pushId: undefined as string | undefined };
  if (process.env.WECOM_ACTION_PUSH_ENABLED === 'false') {
    console.log('[ContinuousPush][WeCom] 开关关闭，跳过');
    return result;
  }
  if (items.length === 0) return result;

  try {
    const { sendTextCardMessage, resolveUserIdsByNames } = await import('@/lib/wecom-message');
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    if (!baseUrl) return result;

    // 推送批次落表（幂等：同批次重推覆盖）
    const pushId = `PUSH_${meetingType}_${date}`;
    const { getPool } = await import('@/storage/database/sqlserver-storage');
    const pool = await getPool();
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_push_batches')
      CREATE TABLE hyzs_push_batches (
        id            NVARCHAR(128) PRIMARY KEY,
        meeting_type  NVARCHAR(50)  NOT NULL,
        item_ids      NVARCHAR(MAX) NOT NULL,
        created_at    NVARCHAR(64)  NOT NULL
      )
    `);
    const esc = (v: string) => v.replace(/'/g, "''");
    await pool.request().query(`
      MERGE hyzs_push_batches AS t
      USING (SELECT '${esc(pushId)}' AS id) AS s ON t.id = s.id
      WHEN MATCHED THEN UPDATE SET item_ids = '${esc(JSON.stringify(items.map(i => i.id)))}', created_at = '${new Date().toISOString()}'
      WHEN NOT MATCHED THEN INSERT (id, meeting_type, item_ids, created_at)
        VALUES ('${esc(pushId)}', N'${esc(meetingType)}', '${esc(JSON.stringify(items.map(i => i.id)))}', '${new Date().toISOString()}');
    `);
    result.pushId = pushId;

    // 按责任人分桶（与 IM 同口径：ownerLoginId 归并同人；企微匹配用姓名）
    const byOwner = new Map<string, { items: typeof items; displayName: string }>();
    for (const it of items) {
      const key = String(it.ownerLoginId || it.owner || '').trim();
      if (!key) continue;
      if (!byOwner.has(key)) byOwner.set(key, { items: [], displayName: String(it.owner || key).trim() });
      byOwner.get(key)!.items.push(it);
    }

    const nameToUserId = await resolveUserIdsByNames([...new Set([...byOwner.values()].map(b => b.displayName))], false);
    const url = `${baseUrl}/kanban?view=my&shared=true&type=continuous&pushId=${encodeURIComponent(pushId)}`;

    for (const [loginId, { items: bucket, displayName }] of byOwner) {
      // 企微通讯录按姓名匹配，优先姓名、兜底 loginid
      const userId = nameToUserId.get(displayName) || nameToUserId.get(loginId);
      if (!userId) {
        console.warn(`[ContinuousPush][WeCom] ${displayName}(${loginId}) 未匹配企微用户，跳过`);
        result.failed++;
        continue;
      }
      const lines = bucket.slice(0, 4).map((t, i) => `${i + 1}. 🔄 ${String(t.description || '').slice(0, 26)}`).join('\n');
      const more = bucket.length > 4 ? `\n…共${bucket.length}条` : '';
      const title = `🔄 ${meetingType}持续项跟进（${bucket.length}条）`;
      const description = `【${date} 定时推送】\n${lines}${more}\n点击填写本期进展`;
      try {
        const r = await sendTextCardMessage([userId], title, description, url);
        if (r.success) { result.sent++; console.log(`[ContinuousPush][WeCom] ✓ ${displayName}（${bucket.length}条）`); }
        else { result.failed++; console.error(`[ContinuousPush][WeCom] ✗ ${displayName}:`, r.error); }
      } catch (e) {
        result.failed++;
        console.error(`[ContinuousPush][WeCom] ✗ ${displayName}:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.warn('[ContinuousPush][WeCom] 整体异常（不影响 OA/IM）:', e instanceof Error ? e.message : e);
  }
  return result;
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
