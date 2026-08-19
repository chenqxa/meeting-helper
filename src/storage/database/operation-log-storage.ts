import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface OperationLogInput {
  operatorLoginId?: string | null;
  operatorName?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  summary?: string | null;
  detail?: string | null;   // JSON 字符串
  ipAddress?: string | null;
}

export interface OperationLog extends OperationLogInput {
  id: number;
  createdAt: string;
}

let pool: sql.ConnectionPool | null = null;
let lastConnectFailureAt = 0;
let lastConnectFailureError: Error | null = null;
const CONNECT_RETRY_COOLDOWN_MS = 10000;

export async function ensureTable(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_operation_logs')
    CREATE TABLE hyzs_operation_logs (
      id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      operator_login_id NVARCHAR(64)  NULL,
      operator_name     NVARCHAR(64)  NULL,
      action            NVARCHAR(32)  NOT NULL,
      target_type       NVARCHAR(32)  NULL,
      target_id         NVARCHAR(64)  NULL,
      summary           NVARCHAR(500) NULL,
      detail            NVARCHAR(MAX) NULL,
      ip_address        NVARCHAR(45)  NULL,
      created_at        NVARCHAR(30)  NOT NULL
    );
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_oplog_time' AND object_id=OBJECT_ID('hyzs_operation_logs'))
      CREATE INDEX idx_oplog_time ON hyzs_operation_logs(created_at DESC);
  `);
}

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
    await ensureTable(pool);
  }
  return pool;
}

export const createOperationLog = async (data: OperationLogInput): Promise<OperationLog> => {
  const p = await getPool();
  const now = new Date().toISOString();
  const result = await p.request()
    .input('operator_login_id', sql.NVarChar, data.operatorLoginId || null)
    .input('operator_name', sql.NVarChar, data.operatorName || null)
    .input('action', sql.NVarChar, data.action)
    .input('target_type', sql.NVarChar, data.targetType || null)
    .input('target_id', sql.NVarChar, data.targetId || null)
    .input('summary', sql.NVarChar, data.summary || null)
    .input('detail', sql.NVarChar, data.detail || null)
    .input('ip_address', sql.NVarChar, data.ipAddress || null)
    .input('created_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_operation_logs
      (operator_login_id, operator_name, action, target_type, target_id, summary, detail, ip_address, created_at)
      VALUES
      (@operator_login_id, @operator_name, @action, @target_type, @target_id, @summary, @detail, @ip_address, @created_at);
      SELECT SCOPE_IDENTITY() AS id;`);
  const id = Number(result.recordset[0]?.id || 0);
  return { ...data, id, createdAt: now };
};

export const getOperationLogs = async (filters?: {
  operator?: string;
  action?: string;
  start?: string;
  end?: string;
  meetingId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: OperationLog[]; total: number }> => {
  const p = await getPool();
  const page = Math.max(1, filters?.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters?.pageSize || 20));
  const where: string[] = [];
  const req = p.request();
  if (filters?.operator) {
    where.push(`(operator_login_id LIKE @op OR operator_name LIKE @op)`);
    req.input('op', sql.NVarChar, `%${filters.operator}%`);
  }
  if (filters?.action) {
    where.push(`action = @action`);
    req.input('action', sql.NVarChar, filters.action);
  }
  if (filters?.start) {
    where.push(`created_at >= @start`);
    req.input('start', sql.NVarChar, filters.start);
  }
  if (filters?.end) {
    where.push(`created_at <= @end`);
    req.input('end', sql.NVarChar, filters.end);
  }
  if (filters?.meetingId) {
    where.push(`target_id = @meetingId`);
    req.input('meetingId', sql.NVarChar, filters.meetingId);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const totalRes = await req.query(`SELECT COUNT(*) AS total FROM hyzs_operation_logs${whereSql}`);

  const listRes = await req
    .input('limit', sql.Int, pageSize)
    .input('offset', sql.Int, (page - 1) * pageSize)
    .query(`
      SELECT id, operator_login_id, operator_name, action, target_type, target_id, summary, detail, ip_address, created_at
      FROM hyzs_operation_logs${whereSql}
      ORDER BY created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

  const items = listRes.recordset.map((row: any) => ({
    id: row.id,
    operatorLoginId: row.operator_login_id,
    operatorName: row.operator_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    summary: row.summary,
    detail: row.detail ? (() => { try { return JSON.parse(row.detail); } catch { return row.detail; } })() : null,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  }));

  return { items, total: totalRes.recordset[0]?.total || 0 };
};
