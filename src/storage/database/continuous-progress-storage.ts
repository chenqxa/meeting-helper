import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface ProgressRecord {
  id: number;
  actionId: string;
  cycleDate: string;
  dataMonth?: string | null;   // 数据归属月（如 2026-07）：产销会/月会持续项填报归到最近已开会所在月
  oaTaskId: string;
  progress: string | null;
  oaStatus: number | null;
  syncedAt: string;
  source?: string;
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
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_continuous_progress')
    CREATE TABLE hyzs_continuous_progress (
      id          BIGINT IDENTITY(1,1) PRIMARY KEY,
      action_id   NVARCHAR(64) NOT NULL,
      cycle_date  NVARCHAR(10) NOT NULL,
      oa_task_id  NVARCHAR(200) NOT NULL,
      progress    NVARCHAR(MAX) NULL,
      oa_status   INT NULL,
      synced_at   NVARCHAR(30) NOT NULL,
      source      NVARCHAR(20) NULL
    );
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='ux_contprog_task' AND object_id=OBJECT_ID('hyzs_continuous_progress'))
      CREATE UNIQUE INDEX ux_contprog_task ON hyzs_continuous_progress(oa_task_id);
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_contprog_action' AND object_id=OBJECT_ID('hyzs_continuous_progress'))
      CREATE INDEX idx_contprog_action ON hyzs_continuous_progress(action_id, cycle_date DESC);
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_continuous_progress') AND name='source')
      ALTER TABLE hyzs_continuous_progress ADD source NVARCHAR(20) NULL;
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_continuous_progress') AND name='data_month')
      ALTER TABLE hyzs_continuous_progress ADD data_month NVARCHAR(7) NULL;
    -- 唯一键改为 (action_id, cycle_date)：OA 与系统待办同周期覆盖同一条
    IF EXISTS (SELECT * FROM sys.indexes WHERE name='ux_contprog_task' AND object_id=OBJECT_ID('hyzs_continuous_progress'))
      DROP INDEX ux_contprog_task ON hyzs_continuous_progress;
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='ux_contprog_action_cycle' AND object_id=OBJECT_ID('hyzs_continuous_progress'))
      CREATE UNIQUE INDEX ux_contprog_action_cycle ON hyzs_continuous_progress(action_id, cycle_date);
    -- 清理历史：同 (action_id, cycle_date) 的多条，只保留最新一条
    DELETE t
    FROM hyzs_continuous_progress t
    INNER JOIN (
      SELECT action_id, cycle_date, MAX(id) AS keep_id
      FROM hyzs_continuous_progress
      GROUP BY action_id, cycle_date
      HAVING COUNT(*) > 1
    ) d ON t.action_id = d.action_id AND t.cycle_date = d.cycle_date AND t.id <> d.keep_id;
  `);
}

export const upsertContinuousProgress = async (data: {
  actionId: string; cycleDate: string; oaTaskId: string;
  progress: string | null; oaStatus: number | null; source?: string; dataMonth?: string | null;
}): Promise<void> => {
  const p = await getPool();
  const now = new Date().toISOString();
  await p.request()
    .input('action_id', sql.NVarChar, data.actionId)
    .input('cycle_date', sql.NVarChar, data.cycleDate)
    .input('oa_task_id', sql.NVarChar, data.oaTaskId)
    .input('progress', sql.NVarChar, data.progress)
    .input('oa_status', sql.Int, data.oaStatus)
    .input('synced_at', sql.NVarChar, now)
    .input('source', sql.NVarChar, data.source || 'OA')
    .input('data_month', sql.NVarChar, data.dataMonth || null)
    .query(`
      IF EXISTS (SELECT 1 FROM hyzs_continuous_progress WHERE action_id=@action_id AND cycle_date=@cycle_date)
        UPDATE hyzs_continuous_progress SET oa_task_id=@oa_task_id, progress=@progress, oa_status=@oa_status, synced_at=@synced_at, source=@source, data_month=@data_month
        WHERE action_id=@action_id AND cycle_date=@cycle_date
      ELSE
        INSERT INTO hyzs_continuous_progress (action_id, cycle_date, oa_task_id, progress, oa_status, synced_at, source, data_month)
        VALUES (@action_id, @cycle_date, @oa_task_id, @progress, @oa_status, @synced_at, @source, @data_month)
    `);
};

export const getProgressByActionId = async (actionId: string): Promise<ProgressRecord[]> => {
  const p = await getPool();
  const result = await p.request().input('action_id', sql.NVarChar, actionId)
    .query(`SELECT * FROM hyzs_continuous_progress WHERE action_id=@action_id ORDER BY cycle_date DESC`);
  return result.recordset.map(rowToProgress);
};

export const getAllProgress = async (): Promise<Record<string, ProgressRecord[]>> => {
  const p = await getPool();
  const result = await p.request().query(`SELECT * FROM hyzs_continuous_progress ORDER BY cycle_date DESC`);
  const map: Record<string, ProgressRecord[]> = {};
  for (const row of result.recordset) {
    const rec = rowToProgress(row);
    if (!map[rec.actionId]) map[rec.actionId] = [];
    map[rec.actionId].push(rec);
  }
  return map;
};

// actionId → 最新一条进展（用于判断某持续项是否已填报）
export const getContinuousProgressMap = async (): Promise<Record<string, ProgressRecord>> => {
  const p = await getPool();
  const result = await p.request().query(`SELECT * FROM hyzs_continuous_progress ORDER BY cycle_date DESC`);
  const map: Record<string, ProgressRecord> = {};
  for (const row of result.recordset) {
    const rec = rowToProgress(row);
    if (!map[rec.actionId]) map[rec.actionId] = rec;
  }
  return map;
};

function rowToProgress(row: any): ProgressRecord {
  return {
    id: row.id, actionId: row.action_id, cycleDate: row.cycle_date,
    dataMonth: row.data_month || null,
    oaTaskId: row.oa_task_id, progress: row.progress || null,
    oaStatus: row.oa_status ?? null, syncedAt: row.synced_at,
    source: row.source || 'OA',
  };
}
