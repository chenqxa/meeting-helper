import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface ActionItem {
  id: string;
  projectId?: string | null;
  meetingId?: string | null;
  artifactId?: string | null;
  originalId?: string | null;       // 迁移时保留旧 JSON id，用于去重
  sourceType?: string | null;       // 'meeting' | 'batch'
  sourceId?: string | null;         // 会议ID 或 批次ID
  dueDateType?: string | null;      // 'date' | 'continuous' | 'tbd'

  description: string;
  owner?: string | null;
  ownerLoginId?: string | null;
  ownerOaId?: string | null;
  dept?: string | null;
  proposer?: string | null;        // 提出人（区别于创建人/会议主持）
  proposerLoginId?: string | null;
  proposerOaId?: string | null;
  dueDate?: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'candidate' | 'pending' | 'confirmed' | 'in_progress' | 'done' | 'blocked' | 'cancelled';

  confidenceOwner?: number | null;
  confidenceDate?: number | null;
  sourceText?: string | null;       // AI 提取依据原文（证据）
  initialResult?: string | null;
  reassignedFrom?: string | null;   // 重新派发：新项指向原 X 项 id
  reassignedTo?: string | null;     // 重新派发：原 X 项指向新项 id
  proposerDept?: string | null;     // 提出部门（导入/匹配时的快照）
  cycleDate?: string | null;        // 周期任务：归属周期日期（如持续项每周任务的 YYYY-MM-DD）
  autoFetch?: boolean;              // 持续项「自动取数」标记：开启后不再催人填报，由系统每周定时自动取数（取不到则不写）
  autoFetchSource?: string | null;  // 自动取数绑定的「取数源」key（见 lib/auto-fetch-sources-meta）

  confirmedBy?: string | null;
  confirmedAt?: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
  completionNote?: string | null;
  evidenceFiles?: string[];

  blockReason?: string | null;
  blockedBy?: string | null;
  blockedAt?: string | null;

  oaResult?: string | null;
  oaResultAt?: string | null;
  oaScore?: number | null;
  oaAutoDetected?: boolean;
  oaAttachments?: string[];

  createdAt: string;
  updatedAt: string;
}

let pool: sql.ConnectionPool | null = null;
let lastConnectFailureAt = 0;
let lastConnectFailureError: Error | null = null;
const CONNECT_RETRY_COOLDOWN_MS = 10000;

async function getPool(): Promise<sql.ConnectionPool> {
  if ((!pool || !pool.connected) && lastConnectFailureError && Date.now() - lastConnectFailureAt < CONNECT_RETRY_COOLDOWN_MS) {
    throw lastConnectFailureError;
  }
  if (!pool || !pool.connected) {
    pool = new sql.ConnectionPool(parseConnectionString());
    try {
      await pool.connect();
      lastConnectFailureError = null;
    } catch (error) {
      pool = null; // 重置以便下次重试
      lastConnectFailureAt = Date.now();
      lastConnectFailureError = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
    await ensureTable(pool);
    await ensureTaskBatchesTable(pool);
  }
  return pool;
}

// 优雅关闭连接池
export async function closePool(): Promise<void> {
  if (pool) {
    try {
      await pool.close();
      console.log('[action-storage] Connection pool closed');
    } catch (error) {
      console.error('[action-storage] Error closing pool:', error);
    } finally {
      pool = null;
    }
  }
}

// 在服务器端注册关闭钩子
if (typeof window === 'undefined') {
  const cleanup = async () => {
    console.log('[action-storage] Received shutdown signal, closing connections...');
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

export async function ensureTable(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_action_items')
    CREATE TABLE hyzs_action_items (
      id               NVARCHAR(64)   NOT NULL PRIMARY KEY,
      project_id       NVARCHAR(64)   NULL,
      meeting_id       NVARCHAR(64)   NULL,
      artifact_id      NVARCHAR(64)   NULL,
      original_id      NVARCHAR(128)  NULL,
      description      NVARCHAR(MAX)  NOT NULL,
      owner            NVARCHAR(100)  NULL,
      owner_login_id   NVARCHAR(64)   NULL,
      owner_oa_id      NVARCHAR(64)   NULL,
      dept             NVARCHAR(100)  NULL,
      due_date         NVARCHAR(64)   NULL,
      priority         NVARCHAR(10)   NOT NULL DEFAULT 'medium',
      status           NVARCHAR(20)   NOT NULL DEFAULT 'pending',
      confidence_owner FLOAT          NULL,
      confidence_date  FLOAT          NULL,
      source_text      NVARCHAR(MAX)  NULL,
      initial_result   NVARCHAR(MAX)  NULL,
      confirmed_by     NVARCHAR(100)  NULL,
      confirmed_at     NVARCHAR(64)   NULL,
      completed_by     NVARCHAR(100)  NULL,
      completed_at     NVARCHAR(64)   NULL,
      completion_note  NVARCHAR(MAX)  NULL,
      evidence_files   NVARCHAR(MAX)  NULL,
      block_reason     NVARCHAR(MAX)  NULL,
      blocked_by       NVARCHAR(100)  NULL,
      blocked_at       NVARCHAR(64)   NULL,
      oa_result        NVARCHAR(MAX)  NULL,
      oa_result_at     NVARCHAR(64)   NULL,
      oa_score         FLOAT          NULL,
      oa_auto_detected BIT            NOT NULL DEFAULT 0,
      oa_attachments   NVARCHAR(MAX)  NULL,
      created_at       NVARCHAR(64)   NOT NULL,
      updated_at       NVARCHAR(64)   NOT NULL
    )
  `);

  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'owner_oa_id'
    )
    ALTER TABLE hyzs_action_items ADD owner_oa_id NVARCHAR(64) NULL
  `);

  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'source_type'
    )
    ALTER TABLE hyzs_action_items ADD source_type NVARCHAR(20) NULL
  `);

  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'source_id'
    )
    ALTER TABLE hyzs_action_items ADD source_id NVARCHAR(64) NULL
  `);

  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'due_date_type'
    )
    ALTER TABLE hyzs_action_items ADD due_date_type NVARCHAR(20) NULL
  `);

  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'proposer'
    )
    ALTER TABLE hyzs_action_items ADD proposer NVARCHAR(100) NULL
  `);

  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'proposer_login_id'
    )
    ALTER TABLE hyzs_action_items ADD proposer_login_id NVARCHAR(64) NULL
  `);

  await p.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'proposer_oa_id'
    )
    ALTER TABLE hyzs_action_items ADD proposer_oa_id NVARCHAR(64) NULL
  `);

  // 重新派发双向关联
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'reassigned_from')
    ALTER TABLE hyzs_action_items ADD reassigned_from NVARCHAR(64) NULL
  `);
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'reassigned_to')
    ALTER TABLE hyzs_action_items ADD reassigned_to NVARCHAR(64) NULL
  `);
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'proposer_dept')
    ALTER TABLE hyzs_action_items ADD proposer_dept NVARCHAR(100) NULL
  `);
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'cycle_date')
    ALTER TABLE hyzs_action_items ADD cycle_date NVARCHAR(10) NULL
  `);
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'auto_fetch')
    ALTER TABLE hyzs_action_items ADD auto_fetch INT NULL
  `);
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_action_items') AND name = 'auto_fetch_source')
    ALTER TABLE hyzs_action_items ADD auto_fetch_source NVARCHAR(64) NULL
  `);

  // backfill existing rows
  await p.request().query(`
    UPDATE hyzs_action_items
    SET source_type = 'meeting', source_id = meeting_id
    WHERE source_type IS NULL AND meeting_id IS NOT NULL
  `);
  await p.request().query(`
    UPDATE hyzs_action_items SET due_date_type = 'date'
    WHERE due_date_type IS NULL AND due_date IS NOT NULL
  `);
  await p.request().query(`
    UPDATE hyzs_action_items SET due_date_type = 'tbd'
    WHERE due_date_type IS NULL AND due_date IS NULL
  `);
}

export async function ensureTaskBatchesTable(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_task_batches')
    CREATE TABLE hyzs_task_batches (
      id                   NVARCHAR(64)   NOT NULL PRIMARY KEY,
      title                NVARCHAR(200)  NOT NULL,
      source_channel       NVARCHAR(20)   NULL,
      status               NVARCHAR(20)   NOT NULL DEFAULT 'draft',
      created_by           NVARCHAR(100)  NULL,
      created_by_login_id  NVARCHAR(64)   NULL,
      oa_pushed_at         NVARCHAR(64)   NULL,
      created_at           NVARCHAR(64)   NOT NULL,
      updated_at           NVARCHAR(64)   NOT NULL
    )
  `);
}

// 从会议 JSON 迁移行动项到新表（幂等，可重复执行）
export async function migrateFromMeetings(p: sql.ConnectionPool): Promise<number> {
  const meetingsResult = await p.request().query(`
    SELECT id, action_items FROM hyzs_meetings
    WHERE action_items IS NOT NULL AND action_items != '[]' AND action_items != 'null'
  `);

  let migrated = 0;
  for (const row of meetingsResult.recordset) {
    let items: any[] = [];
    try { items = JSON.parse(row.action_items || '[]'); } catch { continue; }
    if (!Array.isArray(items) || items.length === 0) continue;

    for (const item of items) {
      const originalId = item.id || null;
      const meetingId = row.id;

      // 检查是否已迁移（按 meeting_id + original_id 去重）
      const existing = await p.request()
        .input('mid', sql.NVarChar, meetingId)
        .input('oid', sql.NVarChar, originalId || '')
        .query(`SELECT id FROM hyzs_action_items WHERE meeting_id = @mid AND original_id = @oid`);

      if (existing.recordset.length > 0) continue;

      const id = `ACT_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const now = new Date().toISOString();
      const owner = item.assignee || item.owner || null;
      const dueDate = item.dueDate || item.due_date || null;
      const status = item.status || 'pending';
      const ownerOaId = item.ownerOaId || item.owner_oa_id || null;

      try {
        await p.request()
          .input('id', sql.NVarChar, id)
          .input('project_id', sql.NVarChar, null)
          .input('meeting_id', sql.NVarChar, meetingId)
          .input('original_id', sql.NVarChar, originalId)
          .input('description', sql.NVarChar, item.description || '')
          .input('owner', sql.NVarChar, owner)
          .input('owner_login_id', sql.NVarChar, item.ownerLoginId || null)
          .input('owner_oa_id', sql.NVarChar, ownerOaId)
          .input('dept', sql.NVarChar, item.dept || null)
          .input('due_date', sql.NVarChar, dueDate)
          .input('priority', sql.NVarChar, item.priority || 'medium')
          .input('status', sql.NVarChar, status)
          .input('confidence_owner', sql.Float, item.confidence?.assignee ?? item.confidence_owner ?? null)
          .input('confidence_date', sql.Float, item.confidence?.dueDate ?? item.confidence_date ?? null)
          .input('source_text', sql.NVarChar, item.sourceText || item.source_sentence || null)
          .input('initial_result', sql.NVarChar, item.initialResult || item.initial_result || null)
          .input('confirmed_by', sql.NVarChar, item.confirmed_by || null)
          .input('confirmed_at', sql.NVarChar, item.confirmed_at || null)
          .input('completed_by', sql.NVarChar, item.completed_by || null)
          .input('completed_at', sql.NVarChar, item.completed_at || null)
          .input('completion_note', sql.NVarChar, item.completion_note || null)
          .input('evidence_files', sql.NVarChar, JSON.stringify(item.evidence_files || []))
          .input('block_reason', sql.NVarChar, item.block_reason || null)
          .input('blocked_by', sql.NVarChar, item.blocked_by || null)
          .input('blocked_at', sql.NVarChar, item.blocked_at || null)
          .input('oa_result', sql.NVarChar, item.oa_result || null)
          .input('oa_result_at', sql.NVarChar, item.oa_result_at || null)
          .input('oa_score', sql.Float, item.oa_score ?? null)
          .input('oa_auto_detected', sql.Bit, item.oa_auto_detected ? 1 : 0)
          .input('oa_attachments', sql.NVarChar, JSON.stringify(item.oa_attachments || []))
          .input('created_at', sql.NVarChar, item.created_at || now)
          .input('updated_at', sql.NVarChar, item.updated_at || now)
          .query(`INSERT INTO hyzs_action_items
            (id,project_id,meeting_id,original_id,description,owner,owner_login_id,owner_oa_id,dept,due_date,
             priority,status,confidence_owner,confidence_date,source_text,initial_result,
             confirmed_by,confirmed_at,completed_by,completed_at,completion_note,evidence_files,
             block_reason,blocked_by,blocked_at,oa_result,oa_result_at,oa_score,oa_auto_detected,
             oa_attachments,created_at,updated_at)
            VALUES
            (@id,@project_id,@meeting_id,@original_id,@description,@owner,@owner_login_id,@owner_oa_id,@dept,@due_date,
             @priority,@status,@confidence_owner,@confidence_date,@source_text,@initial_result,
             @confirmed_by,@confirmed_at,@completed_by,@completed_at,@completion_note,@evidence_files,
             @block_reason,@blocked_by,@blocked_at,@oa_result,@oa_result_at,@oa_score,@oa_auto_detected,
             @oa_attachments,@created_at,@updated_at)`);
        migrated++;
      } catch (e) {
        console.warn('[action-migration] 跳过行动项:', item.id, (e as Error).message);
      }
    }
  }
  return migrated;
}

function rowToActionItem(row: any): ActionItem {
  return {
    id: row.id,
    projectId: row.project_id || null,
    meetingId: row.meeting_id || null,
    artifactId: row.artifact_id || null,
    originalId: row.original_id || null,
    sourceType: row.source_type || null,
    sourceId: row.source_id || null,
    dueDateType: row.due_date_type || null,
    description: row.description,
    owner: row.owner || null,
    ownerLoginId: row.owner_login_id || null,
    ownerOaId: row.owner_oa_id || null,
    dept: row.dept || null,
    proposer: row.proposer || null,
    proposerLoginId: row.proposer_login_id || null,
    proposerOaId: row.proposer_oa_id || null,
    dueDate: row.due_date || null,
    priority: row.priority || 'medium',
    status: row.status || 'pending',
    confidenceOwner: row.confidence_owner ?? null,
    confidenceDate: row.confidence_date ?? null,
    sourceText: row.source_text || null,
    initialResult: row.initial_result || null,
    reassignedFrom: row.reassigned_from || null,
    reassignedTo: row.reassigned_to || null,
    proposerDept: row.proposer_dept || null,
    cycleDate: row.cycle_date || null,
    autoFetch: !!row.auto_fetch,
    autoFetchSource: row.auto_fetch_source || null,
    confirmedBy: row.confirmed_by || null,
    confirmedAt: row.confirmed_at || null,
    completedBy: row.completed_by || null,
    completedAt: row.completed_at || null,
    completionNote: row.completion_note || null,
    evidenceFiles: row.evidence_files ? JSON.parse(row.evidence_files) : [],
    blockReason: row.block_reason || null,
    blockedBy: row.blocked_by || null,
    blockedAt: row.blocked_at || null,
    oaResult: row.oa_result || null,
    oaResultAt: row.oa_result_at || null,
    oaScore: row.oa_score ?? null,
    oaAutoDetected: !!row.oa_auto_detected,
    oaAttachments: row.oa_attachments ? JSON.parse(row.oa_attachments) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── 台账列表缓存（远程库延迟高，短期缓存显著提速）──
const LIST_CACHE_TTL_MS = 15_000;
const listCache = new Map<string, { items: ActionItem[]; expAt: number }>();

function listCacheKey(filters?: { projectId?: string; meetingId?: string; status?: string; includeCancelled?: boolean }): string {
  return JSON.stringify({ p: filters?.projectId || '', m: filters?.meetingId || '', s: filters?.status || '', c: !!filters?.includeCancelled });
}

export function invalidateListCache() {
  listCache.clear();
}

export const getAllActionItems = async (filters?: { projectId?: string; meetingId?: string; status?: string; includeCancelled?: boolean }): Promise<ActionItem[]> => {
  const key = listCacheKey(filters);
  const cached = listCache.get(key);
  if (cached && cached.expAt > Date.now()) return cached.items;

  const p = await getPool();
  let query = `SELECT * FROM hyzs_action_items WHERE 1=1`;
  const req = p.request();
  if (filters?.projectId) { query += ` AND project_id = @project_id`; req.input('project_id', sql.NVarChar, filters.projectId); }
  if (filters?.meetingId) { query += ` AND meeting_id = @meeting_id`; req.input('meeting_id', sql.NVarChar, filters.meetingId); }
  if (filters?.status) { query += ` AND status = @status`; req.input('status', sql.NVarChar, filters.status); }
  if (!filters?.includeCancelled) { query += ` AND status != 'cancelled'`; }
  query += ` ORDER BY created_at DESC`;
  const result = await req.query(query);
  const items = result.recordset.map(rowToActionItem);
  listCache.set(key, { items, expAt: Date.now() + LIST_CACHE_TTL_MS });
  return items;
};

export const getActionItemById = async (id: string): Promise<ActionItem | null> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`SELECT * FROM hyzs_action_items WHERE id = @id`);
  return result.recordset[0] ? rowToActionItem(result.recordset[0]) : null;
};

export const getActionItemByMeetingAndOriginalId = async (
  meetingId: string,
  originalId: string
): Promise<ActionItem | null> => {
  if (!meetingId || !originalId) return null;
  const p = await getPool();
  const result = await p.request()
    .input('meeting_id', sql.NVarChar, meetingId)
    .input('original_id', sql.NVarChar, originalId)
    .query(`SELECT * FROM hyzs_action_items WHERE meeting_id = @meeting_id AND original_id = @original_id`);
  return result.recordset[0] ? rowToActionItem(result.recordset[0]) : null;
};

export const getActionItemsByOwner = async (
  owner?: string | null,
  ownerLoginId?: string | null,
  ownerOaId?: string | null
): Promise<ActionItem[]> => {
  const p = await getPool();
  const conditions: string[] = [];
  const params: any = {};

  if (owner) {
    conditions.push('owner = @owner');
    params.owner = owner;
  }
  if (ownerLoginId) {
    conditions.push('owner_login_id = @owner_login_id');
    params.owner_login_id = ownerLoginId;
  }
  if (ownerOaId) {
    conditions.push('owner_oa_id = @owner_oa_id');
    params.owner_oa_id = ownerOaId;
  }

  if (conditions.length === 0) return [];

  const whereClause = conditions.join(' OR ');
  const result = await p.request()
    .input('owner', sql.NVarChar, params.owner || null)
    .input('owner_login_id', sql.NVarChar, params.owner_login_id || null)
    .input('owner_oa_id', sql.NVarChar, params.owner_oa_id || null)
    .query(`SELECT * FROM hyzs_action_items WHERE ${whereClause} ORDER BY due_date ASC, created_at DESC`);

  return result.recordset.map(rowToActionItem);
};

export const createActionItem = async (data: Omit<ActionItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<ActionItem> => {
  const p = await getPool();
  const id = `ACT_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('project_id', sql.NVarChar, data.projectId || null)
    .input('meeting_id', sql.NVarChar, data.meetingId || null)
    .input('artifact_id', sql.NVarChar, data.artifactId || null)
    .input('original_id', sql.NVarChar, data.originalId || null)
    .input('source_type', sql.NVarChar, data.sourceType || null)
    .input('source_id', sql.NVarChar, data.sourceId || null)
    .input('due_date_type', sql.NVarChar, data.dueDateType || null)
    .input('description', sql.NVarChar, data.description)
    .input('owner', sql.NVarChar, data.owner || null)
    .input('owner_login_id', sql.NVarChar, data.ownerLoginId || null)
    .input('owner_oa_id', sql.NVarChar, data.ownerOaId || null)
    .input('dept', sql.NVarChar, data.dept || null)
    .input('proposer', sql.NVarChar, data.proposer || null)
    .input('proposer_login_id', sql.NVarChar, data.proposerLoginId || null)
    .input('proposer_oa_id', sql.NVarChar, data.proposerOaId || null)
    .input('due_date', sql.NVarChar, data.dueDate || null)
    .input('priority', sql.NVarChar, data.priority || 'medium')
    .input('status', sql.NVarChar, data.status || 'pending')
    .input('confidence_owner', sql.Float, data.confidenceOwner ?? null)
    .input('confidence_date', sql.Float, data.confidenceDate ?? null)
    .input('source_text', sql.NVarChar, data.sourceText || null)
    .input('initial_result', sql.NVarChar, data.initialResult || null)
    .input('reassigned_from', sql.NVarChar, data.reassignedFrom || null)
    .input('reassigned_to', sql.NVarChar, data.reassignedTo || null)
    .input('proposer_dept', sql.NVarChar, data.proposerDept || null)
    .input('cycle_date', sql.NVarChar, data.cycleDate || null)
    .input('confirmed_by', sql.NVarChar, data.confirmedBy || null)
    .input('confirmed_at', sql.NVarChar, data.confirmedAt || null)
    .input('completed_by', sql.NVarChar, data.completedBy || null)
    .input('completed_at', sql.NVarChar, data.completedAt || null)
    .input('completion_note', sql.NVarChar, data.completionNote || null)
    .input('evidence_files', sql.NVarChar, JSON.stringify(data.evidenceFiles || []))
    .input('block_reason', sql.NVarChar, data.blockReason || null)
    .input('blocked_by', sql.NVarChar, data.blockedBy || null)
    .input('blocked_at', sql.NVarChar, data.blockedAt || null)
    .input('oa_result', sql.NVarChar, data.oaResult || null)
    .input('oa_result_at', sql.NVarChar, data.oaResultAt || null)
    .input('oa_score', sql.Float, data.oaScore ?? null)
    .input('oa_auto_detected', sql.Bit, data.oaAutoDetected ? 1 : 0)
    .input('oa_attachments', sql.NVarChar, JSON.stringify(data.oaAttachments || []))
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_action_items
      (id,project_id,meeting_id,artifact_id,original_id,source_type,source_id,due_date_type,description,owner,owner_login_id,owner_oa_id,dept,proposer,proposer_login_id,proposer_oa_id,due_date,
       priority,status,confidence_owner,confidence_date,source_text,initial_result,reassigned_from,reassigned_to,proposer_dept,cycle_date,
       confirmed_by,confirmed_at,completed_by,completed_at,completion_note,evidence_files,
       block_reason,blocked_by,blocked_at,oa_result,oa_result_at,oa_score,oa_auto_detected,
       oa_attachments,created_at,updated_at)
    VALUES
      (@id,@project_id,@meeting_id,@artifact_id,@original_id,@source_type,@source_id,@due_date_type,@description,@owner,@owner_login_id,@owner_oa_id,@dept,@proposer,@proposer_login_id,@proposer_oa_id,@due_date,
       @priority,@status,@confidence_owner,@confidence_date,@source_text,@initial_result,@reassigned_from,@reassigned_to,@proposer_dept,@cycle_date,
       @confirmed_by,@confirmed_at,@completed_by,@completed_at,@completion_note,@evidence_files,
       @block_reason,@blocked_by,@blocked_at,@oa_result,@oa_result_at,@oa_score,@oa_auto_detected,
       @oa_attachments,@created_at,@updated_at)`);

  invalidateListCache();
  return { ...data, id, createdAt: now, updatedAt: now };
};


export const updateActionItem = async (id: string, data: Partial<ActionItem>): Promise<ActionItem | null> => {
  const p = await getPool();
  const existing = await getActionItemById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated: ActionItem = { ...existing, ...data, updatedAt: now };

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('description', sql.NVarChar, updated.description)
    .input('project_id', sql.NVarChar, updated.projectId || null)
    .input('source_type', sql.NVarChar, updated.sourceType || null)
    .input('source_id', sql.NVarChar, updated.sourceId || null)
    .input('due_date_type', sql.NVarChar, updated.dueDateType || null)
    .input('owner', sql.NVarChar, updated.owner || null)
    .input('owner_login_id', sql.NVarChar, updated.ownerLoginId || null)
    .input('owner_oa_id', sql.NVarChar, updated.ownerOaId || null)
    .input('dept', sql.NVarChar, updated.dept || null)
    .input('proposer', sql.NVarChar, updated.proposer || null)
    .input('proposer_login_id', sql.NVarChar, updated.proposerLoginId || null)
    .input('proposer_oa_id', sql.NVarChar, updated.proposerOaId || null)
    .input('due_date', sql.NVarChar, updated.dueDate || null)
    .input('priority', sql.NVarChar, updated.priority || 'medium')
    .input('status', sql.NVarChar, updated.status)
    .input('confirmed_by', sql.NVarChar, updated.confirmedBy || null)
    .input('confirmed_at', sql.NVarChar, updated.confirmedAt || null)
    .input('completed_by', sql.NVarChar, updated.completedBy || null)
    .input('completed_at', sql.NVarChar, updated.completedAt || null)
    .input('completion_note', sql.NVarChar, updated.completionNote || null)
    .input('evidence_files', sql.NVarChar, JSON.stringify(updated.evidenceFiles || []))
    .input('block_reason', sql.NVarChar, updated.blockReason || null)
    .input('blocked_by', sql.NVarChar, updated.blockedBy || null)
    .input('blocked_at', sql.NVarChar, updated.blockedAt || null)
    .input('oa_result', sql.NVarChar, updated.oaResult || null)
    .input('oa_result_at', sql.NVarChar, updated.oaResultAt || null)
    .input('oa_score', sql.Float, updated.oaScore ?? null)
    .input('oa_auto_detected', sql.Bit, updated.oaAutoDetected ? 1 : 0)
    .input('oa_attachments', sql.NVarChar, JSON.stringify(updated.oaAttachments || []))
    .input('reassigned_from', sql.NVarChar, updated.reassignedFrom || null)
    .input('reassigned_to', sql.NVarChar, updated.reassignedTo || null)
    .input('proposer_dept', sql.NVarChar, updated.proposerDept || null)
    .input('cycle_date', sql.NVarChar, updated.cycleDate || null)
    .input('updated_at', sql.NVarChar, now)
    .query(`UPDATE hyzs_action_items SET
      description=@description, project_id=@project_id,
      source_type=@source_type, source_id=@source_id, due_date_type=@due_date_type,
      owner=@owner,
      owner_login_id=@owner_login_id, owner_oa_id=@owner_oa_id, dept=@dept,
      proposer=@proposer, proposer_login_id=@proposer_login_id, proposer_oa_id=@proposer_oa_id,
      due_date=@due_date, priority=@priority, status=@status,
      confirmed_by=@confirmed_by, confirmed_at=@confirmed_at,
      completed_by=@completed_by, completed_at=@completed_at,
      completion_note=@completion_note, evidence_files=@evidence_files,
      block_reason=@block_reason, blocked_by=@blocked_by, blocked_at=@blocked_at,
      oa_result=@oa_result, oa_result_at=@oa_result_at, oa_score=@oa_score,
      oa_auto_detected=@oa_auto_detected, oa_attachments=@oa_attachments,
      reassigned_from=@reassigned_from, reassigned_to=@reassigned_to, proposer_dept=@proposer_dept,
      cycle_date=@cycle_date, updated_at=@updated_at
      WHERE id=@id`);

  invalidateListCache();
  return updated;
};

// 开启/关闭持续项「自动取数」标记并绑定取数源（仅 admin；专用轻量更新，不动其他字段）
export const updateActionAutoFetch = async (id: string, enabled: boolean, sourceKey?: string | null): Promise<boolean> => {
  const p = await getPool();
  const now = new Date().toISOString();
  const r = await p.request()
    .input('id', sql.NVarChar, id)
    .input('auto_fetch', sql.Int, enabled ? 1 : 0)
    .input('auto_fetch_source', sql.NVarChar, enabled ? (sourceKey || null) : null)
    .input('updated_at', sql.NVarChar, now)
    .query(`UPDATE hyzs_action_items SET auto_fetch=@auto_fetch, auto_fetch_source=@auto_fetch_source, updated_at=@updated_at WHERE id=@id`);
  invalidateListCache();
  return (r.rowsAffected[0] || 0) > 0;
};

export const deleteActionItem = async (id: string): Promise<boolean> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`DELETE FROM hyzs_action_items WHERE id = @id`);
  invalidateListCache();
  return (result.rowsAffected[0] || 0) > 0;
};

export const deleteActionItemsByMeetingId = async (meetingId: string): Promise<number> => {
  const p = await getPool();
  const result = await p.request()
    .input('meetingId', sql.NVarChar, meetingId)
    .query(`DELETE FROM hyzs_action_items WHERE meeting_id = @meetingId`);
  invalidateListCache();
  return result.rowsAffected[0] || 0;
};
