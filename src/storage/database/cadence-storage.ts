import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface CadenceConfig {
  id: string;
  meetingType: string;
  cadence: 'weekly' | 'monthly';
  triggerDay: number;
  triggerTime: string;
  enabled: boolean;
  lastPushedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_cadence_config')
    CREATE TABLE hyzs_cadence_config (
      id             NVARCHAR(64) NOT NULL PRIMARY KEY,
      meeting_type   NVARCHAR(32) NOT NULL,
      cadence        NVARCHAR(10) NOT NULL,
      trigger_day    INT NOT NULL,
      trigger_time   NVARCHAR(5) NOT NULL,
      enabled        BIT NOT NULL DEFAULT 1,
      last_pushed_at NVARCHAR(30) NULL,
      created_at     NVARCHAR(30) NOT NULL,
      updated_at     NVARCHAR(30) NOT NULL
    );
  `);
}

function rowToConfig(row: any): CadenceConfig {
  return {
    id: row.id, meetingType: row.meeting_type, cadence: row.cadence,
    triggerDay: row.trigger_day, triggerTime: row.trigger_time,
    enabled: !!row.enabled, lastPushedAt: row.last_pushed_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export const getCadenceConfigs = async (): Promise<CadenceConfig[]> => {
  const p = await getPool();
  const result = await p.request().query(`SELECT * FROM hyzs_cadence_config ORDER BY created_at`);
  return result.recordset.map(rowToConfig);
};

export const createCadenceConfig = async (data: Omit<CadenceConfig, 'id' | 'createdAt' | 'updatedAt' | 'lastPushedAt'>): Promise<CadenceConfig> => {
  const p = await getPool();
  const id = `CAD_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();
  await p.request()
    .input('id', sql.NVarChar, id)
    .input('meeting_type', sql.NVarChar, data.meetingType)
    .input('cadence', sql.NVarChar, data.cadence)
    .input('trigger_day', sql.Int, data.triggerDay)
    .input('trigger_time', sql.NVarChar, data.triggerTime)
    .input('enabled', sql.Bit, data.enabled ? 1 : 0)
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_cadence_config (id, meeting_type, cadence, trigger_day, trigger_time, enabled, created_at, updated_at)
      VALUES (@id, @meeting_type, @cadence, @trigger_day, @trigger_time, @enabled, @created_at, @updated_at)`);
  return { ...data, id, lastPushedAt: null, createdAt: now, updatedAt: now };
};

export const updateCadenceConfig = async (id: string, data: Partial<CadenceConfig>): Promise<CadenceConfig | null> => {
  const p = await getPool();
  const existing = await getCadenceConfigs().then(cs => cs.find(c => c.id === id));
  if (!existing) return null;
  const merged = { ...existing, ...data };
  const now = new Date().toISOString();
  await p.request()
    .input('id', sql.NVarChar, id)
    .input('meeting_type', sql.NVarChar, merged.meetingType)
    .input('cadence', sql.NVarChar, merged.cadence)
    .input('trigger_day', sql.Int, merged.triggerDay)
    .input('trigger_time', sql.NVarChar, merged.triggerTime)
    .input('enabled', sql.Bit, merged.enabled ? 1 : 0)
    .input('last_pushed_at', sql.NVarChar, merged.lastPushedAt || null)
    .input('updated_at', sql.NVarChar, now)
    .query(`UPDATE hyzs_cadence_config SET meeting_type=@meeting_type, cadence=@cadence, trigger_day=@trigger_day,
      trigger_time=@trigger_time, enabled=@enabled, last_pushed_at=@last_pushed_at, updated_at=@updated_at WHERE id=@id`);
  return { ...merged, updatedAt: now };
};

export const deleteCadenceConfig = async (id: string): Promise<boolean> => {
  const p = await getPool();
  const result = await p.request().input('id', sql.NVarChar, id)
    .query(`DELETE FROM hyzs_cadence_config WHERE id=@id`);
  return (result.rowsAffected[0] || 0) > 0;
};
