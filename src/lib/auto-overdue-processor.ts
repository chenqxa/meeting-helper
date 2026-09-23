// 行动项「到期自动打X+转派」引擎（v2 优化版）
// 每天 09:00（北京时间）执行两个动作：
//   A. 到期前预警：节点=明天的任务，推企微卡片提醒责任人
//   B. 到期后打X：节点≤昨天且未处理的任务，自动打X + 生成新任务(节点为空) + 推企微
// 起始日期 2026-09-07；admin 可通过 API 手动预览/执行
//
// v2 修复：
//   - [CRITICAL] updateActionItem 现在正确持久化 auto_x_at / due_reminder_at
//   - [PERF] 先建新任务再打X+链接（一步合并），失败时原任务不被破坏
//   - [PERF] resolveActionOwnerIdentity 按人缓存，同人只查一次
//   - [SAFE] 进程级锁防止定时器与手动触发并发执行
//   - [EDGE] 日期比较统一 slice(0,10) 防 ISO 时间后缀干扰精确匹配
import { getAllActionItems, updateActionItem, createActionItem, type ActionItem } from '@/storage/database/action-storage';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';
import { isGroupOwner } from '@/lib/group-owners';
import { getBeijingParts } from '@/lib/beijing-time';

const START_DATE = process.env.AUTO_OVERDUE_START_DATE || '2026-09-07';

// ── 进程级锁：防止定时器与 admin 手动触发并发 ──
let _running = false;
function withLock<T>(fn: () => Promise<T>): Promise<T | { __locked: true }> {
  if (_running) return Promise.resolve({ __locked: true });
  _running = true;
  return fn().finally(() => { _running = false; });
}

// ── 工具 ──
function bjDateStr(offsetDays = 0): string {
  const bj = getBeijingParts(new Date());
  const d = new Date(bj.dateStr + 'T12:00:00');
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtMD(d: string): string {
  return `${parseInt(d.slice(5, 7))}月${parseInt(d.slice(8, 10))}日`;
}

// 统一截取 YYYY-MM-DD（防 ISO 后缀 "2026-09-07T14:30:00Z" 干扰比较）
function ymd(v: string | null | undefined): string {
  return String(v || '').slice(0, 10);
}

// ── 筛选条件（共用） ──
function isEligible(i: ActionItem): boolean {
  // 注：gsmalt 来源不排除——9/7 前的项有稽核结果(oaScore非空)自然被过滤；
  // 8月项因 due < START_DATE 被排除；9/7 后的 pending 项正好走完整的自动打X+转派闭环
  if (i.dueDateType !== 'date') return false;
  if (!i.dueDate || ymd(i.dueDate) === '') return false;
  if (i.status === 'cancelled' || i.status === 'done' || i.status === 'blocked') return false;
  if (i.oaScore !== null && i.oaScore !== undefined) return false;
  if (i.reassignedTo) return false;
  if (!i.owner || isGroupOwner(i.owner)) return false;
  if (ymd(i.dueDate) < START_DATE) return false;
  return true;
}

// ── 企微推送（按责任人汇总一条卡片，链接带各自 taskIds 精确过滤） ──
async function pushWeCom(
  byOwner: Map<string, { items: string[]; displayName: string; taskIds: string[] }>,
  title: string,
  buildBody: (items: string[]) => string,
  pushType: 'due_reminder' | 'auto_x',
): Promise<{ sent: number; failed: number; failedRecipients: string[] }> {
  const result = { sent: 0, failed: 0, failedRecipients: [] as string[] };
  if (byOwner.size === 0) return result;
  try {
    const { sendTextCardMessage, resolveUserIdsByNames } = await import('@/lib/wecom-message');
    const { recordPushLog } = await import('@/storage/database/push-log-storage');
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const names = [...new Set([...byOwner.values()].map(b => b.displayName))];

    // 落地页未配置：明确记录失败，绝不静默（否则会出现"标记已提醒却没发"）
    if (!baseUrl) {
      for (const [loginId, b] of byOwner) {
        result.failed++; result.failedRecipients.push(loginId);
        void recordPushLog({ pushType, channel: 'wecom', recipient: b.displayName, taskIds: b.taskIds, success: false, error: 'NEXT_PUBLIC_APP_URL 未配置' });
      }
      console.warn('[auto-overdue] NEXT_PUBLIC_APP_URL 未配置，企微推送全部失败');
      return result;
    }

    const nameToUserId = await resolveUserIdsByNames(names, false);
    for (const [loginId, { items, displayName, taskIds }] of byOwner) {
      const userId = nameToUserId.get(displayName) || nameToUserId.get(loginId);
      if (!userId) {
        result.failed++; result.failedRecipients.push(loginId);
        void recordPushLog({ pushType, channel: 'wecom', recipient: displayName, taskIds, success: false, error: '企微未匹配到用户' });
        continue;
      }
      const url = `${baseUrl}/kanban?view=my&shared=true${taskIds.length > 0 ? `&taskIds=${taskIds.join(',')}` : ''}`;
      try {
        const r = await sendTextCardMessage([userId], title, buildBody(items), url);
        if (r.success) {
          result.sent++;
          void recordPushLog({ pushType, channel: 'wecom', recipient: displayName, taskIds, success: true });
        } else {
          result.failed++; result.failedRecipients.push(loginId);
          void recordPushLog({ pushType, channel: 'wecom', recipient: displayName, taskIds, success: false, error: r.error || '发送失败' });
        }
      } catch (e) {
        result.failed++; result.failedRecipients.push(loginId);
        void recordPushLog({ pushType, channel: 'wecom', recipient: displayName, taskIds, success: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    console.warn('[auto-overdue] 企微推送异常:', e instanceof Error ? e.message : e);
  }
  return result;
}

// ── 到期提醒失败当天重试 1 次 ──
const reminderRetryTimers = new Set<string>();
function scheduleReminderRetry(candidates: ActionItem[], tomorrow: string) {
  const token = `retry-${tomorrow}`;
  if (reminderRetryTimers.has(token)) return;
  reminderRetryTimers.add(token);
  setTimeout(async () => {
    try {
      const all = await getAllActionItems();
      const byId = new Map(all.map(i => [i.id, i]));
      // 只重试：仍未被标记、仍明天到期、仍满足条件
      const retry = candidates.filter(c => {
        const cur = byId.get(c.id);
        return !!cur && !cur.dueReminderAt && ymd(cur.dueDate) === tomorrow && isEligible(cur);
      });
      if (retry.length === 0) return;
      const byOwner = new Map<string, { items: string[]; displayName: string; taskIds: string[] }>();
      for (const c of retry) {
        const key = String(c.ownerLoginId || c.owner || '').trim();
        if (!key) continue;
        if (!byOwner.has(key)) byOwner.set(key, { items: [], displayName: String(c.owner || key).trim(), taskIds: [] });
        byOwner.get(key)!.items.push(String(c.description || '').slice(0, 30));
        byOwner.get(key)!.taskIds.push(c.id);
      }
      const push = await pushWeCom(byOwner, `⏰ 行动项到期提醒（明天 ${fmtMD(tomorrow)}）`, (items) =>
        `您有 ${items.length} 条行动项将于明天到期：\n${items.slice(0, 4).map((t, i) => `${i + 1}. ${t}`).join('\n')}${items.length > 4 ? `\n…共${items.length}条` : ''}\n点击填写处理结果`,
        'due_reminder');
      const failedSet = new Set(push.failedRecipients);
      const now = new Date().toISOString();
      for (const c of retry) {
        const key = String(c.ownerLoginId || c.owner || '').trim();
        if (failedSet.has(key)) continue;
        try { await updateActionItem(c.id, { dueReminderAt: now } as any); } catch { /* ignore */ }
      }
      console.log(`[due-reminder] 当天重试：候选 ${retry.length}，推送 ${push.sent}，失败 ${push.failed}`);
    } catch (e) {
      console.warn('[due-reminder] 当天重试异常:', e instanceof Error ? e.message : e);
    } finally {
      reminderRetryTimers.delete(token);
    }
  }, 30 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════
// 动作 A：到期前预警（节点 = 明天）
// ═══════════════════════════════════════════════════════════
export interface DueReminderResult {
  tomorrow: string;
  candidates: number;
  pushed: number;
  dryRun: boolean;
  locked?: boolean;
  previews: { owner: string; items: string[] }[];
}

export async function runDueReminder(dryRun = false): Promise<DueReminderResult> {
  return withLock(async () => {
    const tomorrow = bjDateStr(1);
    const all = await getAllActionItems();
    const candidates = all.filter(i =>
      isEligible(i) &&
      ymd(i.dueDate) === tomorrow &&
      !i.dueReminderAt,
    );

    const base: DueReminderResult = { tomorrow, candidates: candidates.length, pushed: 0, dryRun, previews: [] };
    if (candidates.length === 0) return base;

    const byOwner = new Map<string, { items: string[]; displayName: string; taskIds: string[] }>();
    for (const c of candidates) {
      const key = String(c.ownerLoginId || c.owner || '').trim();
      if (!key) continue;
      if (!byOwner.has(key)) byOwner.set(key, { items: [], displayName: String(c.owner || key).trim(), taskIds: [] });
      byOwner.get(key)!.items.push(String(c.description || '').slice(0, 30));
      byOwner.get(key)!.taskIds.push(c.id);
    }

    if (dryRun) {
      base.previews = [...byOwner.values()].map(v => ({ owner: v.displayName, items: v.items }));
      return base;
    }

    // 推送
    const title = `⏰ 行动项到期提醒（明天 ${fmtMD(tomorrow)}）`;
    const push = await pushWeCom(byOwner, title, (items) =>
      `您有 ${items.length} 条行动项将于明天到期：\n${items.slice(0, 4).map((t, i) => `${i + 1}. ${t}`).join('\n')}${items.length > 4 ? `\n…共${items.length}条` : ''}\n点击填写处理结果`,
      'due_reminder');
    base.pushed = push.sent;

    // 仅"成功送达"的责任人才标记 due_reminder_at；失败项不标记，改由当天重试
    const failedSet = new Set(push.failedRecipients);
    const now = new Date().toISOString();
    for (const c of candidates) {
      const key = String(c.ownerLoginId || c.owner || '').trim();
      if (failedSet.has(key)) continue;
      try {
        await updateActionItem(c.id, { dueReminderAt: now } as any);
      } catch (e) {
        console.warn(`[due-reminder] 标记失败 ${c.id}:`, e instanceof Error ? e.message : e);
      }
    }
    // 失败责任人：当天重试 1 次
    if (push.failed > 0) scheduleReminderRetry(candidates, tomorrow);

    console.log(`[due-reminder] ${tomorrow} 到期：候选 ${candidates.length}，推送 ${push.sent}，失败 ${push.failed}`);
    return base;
  }) as Promise<DueReminderResult>;
}

// ═══════════════════════════════════════════════════════════
// 动作 B：到期后自动打X + 转派（节点 ≤ 昨天）
// ═══════════════════════════════════════════════════════════
export interface AutoOverdueXResult {
  yesterday: string;
  candidates: number;
  xCount: number;
  newTaskCount: number;
  pushed: number;
  dryRun: boolean;
  locked?: boolean;
  previews: { id: string; owner: string; dueDate: string; description: string }[];
  errors: string[];
}

export async function runAutoOverdueX(dryRun = false): Promise<AutoOverdueXResult> {
  return withLock(async () => {
    const yesterday = bjDateStr(-1);
    const all = await getAllActionItems();
    const candidates = all.filter(i =>
      isEligible(i) &&
      ymd(i.dueDate) <= yesterday &&
      !i.autoXAt,
    );

    const base: AutoOverdueXResult = {
      yesterday, candidates: candidates.length, xCount: 0, newTaskCount: 0,
      pushed: 0, dryRun, previews: [], errors: [],
    };
    if (candidates.length === 0) return base;

    if (dryRun) {
      base.previews = candidates.map(c => ({
        id: c.id, owner: c.owner || '—', dueDate: ymd(c.dueDate),
        description: String(c.description || '').slice(0, 30),
      }));
      return base;
    }

    // 责任人身份缓存（同人只 resolve 一次）
    const ownerCache = new Map<string, Awaited<ReturnType<typeof resolveActionOwnerIdentity>>>();

    const pushItems = new Map<string, { items: string[]; displayName: string; taskIds: string[] }>();
    const now = new Date().toISOString();

    for (const c of candidates) {
      try {
        // ── 步骤 1：先建新任务（如果这步失败，原任务不受影响 — 安全）──
        const ownerKey = String(c.owner || '');
        if (!ownerCache.has(ownerKey)) {
          ownerCache.set(ownerKey, await resolveActionOwnerIdentity({
            owner: c.owner, ownerLoginId: c.ownerLoginId, ownerOaId: c.ownerOaId, dept: c.dept,
          }));
        }
        const resolved = ownerCache.get(ownerKey)!;

        const newItem = await createActionItem({
          sourceType: c.sourceType || 'batch',
          sourceId: c.sourceId || c.meetingId || '',
          meetingId: c.meetingId || null,
          originalId: c.originalId || c.id,
          dueDateType: 'tbd',
          dueDate: null,
          description: c.description || '',
          owner: resolved.owner || c.owner,
          ownerLoginId: resolved.ownerLoginId || c.ownerLoginId,
          ownerOaId: resolved.ownerOaId || c.ownerOaId,
          dept: resolved.dept || c.dept,
          proposer: c.proposer,
          proposerLoginId: c.proposerLoginId,
          proposerOaId: c.proposerOaId,
          proposerDept: c.proposerDept,
          priority: (c.priority || 'medium') as 'medium',
          status: 'pending' as const,
          sourceText: c.sourceText,
          initialResult: c.initialResult,
          reassignedFrom: c.id,
        } as any);
        base.newTaskCount++;

        // ── 步骤 2：原任务打X + 链接转派（一次 update，减少 DB 调用 + 消除中间态）──
        await updateActionItem(c.id, {
          oaScore: -1,
          status: 'blocked' as any,
          blockedBy: '系统自动',
          blockedAt: now,
          autoXAt: now,
          reassignedTo: newItem.id,
        } as any);
        base.xCount++;

        // ── 步骤 3：操作日志（失败不影响主流程）──
        try {
          const { logOperation } = await import('@/lib/operation-log');
          await logOperation({
            action: 'auto_x',
            targetType: 'action_item',
            targetId: c.id,
            summary: `系统自动打X+转派（${c.owner || '—'}，节点 ${ymd(c.dueDate)}）：${String(c.description || '').slice(0, 30)}`,
            detail: { fromId: c.id, toId: newItem.id, owner: c.owner, dueDate: c.dueDate, description: c.description, auto: true },
          });
        } catch { /* 定时器上下文无 cookies，日志可能跳过 */ }

        // ── 步骤 4：收集推送 ──
        const pushKey = String(c.ownerLoginId || c.owner || '').trim();
        if (pushKey) {
          if (!pushItems.has(pushKey)) pushItems.set(pushKey, { items: [], displayName: String(c.owner || pushKey).trim(), taskIds: [] });
          pushItems.get(pushKey)!.items.push(String(c.description || '').slice(0, 30));
          pushItems.get(pushKey)!.taskIds.push(c.id);
        }
      } catch (e) {
        const msg = `${c.id}: ${e instanceof Error ? e.message : String(e)}`;
        base.errors.push(msg);
        console.error(`[auto-overdue-x] 处理失败 ${msg}`);
      }
    }

    // ── 步骤 5：按人汇总推送 ──
    if (pushItems.size > 0) {
      const push = await pushWeCom(pushItems, '⚠️ 行动项超期自动打X通知', (items) =>
        `因节点到期未填写，以下 ${items.length} 条行动项已自动打X并生成新任务：\n${items.slice(0, 4).map((t, i) => `${i + 1}. ${t}`).join('\n')}${items.length > 4 ? `\n…共${items.length}条` : ''}\n请填写新任务节点并处理`,
        'auto_x');
      base.pushed = push.sent;
    }

    console.log(`[auto-overdue-x] ${yesterday} 前到期：候选 ${candidates.length}，打X ${base.xCount}，新任务 ${base.newTaskCount}，推送 ${base.pushed}，失败 ${base.errors.length}`);
    return base;
  }) as Promise<AutoOverdueXResult>;
}
