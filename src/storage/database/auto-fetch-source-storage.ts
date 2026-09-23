import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

// 自定义「取数源」存储：前台可维护 SQL 的源（内置源仍由代码实现，不进此表）
export interface AutoFetchSourceRecord {
  key: string;
  name: string;
  src: string;
  how: string;
  when: string;
  summarySql: string | null;
  detailSql: string | null;
  progressTpl: string | null;
  detailCols: { key: string; label: string; align?: 'text' | 'num' | 'money' }[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
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
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_auto_fetch_sources')
    CREATE TABLE hyzs_auto_fetch_sources (
      [key]          NVARCHAR(64)   NOT NULL PRIMARY KEY,
      name           NVARCHAR(100)  NOT NULL,
      src            NVARCHAR(500)  NULL,
      how            NVARCHAR(MAX)  NULL,
      [when]         NVARCHAR(200)  NULL,
      summary_sql    NVARCHAR(MAX)  NULL,
      detail_sql     NVARCHAR(MAX)  NULL,
      progress_tpl   NVARCHAR(500)  NULL,
      detail_cols    NVARCHAR(MAX)  NULL,
      enabled        INT            NOT NULL DEFAULT 1,
      created_at     NVARCHAR(30)   NOT NULL,
      updated_at     NVARCHAR(30)   NOT NULL
    )
  `);
}

function rowToRecord(row: any): AutoFetchSourceRecord {
  let cols: AutoFetchSourceRecord['detailCols'] = null;
  try { cols = row.detail_cols ? JSON.parse(row.detail_cols) : null; } catch { cols = null; }
  return {
    key: String(row.key || ''),
    name: String(row.name || ''),
    src: String(row.src || ''),
    how: String(row.how || ''),
    when: String(row.when || ''),
    summarySql: row.summary_sql || null,
    detailSql: row.detail_sql || null,
    progressTpl: row.progress_tpl || null,
    detailCols: cols,
    enabled: !!row.enabled,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

export const listCustomSources = async (): Promise<AutoFetchSourceRecord[]> => {
  const p = await getPool();
  const r = await p.request().query(`SELECT * FROM hyzs_auto_fetch_sources ORDER BY updated_at DESC`);
  return r.recordset.map(rowToRecord);
};

export const getCustomSource = async (key: string): Promise<AutoFetchSourceRecord | null> => {
  const p = await getPool();
  const r = await p.request().input('key', sql.NVarChar, key)
    .query(`SELECT * FROM hyzs_auto_fetch_sources WHERE [key] = @key`);
  return r.recordset[0] ? rowToRecord(r.recordset[0]) : null;
};

export const upsertCustomSource = async (data: {
  key: string; name: string; src?: string | null; how?: string | null; when?: string | null;
  summarySql?: string | null; detailSql?: string | null; progressTpl?: string | null;
  detailCols?: unknown; enabled?: boolean;
}): Promise<void> => {
  const p = await getPool();
  const now = new Date().toISOString();
  const colsJson = data.detailCols == null ? null
    : (typeof data.detailCols === 'string' ? data.detailCols : JSON.stringify(data.detailCols));
  await p.request()
    .input('key', sql.NVarChar, data.key)
    .input('name', sql.NVarChar, data.name)
    .input('src', sql.NVarChar, data.src || null)
    .input('how', sql.NVarChar, data.how || null)
    .input('when', sql.NVarChar, data.when || null)
    .input('summary_sql', sql.NVarChar, data.summarySql || null)
    .input('detail_sql', sql.NVarChar, data.detailSql || null)
    .input('progress_tpl', sql.NVarChar, data.progressTpl || null)
    .input('detail_cols', sql.NVarChar, colsJson)
    .input('enabled', sql.Int, data.enabled === false ? 0 : 1)
    .input('now', sql.NVarChar, now)
    .query(`
      MERGE hyzs_auto_fetch_sources AS t
      USING (SELECT @key AS [key]) AS s ON t.[key] = s.[key]
      WHEN MATCHED THEN UPDATE SET name=@name, src=@src, how=@how, [when]=@when,
        summary_sql=@summary_sql, detail_sql=@detail_sql, progress_tpl=@progress_tpl,
        detail_cols=@detail_cols, enabled=@enabled, updated_at=@now
      WHEN NOT MATCHED THEN INSERT ([key], name, src, how, [when], summary_sql, detail_sql, progress_tpl, detail_cols, enabled, created_at, updated_at)
        VALUES (@key, @name, @src, @how, @when, @summary_sql, @detail_sql, @progress_tpl, @detail_cols, @enabled, @now, @now);
    `);
};

export const deleteCustomSource = async (key: string): Promise<boolean> => {
  const p = await getPool();
  const r = await p.request().input('key', sql.NVarChar, key)
    .query(`DELETE FROM hyzs_auto_fetch_sources WHERE [key] = @key`);
  return (r.rowsAffected[0] || 0) > 0;
};
