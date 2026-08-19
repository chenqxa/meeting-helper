import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface OaPullConfig {
  id: string;
  enabled: boolean;
  // 调度：cron 表达式（五/六段式），空则用 intervalMin 兜底
  cronExpr: string;
  intervalMin: number;
  // 增量同步开关
  incremental: boolean;
  // 失败重试：最多重试次数 + 重试退避基数（分钟，指数退避）
  maxRetries: number;
  retryBaseMin: number;
  // 连续失败 N 次触发告警
  alertAfterFails: number;
  // 告警收件人（OA 姓名，逗号分隔）
  alertRecipients: string;
  // 状态
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'failed' | 'running' | null;
  lastRunDetail: string | null;
  nextRunAt: string | null;
  consecutiveFails: number;
  lastCursorAt: string | null;   // 增量游标（上次成功同步时间）
  updatedAt: string;
}

export interface OaPullRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'success' | 'failed' | 'running';
  mode: 'scheduled' | 'manual' | 'retry' | 'startup';
  synced: number;
  error: string | null;
  detail: string | null;
}

let pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = new sql.ConnectionPool(parseConnectionString());
    await pool.connect();
    await ensureTables(pool);
  }
  return pool;
}

async function ensureTables(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_oa_pull_config')
    CREATE TABLE hyzs_oa_pull_config (
      id                 NVARCHAR(64) NOT NULL PRIMARY KEY,
      enabled            BIT NOT NULL DEFAULT 1,
      cron_expr          NVARCHAR(64) NULL,
      interval_min       INT NOT NULL DEFAULT 30,
      incremental        BIT NOT NULL DEFAULT 1,
      max_retries        INT NOT NULL DEFAULT 3,
      retry_base_min     INT NOT NULL DEFAULT 5,
      alert_after_fails  INT NOT NULL DEFAULT 3,
      alert_recipients   NVARCHAR(500) NULL,
      last_run_at        NVARCHAR(30) NULL,
      last_run_status    NVARCHAR(10) NULL,
      last_run_detail    NVARCHAR(MAX) NULL,
      next_run_at        NVARCHAR(30) NULL,
      consecutive_fails  INT NOT NULL DEFAULT 0,
      last_cursor_at     NVARCHAR(30) NULL,
      updated_at         NVARCHAR(30) NOT NULL
    );

    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_oa_pull_runs')
    CREATE TABLE hyzs_oa_pull_runs (
      id          BIGINT IDENTITY(1,1) PRIMARY KEY,
      started_at  NVARCHAR(30) NOT NULL,
      finished_at NVARCHAR(30) NULL,
      status      NVARCHAR(10) NOT NULL,
      mode        NVARCHAR(10) NOT NULL,
      synced      INT NOT NULL DEFAULT 0,
      error       NVARCHAR(MAX) NULL,
      detail      NVARCHAR(MAX) NULL
    );
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_pull_runs_time' AND object_id=OBJECT_ID('hyzs_oa_pull_runs'))
      CREATE INDEX idx_pull_runs_time ON hyzs_oa_pull_runs(started_at DESC);
  `);
  // 兼容旧表：若 hyzs_oa_pull_config 已存在（第一版只有基础列），补齐新列
  await p.request().query(`
    IF EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_oa_pull_config') BEGIN
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='cron_expr')
        ALTER TABLE hyzs_oa_pull_config ADD cron_expr NVARCHAR(64) NULL;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='incremental')
        ALTER TABLE hyzs_oa_pull_config ADD incremental BIT NOT NULL DEFAULT 1;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='max_retries')
        ALTER TABLE hyzs_oa_pull_config ADD max_retries INT NOT NULL DEFAULT 3;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='retry_base_min')
        ALTER TABLE hyzs_oa_pull_config ADD retry_base_min INT NOT NULL DEFAULT 5;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='alert_after_fails')
        ALTER TABLE hyzs_oa_pull_config ADD alert_after_fails INT NOT NULL DEFAULT 3;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='alert_recipients')
        ALTER TABLE hyzs_oa_pull_config ADD alert_recipients NVARCHAR(500) NULL;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='last_run_at')
        ALTER TABLE hyzs_oa_pull_config ADD last_run_at NVARCHAR(30) NULL;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='last_run_status')
        ALTER TABLE hyzs_oa_pull_config ADD last_run_status NVARCHAR(10) NULL;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='last_run_detail')
        ALTER TABLE hyzs_oa_pull_config ADD last_run_detail NVARCHAR(MAX) NULL;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='next_run_at')
        ALTER TABLE hyzs_oa_pull_config ADD next_run_at NVARCHAR(30) NULL;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='consecutive_fails')
        ALTER TABLE hyzs_oa_pull_config ADD consecutive_fails INT NOT NULL DEFAULT 0;
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_oa_pull_config') AND name='last_cursor_at')
        ALTER TABLE hyzs_oa_pull_config ADD last_cursor_at NVARCHAR(30) NULL;
    END
  `);
}

function rowToConfig(row: any): OaPullConfig {
  return {
    id: row.id,
    enabled: !!row.enabled,
    cronExpr: row.cron_expr || '',
    intervalMin: row.interval_min ?? 30,
    incremental: !!row.incremental,
    maxRetries: row.max_retries ?? 3,
    retryBaseMin: row.retry_base_min ?? 5,
    alertAfterFails: row.alert_after_fails ?? 3,
    alertRecipients: row.alert_recipients || '',
    lastRunAt: row.last_run_at || null,
    lastRunStatus: row.last_run_status || null,
    lastRunDetail: row.last_run_detail || null,
    nextRunAt: row.next_run_at || null,
    consecutiveFails: row.consecutive_fails ?? 0,
    lastCursorAt: row.last_cursor_at || null,
    updatedAt: row.updated_at,
  };
}

// 读取回拉配置；无记录时用环境变量兜底并初始化一条
export async function getOaPullConfig(): Promise<OaPullConfig> {
  const p = await getPool();
  const result = await p.request().query(`SELECT TOP 1 * FROM hyzs_oa_pull_config ORDER BY updated_at DESC`);
  const row = result.recordset[0];
  if (row) return rowToConfig(row);

  const defaultMin = parseInt(process.env.OA_PULL_INTERVAL_MIN || '30', 10);
  const id = 'OA_PULL_DEFAULT';
  const now = new Date().toISOString();
  await p.request()
    .input('id', sql.NVarChar, id)
    .input('enabled', sql.Bit, 1)
    .input('interval_min', sql.Int, defaultMin)
    .input('incremental', sql.Bit, 1)
    .input('max_retries', sql.Int, 3)
    .input('retry_base_min', sql.Int, 5)
    .input('alert_after_fails', sql.Int, 3)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_oa_pull_config (id, enabled, interval_min, incremental, max_retries, retry_base_min, alert_after_fails, updated_at)
      VALUES (@id, @enabled, @interval_min, @incremental, @max_retries, @retry_base_min, @alert_after_fails, @updated_at)`);
  return {
    id, enabled: true, cronExpr: '', intervalMin: defaultMin, incremental: true,
    maxRetries: 3, retryBaseMin: 5, alertAfterFails: 3, alertRecipients: '',
    lastRunAt: null, lastRunStatus: null, lastRunDetail: null, nextRunAt: null,
    consecutiveFails: 0, lastCursorAt: null, updatedAt: now,
  };
}

// 更新配置（白名单字段）
export async function updateOaPullConfig(data: {
  enabled?: boolean;
  cronExpr?: string;
  intervalMin?: number;
  incremental?: boolean;
  maxRetries?: number;
  retryBaseMin?: number;
  alertAfterFails?: number;
  alertRecipients?: string;
}): Promise<OaPullConfig> {
  const p = await getPool();
  const existing = await getOaPullConfig();
  const now = new Date().toISOString();
  const merged = {
    enabled: data.enabled !== undefined ? data.enabled : existing.enabled,
    cronExpr: data.cronExpr !== undefined ? data.cronExpr : existing.cronExpr,
    intervalMin: data.intervalMin !== undefined ? Math.max(1, Math.min(1440, data.intervalMin)) : existing.intervalMin,
    incremental: data.incremental !== undefined ? data.incremental : existing.incremental,
    maxRetries: data.maxRetries !== undefined ? Math.max(0, Math.min(10, data.maxRetries)) : existing.maxRetries,
    retryBaseMin: data.retryBaseMin !== undefined ? Math.max(1, data.retryBaseMin) : existing.retryBaseMin,
    alertAfterFails: data.alertAfterFails !== undefined ? Math.max(1, data.alertAfterFails) : existing.alertAfterFails,
    alertRecipients: data.alertRecipients !== undefined ? data.alertRecipients : existing.alertRecipients,
  };
  await p.request()
    .input('id', sql.NVarChar, existing.id)
    .input('enabled', sql.Bit, merged.enabled ? 1 : 0)
    .input('cron_expr', sql.NVarChar, merged.cronExpr)
    .input('interval_min', sql.Int, merged.intervalMin)
    .input('incremental', sql.Bit, merged.incremental ? 1 : 0)
    .input('max_retries', sql.Int, merged.maxRetries)
    .input('retry_base_min', sql.Int, merged.retryBaseMin)
    .input('alert_after_fails', sql.Int, merged.alertAfterFails)
    .input('alert_recipients', sql.NVarChar, merged.alertRecipients)
    .input('updated_at', sql.NVarChar, now)
    .query(`UPDATE hyzs_oa_pull_config SET enabled=@enabled, cron_expr=@cron_expr, interval_min=@interval_min,
      incremental=@incremental, max_retries=@max_retries, retry_base_min=@retry_base_min,
      alert_after_fails=@alert_after_fails, alert_recipients=@alert_recipients, updated_at=@updated_at WHERE id=@id`);
  return { ...existing, ...merged, updatedAt: now };
}

// 更新运行状态/游标（调度器内部使用）
export async function updateOaPullRuntime(data: {
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'failed' | 'running' | null;
  lastRunDetail?: string | null;
  nextRunAt?: string | null;
  consecutiveFails?: number;
  lastCursorAt?: string | null;
}): Promise<void> {
  const p = await getPool();
  const cfg = await getOaPullConfig();
  await p.request()
    .input('id', sql.NVarChar, cfg.id)
    .input('last_run_at', sql.NVarChar, data.lastRunAt ?? cfg.lastRunAt)
    .input('last_run_status', sql.NVarChar, data.lastRunStatus ?? cfg.lastRunStatus)
    .input('last_run_detail', sql.NVarChar, data.lastRunDetail ?? cfg.lastRunDetail)
    .input('next_run_at', sql.NVarChar, data.nextRunAt ?? cfg.nextRunAt)
    .input('consecutive_fails', sql.Int, data.consecutiveFails ?? cfg.consecutiveFails)
    .input('last_cursor_at', sql.NVarChar, data.lastCursorAt ?? cfg.lastCursorAt)
    .query(`UPDATE hyzs_oa_pull_config SET last_run_at=@last_run_at, last_run_status=@last_run_status,
      last_run_detail=@last_run_detail, next_run_at=@next_run_at, consecutive_fails=@consecutive_fails,
      last_cursor_at=@last_cursor_at WHERE id=@id`);
}

// ── 执行历史 ──
export async function recordRunStart(mode: 'scheduled' | 'manual' | 'retry' | 'startup'): Promise<{ id: number; startedAt: string }> {
  const p = await getPool();
  const now = new Date().toISOString();
  const result = await p.request()
    .input('started_at', sql.NVarChar, now)
    .input('status', sql.NVarChar, 'running')
    .input('mode', sql.NVarChar, mode)
    .query(`INSERT INTO hyzs_oa_pull_runs (started_at, status, mode, synced) VALUES (@started_at, @status, @mode, 0);
      SELECT SCOPE_IDENTITY() AS id;`);
  const id = result.recordset[0]?.id;
  return { id, startedAt: now };
}

export async function recordRunFinish(runId: number, data: {
  status: 'success' | 'failed';
  synced?: number;
  error?: string | null;
  detail?: string | null;
}): Promise<void> {
  const p = await getPool();
  const now = new Date().toISOString();
  await p.request()
    .input('id', sql.Int, runId)
    .input('finished_at', sql.NVarChar, now)
    .input('status', sql.NVarChar, data.status)
    .input('synced', sql.Int, data.synced ?? 0)
    .input('error', sql.NVarChar, data.error ?? null)
    .input('detail', sql.NVarChar, data.detail ?? null)
    .query(`UPDATE hyzs_oa_pull_runs SET finished_at=@finished_at, status=@status, synced=@synced, error=@error, detail=@detail WHERE id=@id`);
}

export async function getOaPullRuns(limit = 20): Promise<OaPullRun[]> {
  const p = await getPool();
  const result = await p.request().input('limit', sql.Int, limit)
    .query(`SELECT TOP (@limit) id, started_at, finished_at, status, mode, synced, error, detail FROM hyzs_oa_pull_runs ORDER BY id DESC`);
  return result.recordset.map((row: any) => ({
    id: row.id, startedAt: row.started_at, finishedAt: row.finished_at,
    status: row.status, mode: row.mode, synced: row.synced, error: row.error, detail: row.detail,
  }));
}
