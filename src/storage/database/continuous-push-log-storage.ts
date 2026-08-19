import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface ContinuousPushLog {
  id: number;
  meetingType: string;
  triggerSource: 'auto' | 'manual';
  items: number;
  pushed: number;
  failed: number;
  createdAt: string;
}

export interface RecordPushLogInput {
  meetingType: string;
  triggerSource: 'auto' | 'manual';
  items: number;
  pushed: number;
  failed: number;
}

let pool: sql.ConnectionPool | null = null;
let lastErr: Error | null = null;
let lastErrAt = 0;

async function getPool(): Promise<sql.ConnectionPool> {
  if ((!pool || !pool.connected) && lastErr && Date.now() - lastErrAt < 10000) throw lastErr;
  if (!pool || !pool.connected) {
    pool = new sql.ConnectionPool(parseConnectionString());
    try { await pool.connect(); lastErr = null; }
    catch (e) { pool = null; lastErrAt = Date.now(); lastErr = e instanceof Error ? e : new Error(String(e)); throw e; }
    await ensureTable(pool);
  }
  return pool;
}

async function ensureTable(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_continuous_push_log')
    CREATE TABLE hyzs_continuous_push_log (
      id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      meeting_type   NVARCHAR(32)  NOT NULL,
      trigger_source NVARCHAR(8)   NOT NULL,
      items          INT           NOT NULL DEFAULT 0,
      pushed         INT           NOT NULL DEFAULT 0,
      failed         INT           NOT NULL DEFAULT 0,
      created_at     NVARCHAR(30)  NOT NULL
    );
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_pushlog_time' AND object_id=OBJECT_ID('hyzs_continuous_push_log'))
      CREATE INDEX idx_pushlog_time ON hyzs_continuous_push_log(created_at DESC);
  `);
}

export const recordPushLog = async (data: RecordPushLogInput): Promise<ContinuousPushLog | null> => {
  try {
    const p = await getPool();
    const createdAt = new Date().toISOString();
    await p.request()
      .input('meeting_type', sql.NVarChar, data.meetingType)
      .input('trigger_source', sql.NVarChar, data.triggerSource)
      .input('items', sql.Int, data.items)
      .input('pushed', sql.Int, data.pushed)
      .input('failed', sql.Int, data.failed)
      .input('created_at', sql.NVarChar, createdAt)
      .query(`INSERT INTO hyzs_continuous_push_log
        (meeting_type, trigger_source, items, pushed, failed, created_at)
        VALUES (@meeting_type, @trigger_source, @items, @pushed, @failed, @created_at)`);
    return { id: 0, ...data, createdAt };
  } catch (e) {
    console.warn('[PushLog] 记录推送历史失败:', e instanceof Error ? e.message : e);
    return null;
  }
};

export const getPushLogs = async (filters?: {
  meetingType?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: ContinuousPushLog[]; total: number }> => {
  const p = await getPool();
  const page = Math.max(1, filters?.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters?.pageSize || 20));
  const where: string[] = [];
  const req = p.request();
  if (filters?.meetingType) {
    where.push(`meeting_type = @meetingType`);
    req.input('meetingType', sql.NVarChar, filters.meetingType);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const totalRes = await req.query(`SELECT COUNT(*) AS total FROM hyzs_continuous_push_log${whereSql}`);

  const listRes = await req
    .input('limit', sql.Int, pageSize)
    .input('offset', sql.Int, (page - 1) * pageSize)
    .query(`
      SELECT id, meeting_type, trigger_source, items, pushed, failed, created_at
      FROM hyzs_continuous_push_log${whereSql}
      ORDER BY id DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const items = listRes.recordset.map((row): ContinuousPushLog => ({
    id: row.id as number,
    meetingType: String(row.meeting_type || ''),
    triggerSource: row.trigger_source === 'manual' ? 'manual' : 'auto',
    items: (row.items as number) ?? 0,
    pushed: (row.pushed as number) ?? 0,
    failed: (row.failed as number) ?? 0,
    createdAt: String(row.created_at || ''),
  }));

  return { items, total: totalRes.recordset[0]?.total || 0 };
};
