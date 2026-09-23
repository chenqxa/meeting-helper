// 统一推送日志：待办 / 到期提醒 / 打X / 持续项 四类推送的送达记录
// 目的：能回答"推没推、推给谁、成功/失败、为什么失败"
import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export type PushType = 'todo' | 'due_reminder' | 'auto_x' | 'continuous' | 'batch';
export type PushChannel = 'oa' | 'wecom';

export interface PushLogInput {
  pushType: PushType;
  channel: PushChannel;
  meetingType?: string | null;
  recipient?: string | null;
  taskIds?: string[];
  success: boolean;
  error?: string | null;
}

export interface PushLogRow {
  id: string;
  pushType: string;
  channel: string;
  meetingType?: string | null;
  recipient?: string | null;
  taskIds: string[];
  success: boolean;
  error?: string | null;
  createdAt: string;
}

export interface PushLogFilter {
  pushType?: PushType;
  channel?: PushChannel;
  success?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}

let pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = new sql.ConnectionPool(parseConnectionString());
    await pool.connect();
    await ensureTable(pool);
  }
  return pool;
}

async function ensureTable(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_push_log')
    CREATE TABLE hyzs_push_log (
      id           NVARCHAR(64)  NOT NULL PRIMARY KEY,
      push_type    NVARCHAR(32)  NOT NULL,
      channel      NVARCHAR(16)  NOT NULL,
      meeting_type NVARCHAR(32)  NULL,
      recipient    NVARCHAR(128) NULL,
      task_ids     NVARCHAR(MAX) NULL,
      success      BIT           NOT NULL,
      error        NVARCHAR(500) NULL,
      created_at   NVARCHAR(30)  NOT NULL
    );
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_push_log_created')
      CREATE INDEX IX_push_log_created ON hyzs_push_log(created_at);
  `);
}

function rowToLog(row: {
  id: string; push_type: string; channel: string; meeting_type?: string | null;
  recipient?: string | null; task_ids?: string | null; success: boolean | number;
  error?: string | null; created_at: string;
}): PushLogRow {
  let taskIds: string[] = [];
  try { taskIds = row.task_ids ? JSON.parse(row.task_ids) : []; } catch { taskIds = []; }
  return {
    id: row.id,
    pushType: row.push_type,
    channel: row.channel,
    meetingType: row.meeting_type || null,
    recipient: row.recipient || null,
    taskIds,
    success: !!row.success,
    error: row.error || null,
    createdAt: row.created_at,
  };
}

/** 写一条推送日志。best-effort：失败只告警，绝不阻断主推送流程 */
export async function recordPushLog(input: PushLogInput): Promise<void> {
  try {
    const p = await getPool();
    const id = `PL_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await p.request()
      .input('id', sql.NVarChar, id)
      .input('push_type', sql.NVarChar, input.pushType)
      .input('channel', sql.NVarChar, input.channel)
      .input('meeting_type', sql.NVarChar, input.meetingType || null)
      .input('recipient', sql.NVarChar, input.recipient || null)
      .input('task_ids', sql.NVarChar, input.taskIds ? JSON.stringify(input.taskIds) : null)
      .input('success', sql.Bit, input.success ? 1 : 0)
      .input('error', sql.NVarChar, input.error ? String(input.error).slice(0, 500) : null)
      .input('created_at', sql.NVarChar, new Date().toISOString())
      .query(`INSERT INTO hyzs_push_log (id, push_type, channel, meeting_type, recipient, task_ids, success, error, created_at)
              VALUES (@id, @push_type, @channel, @meeting_type, @recipient, @task_ids, @success, @error, @created_at)`);
  } catch (e) {
    console.warn('[push_log] 写日志失败（忽略）:', e instanceof Error ? e.message : e);
  }
}

/** 查询推送日志（管理页用） */
export async function getPushLogs(filter: PushLogFilter = {}): Promise<PushLogRow[]> {
  const p = await getPool();
  const req = p.request();
  const cond: string[] = ['1=1'];
  if (filter.pushType) { cond.push('push_type = @push_type'); req.input('push_type', sql.NVarChar, filter.pushType); }
  if (filter.channel) { cond.push('channel = @channel'); req.input('channel', sql.NVarChar, filter.channel); }
  if (typeof filter.success === 'boolean') { cond.push('success = @success'); req.input('success', sql.Bit, filter.success ? 1 : 0); }
  if (filter.from) { cond.push('created_at >= @from'); req.input('from', sql.NVarChar, filter.from); }
  if (filter.to) { cond.push('created_at <= @to'); req.input('to', sql.NVarChar, filter.to); }
  const limit = Math.min(Math.max(filter.limit || 200, 1), 1000);
  const r = await req.query(`SELECT TOP ${limit} * FROM hyzs_push_log WHERE ${cond.join(' AND ')} ORDER BY created_at DESC`);
  return r.recordset.map(rowToLog);
}
