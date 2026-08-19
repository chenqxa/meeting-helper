import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface TaskBatch {
  id: string;
  title: string;
  sourceChannel?: string | null;
  status: 'draft' | 'pushed';
  createdBy?: string | null;
  createdByLoginId?: string | null;
  oaPushedAt?: string | null;
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
      pool = null;
      lastConnectFailureAt = Date.now();
      lastConnectFailureError = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }
  return pool;
}

function rowToBatch(row: any): TaskBatch {
  return {
    id: row.id,
    title: row.title,
    sourceChannel: row.source_channel || null,
    status: row.status || 'draft',
    createdBy: row.created_by || null,
    createdByLoginId: row.created_by_login_id || null,
    oaPushedAt: row.oa_pushed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const createTaskBatch = async (data: Omit<TaskBatch, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskBatch> => {
  const p = await getPool();
  const id = `BATCH_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('title', sql.NVarChar, data.title)
    .input('source_channel', sql.NVarChar, data.sourceChannel || null)
    .input('status', sql.NVarChar, data.status || 'draft')
    .input('created_by', sql.NVarChar, data.createdBy || null)
    .input('created_by_login_id', sql.NVarChar, data.createdByLoginId || null)
    .input('oa_pushed_at', sql.NVarChar, data.oaPushedAt || null)
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_task_batches
      (id,title,source_channel,status,created_by,created_by_login_id,oa_pushed_at,created_at,updated_at)
      VALUES (@id,@title,@source_channel,@status,@created_by,@created_by_login_id,@oa_pushed_at,@created_at,@updated_at)`);

  invalidateBatchListCache();
  return { ...data, id, createdAt: now, updatedAt: now };
};

export const getTaskBatchById = async (id: string): Promise<TaskBatch | null> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`SELECT * FROM hyzs_task_batches WHERE id = @id`);
  return result.recordset[0] ? rowToBatch(result.recordset[0]) : null;
};

// ── 批次列表缓存（远程库延迟高）──
const BATCH_CACHE_TTL_MS = 15_000;
let batchListCache: { items: TaskBatch[]; expAt: number } | null = null;

function invalidateBatchListCache() {
  batchListCache = null;
}

export const getAllTaskBatches = async (): Promise<TaskBatch[]> => {
  if (batchListCache && batchListCache.expAt > Date.now()) return batchListCache.items;
  const p = await getPool();
  const result = await p.request()
    .query(`SELECT * FROM hyzs_task_batches ORDER BY created_at DESC`);
  const items = result.recordset.map(rowToBatch);
  batchListCache = { items, expAt: Date.now() + BATCH_CACHE_TTL_MS };
  return items;
};

export const updateTaskBatch = async (id: string, data: Partial<TaskBatch>): Promise<TaskBatch | null> => {
  const p = await getPool();
  const existing = await getTaskBatchById(id);
  if (!existing) return null;

  const updated: TaskBatch = { ...existing, ...data, updatedAt: new Date().toISOString() };
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('title', sql.NVarChar, updated.title)
    .input('source_channel', sql.NVarChar, updated.sourceChannel || null)
    .input('status', sql.NVarChar, updated.status)
    .input('oa_pushed_at', sql.NVarChar, updated.oaPushedAt || null)
    .input('updated_at', sql.NVarChar, now)
    .query(`UPDATE hyzs_task_batches SET
      title=@title, source_channel=@source_channel, status=@status,
      oa_pushed_at=@oa_pushed_at, updated_at=@updated_at
      WHERE id=@id`);

  invalidateBatchListCache();
  return updated;
};

export const deleteTaskBatch = async (id: string): Promise<boolean> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`DELETE FROM hyzs_task_batches WHERE id = @id`);
  return (result.rowsAffected[0] || 0) > 0;
};
