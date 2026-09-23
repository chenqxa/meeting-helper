/**
 * 企微行动项推送（并行新通道，不动 OA / IM）
 *
 * 锁定会议时：按责任人分桶 → 与上次推送快照 diff（内容 hash）→
 * 有变化的责任人各发一条 textcard 汇总卡片 → 点击 OAuth 免密直达 /mytasks 填写。
 *
 * 幂等：同责任人同会议内容无变化不重复推送（快照表 hyzs_wecom_action_push_snapshots）。
 */

import { getPool } from '@/storage/database/sqlserver-storage';
import { sendTextCardMessage, resolveUserIdsByNames } from '@/lib/wecom-message';

const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'in_progress', 'blocked', 'candidate']);

interface PushItem {
  id: string;
  description: string;
  owner?: string | null;
  assignee?: string | null;
  dueDate?: string | null;
  dueDateType?: string | null;
  priority?: string | null;
  status?: string | null;
}

interface BucketSnapshotRow {
  meeting_id: string;
  owner_name: string;
  payload: string | null;
  pushed_at: string | null;
}

let tablesEnsured = false;

async function ensureTables() {
  if (tablesEnsured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_wecom_action_push_snapshots')
    CREATE TABLE hyzs_wecom_action_push_snapshots (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      meeting_id    NVARCHAR(64)  NOT NULL,
      owner_name    NVARCHAR(100) NOT NULL,
      payload       NVARCHAR(MAX) NULL,
      pushed_at     NVARCHAR(64)  NULL,
      CONSTRAINT uq_wecom_action_snapshot UNIQUE (meeting_id, owner_name)
    )
  `);
  tablesEnsured = true;
}

// 稳定序列化（排序后 hash 用的字段），用于内容变化判定
function serializeBucket(items: PushItem[]): string {
  return JSON.stringify(
    items
      .map(i => ({
        id: String(i.id || ''),
        description: String(i.description || ''),
        owner: String(i.owner || i.assignee || ''),
        dueDate: String(i.dueDate || '').slice(0, 10),
        dueDateType: String(i.dueDateType || 'date'),
        priority: String(i.priority || 'medium'),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

async function loadSnapshots(meetingId: string): Promise<Map<string, BucketSnapshotRow>> {
  const pool = await getPool();
  const res = await pool.request().query(
    `SELECT meeting_id, owner_name, payload, pushed_at FROM hyzs_wecom_action_push_snapshots WHERE meeting_id = '${meetingId.replace(/'/g, "''")}'`
  );
  const map = new Map<string, BucketSnapshotRow>();
  for (const row of res.recordset as BucketSnapshotRow[]) {
    map.set(row.owner_name.trim(), row);
  }
  return map;
}

async function saveSnapshot(meetingId: string, ownerName: string, payload: string) {
  const pool = await getPool();
  const esc = (v: string) => v.replace(/'/g, "''");
  await pool.request().query(`
    MERGE hyzs_wecom_action_push_snapshots AS t
    USING (SELECT '${esc(meetingId)}' AS meeting_id, N'${esc(ownerName)}' AS owner_name) AS s
    ON t.meeting_id = s.meeting_id AND t.owner_name = s.owner_name
    WHEN MATCHED THEN UPDATE SET payload = N'${esc(payload)}', pushed_at = '${new Date().toISOString()}'
    WHEN NOT MATCHED THEN INSERT (meeting_id, owner_name, payload, pushed_at)
      VALUES (s.meeting_id, s.owner_name, N'${esc(payload)}', '${new Date().toISOString()}');
  `);
}

function buildCardContent(meeting: { title?: string }, items: PushItem[], prevItemIds: Set<string>, version: number) {
  const addedCount = items.filter(i => !prevItemIds.has(String(i.id))).length;
  const title = `📋 行动项待处理（${items.length}条${addedCount > 0 && addedCount < items.length ? `，新增${addedCount}条` : ''}）`;
  const lines = items.slice(0, 4).map((it, idx) => {
    const tag = it.dueDateType === 'continuous' ? '[持续] ' : it.dueDateType === 'tbd' ? '[待定] ' : '';
    const due = it.dueDate ? ` 截止${String(it.dueDate).slice(5, 10).replace('-', '/')}` : '';
    return `${idx + 1}. ${tag}${String(it.description || '').slice(0, 28)}${due}`;
  }).join('\n');
  const more = items.length > 4 ? `\n…共${items.length}条` : '';
  const description = `【${(meeting.title || '会议').slice(0, 30)} v${version}】\n${lines}${more}\n点击填写处理结果`;
  return { title, description };
}

export interface WeComActionPushResult {
  status: 'success' | 'failed' | 'skipped' | 'timeout';
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
}

// 完成闭环通知：责任人首次标记"已完成"时，异步通知提出人（企微 textcard）
// 防打扰设计：只发"完成"；自己提自己做不发；群体提出人（所有人/各部门）不发；
// 重复修改已 done 项的汇报不重发（仅 pending/blocked→done 的状态跃迁触发）
export async function notifyProposerOnComplete(params: {
  actionId: string;
  description: string;
  ownerName: string | null;
  proposerName: string | null;
  dueDate?: string | null;
  resultRemark: string;
  meetingId?: string | null;
}): Promise<void> {
  try {
    if (process.env.WECOM_ACTION_PUSH_ENABLED === 'false') return;

    const proposer = String(params.proposerName || '').trim();
    const owner = String(params.ownerName || '').trim();
    if (!proposer) {
      console.log(`[WeComDoneNotify] ${params.actionId} 无提出人，跳过`);
      return;
    }
    if (proposer === owner) {
      console.log(`[WeComDoneNotify] ${params.actionId} 提出人=责任人（${proposer}），跳过`);
      return;
    }
    const { isGroupOwner } = await import('./group-owners');
    if (isGroupOwner(proposer)) {
      console.log(`[WeComDoneNotify] ${params.actionId} 提出人为群体（${proposer}），跳过`);
      return;
    }

    const { sendTextCardMessage, resolveUserIdsByNames } = await import('./wecom-message');
    const nameToUserId = await resolveUserIdsByNames([proposer], false);
    const userId = nameToUserId.get(proposer);
    if (!userId) {
      console.warn(`[WeComDoneNotify] ${proposer} 未匹配企微用户，跳过`);
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    if (!baseUrl) return;
    // 直达行动项台账该条的完成情况（OAuth 免密 + focusId 聚焦）
    const url = `${baseUrl}/tracking?shared=true&focusId=${encodeURIComponent(params.actionId)}`;

    const desc = String(params.description || '').slice(0, 30);
    const due = params.dueDate ? String(params.dueDate).slice(0, 10) : '无';
    const remark = String(params.resultRemark || '（未填说明）').slice(0, 60);
    const title = `✅ 你提出的行动项已完成`;
    const description = `「${desc}」\n责任人：${owner} · 截止 ${due}\n完成说明：${remark}`;

    const r = await sendTextCardMessage([userId], title, description, url);
    if (r.success) console.log(`[WeComDoneNotify] ✓ 「${desc}」→ 提出人 ${proposer}`);
    else console.error(`[WeComDoneNotify] ✗ ${proposer}:`, r.error);
  } catch (e) {
    console.warn('[WeComDoneNotify] 异常（不影响提交）:', e instanceof Error ? e.message : e);
  }
}

export async function syncMeetingActionsToWeCom(
  meeting: { id: string; title?: string },
  items: PushItem[],
  version: number
): Promise<WeComActionPushResult> {
  const result: WeComActionPushResult = { status: 'skipped', sent: 0, skipped: 0, failed: 0, errors: [] };

  if (process.env.WECOM_ACTION_PUSH_ENABLED === 'false') {
    console.log('[WeComActionPush] 开关关闭，跳过');
    return result;
  }

  const activeItems = items.filter(i => ACTIVE_STATUSES.has(String(i.status || 'pending')));
  if (activeItems.length === 0) {
    console.log('[WeComActionPush] 无待处理行动项，跳过');
    return result;
  }

  await ensureTables();

  // 按责任人分桶
  const buckets = new Map<string, PushItem[]>();
  for (const item of activeItems) {
    const owner = String(item.owner || item.assignee || '').trim();
    if (!owner) continue;
    if (!buckets.has(owner)) buckets.set(owner, []);
    buckets.get(owner)!.push(item);
  }

  const snapshots = await loadSnapshots(meeting.id);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  if (!baseUrl) {
    result.status = 'failed';
    result.errors.push('未配置 NEXT_PUBLIC_APP_URL');
    return result;
  }
  // 卡片直达待办中心「我的任务」视图（view=my），带 meetingId 供聚焦过滤，shared=true 走企微 OAuth 免密
  const url = `${baseUrl}/kanban?view=my&shared=true&meetingId=${encodeURIComponent(meeting.id)}`;

  // 解析 userid（内部已处理 WECOM_TEST_MODE 白名单）
  const ownerNames = Array.from(buckets.keys());
  const nameToUserId = await resolveUserIdsByNames(ownerNames, false);

  for (const [owner, bucket] of buckets.entries()) {
    const payload = serializeBucket(bucket);
    const prev = snapshots.get(owner);

    if (prev && prev.payload === payload) {
      console.log(`[WeComActionPush] ${owner} 内容无变化，跳过`);
      result.skipped++;
      continue;
    }

    const userId = nameToUserId.get(owner);
    if (!userId) {
      console.warn(`[WeComActionPush] ${owner} 未匹配到企微用户，跳过`);
      result.failed++;
      result.errors.push(`${owner}: 未匹配企微用户`);
      continue;
    }

    const prevItemIds = new Set<string>(
      (() => { try { return (JSON.parse(prev?.payload || '[]') as { id: string }[]).map(i => String(i.id)); } catch { return []; } })()
    );
    const { title, description } = buildCardContent(meeting, bucket, prevItemIds, version);

    try {
      const r = await sendTextCardMessage([userId], title, description, url);
      if (r.success) {
        await saveSnapshot(meeting.id, owner, payload);
        result.sent++;
        console.log(`[WeComActionPush] ✓ ${owner}（${bucket.length}条）`);
      } else {
        result.failed++;
        result.errors.push(`${owner}: ${r.error}`);
        console.error(`[WeComActionPush] ✗ ${owner}:`, r.error);
      }
    } catch (e) {
      result.failed++;
      result.errors.push(`${owner}: ${(e as Error).message}`);
      console.error(`[WeComActionPush] ✗ ${owner}:`, (e as Error).message);
    }
  }

  // 快照里有、本次桶里没有的责任人：清空快照（其行动项已全部处理/移除），不发消息
  for (const [owner, row] of snapshots.entries()) {
    if (!buckets.has(owner) && row.payload && row.payload !== '[]') {
      try {
        await saveSnapshot(meeting.id, owner, '[]');
        console.log(`[WeComActionPush] ${owner} 在本次版本无待处理项，快照已清空`);
      } catch { /* 不影响主流程 */ }
    }
  }

  result.status = result.failed > 0 && result.sent === 0 ? 'failed' : (result.sent > 0 ? 'success' : 'skipped');
  return result;
}

/**
 * 手动推送"批次/导入项"企微提醒：按责任人聚合卡片，带各自 taskIds，点击直达「我的任务」。
 * 无快照幂等（手动触发每次都发），逐收件人写 hyzs_push_log。
 */
export async function pushBatchActionsToWeCom(params: {
  batchId: string;
  batchTitle?: string;
  items: PushItem[];
  triggeredBy?: string;
}): Promise<WeComActionPushResult> {
  const result: WeComActionPushResult = { status: 'skipped', sent: 0, skipped: 0, failed: 0, errors: [] };

  if (process.env.WECOM_ACTION_PUSH_ENABLED === 'false') {
    console.log('[WeComBatchPush] 开关关闭，跳过');
    return result;
  }

  const activeItems = params.items.filter(i => ACTIVE_STATUSES.has(String(i.status || 'pending')));
  if (activeItems.length === 0) return result;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  if (!baseUrl) {
    result.status = 'failed';
    result.errors.push('未配置 NEXT_PUBLIC_APP_URL');
    return result;
  }

  const buckets = new Map<string, PushItem[]>();
  for (const it of activeItems) {
    const owner = String(it.owner || it.assignee || '').trim();
    if (!owner) continue;
    if (!buckets.has(owner)) buckets.set(owner, []);
    buckets.get(owner)!.push(it);
  }

  const nameToUserId = await resolveUserIdsByNames(Array.from(buckets.keys()), false);
  const { recordPushLog } = await import('@/storage/database/push-log-storage');

  for (const [owner, bucket] of buckets.entries()) {
    const taskIds = bucket.map(b => b.id);
    const userId = nameToUserId.get(owner);
    if (!userId) {
      result.failed++;
      result.errors.push(`${owner}: 未匹配企微用户`);
      void recordPushLog({ pushType: 'batch', channel: 'wecom', recipient: owner, taskIds, success: false, error: '企微未匹配到用户' });
      continue;
    }
    const url = `${baseUrl}/kanban?view=my&shared=true&taskIds=${encodeURIComponent(taskIds.join(','))}`;
    const title = `📋 ${params.batchTitle || '行动项'}（${bucket.length}条）`;
    const lines = bucket.slice(0, 4).map((t, i) => `${i + 1}. ${String(t.description || '').slice(0, 26)}`).join('\n');
    const more = bucket.length > 4 ? `\n…共${bucket.length}条` : '';
    const description = `${lines}${more}\n点击填写处理结果`;

    try {
      const r = await sendTextCardMessage([userId], title, description, url);
      if (r.success) {
        result.sent++;
        void recordPushLog({ pushType: 'batch', channel: 'wecom', recipient: owner, taskIds, success: true });
        console.log(`[WeComBatchPush] ✓ ${owner}（${bucket.length}条）`);
      } else {
        result.failed++;
        result.errors.push(`${owner}: ${r.error}`);
        void recordPushLog({ pushType: 'batch', channel: 'wecom', recipient: owner, taskIds, success: false, error: r.error || '发送失败' });
        console.error(`[WeComBatchPush] ✗ ${owner}:`, r.error);
      }
    } catch (e) {
      result.failed++;
      result.errors.push(`${owner}: ${(e as Error).message}`);
      void recordPushLog({ pushType: 'batch', channel: 'wecom', recipient: owner, taskIds, success: false, error: (e as Error).message });
      console.error(`[WeComBatchPush] ✗ ${owner}:`, (e as Error).message);
    }
  }

  result.status = result.failed > 0 && result.sent === 0 ? 'failed' : (result.sent > 0 ? 'success' : 'skipped');
  return result;
}
