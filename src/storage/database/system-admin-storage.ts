import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

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
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_system_admins')
    CREATE TABLE hyzs_system_admins (
      loginid     NVARCHAR(64) NOT NULL PRIMARY KEY,
      added_at    NVARCHAR(30) NULL
    );
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('hyzs_system_admins') AND name='added_at')
      ALTER TABLE hyzs_system_admins ADD added_at NVARCHAR(30) NULL;
  `);
  // 种子：确保默认系统管理员 chenqiaoxia 始终在表中（避免仅依赖"空表默认"导致添加他人后自己失权）
  await p.request().input('loginid', sql.NVarChar, DEFAULT_SYSTEM_ADMIN).query(`
    IF NOT EXISTS (SELECT 1 FROM hyzs_system_admins WHERE loginid=@loginid)
    INSERT INTO hyzs_system_admins (loginid, added_at) VALUES (@loginid, CONVERT(nvarchar(30), GETDATE(), 120))
  `);
}

/** 默认系统管理员（首次建表时种子） */
const DEFAULT_SYSTEM_ADMIN = 'chenqiaoxia';

/** 读取系统管理员名单（表不存在/为空时回退默认 chenqiaoxia） */
export async function getSystemAdmins(): Promise<string[]> {
  try {
    const p = await getPool();
    const r = await p.request().query(`SELECT loginid FROM hyzs_system_admins ORDER BY added_at`);
    const list = r.recordset.map(x => String(x.loginid).trim()).filter(Boolean);
    if (list.length === 0) return [DEFAULT_SYSTEM_ADMIN]; // 空表 → 默认
    return list;
  } catch (e) {
    console.warn('[system_admins] 读取失败，回退默认:', e instanceof Error ? e.message : e);
    return [DEFAULT_SYSTEM_ADMIN];
  }
}

/** 是否系统管理员 */
export async function isSystemAdminDB(loginid: string | null | undefined): Promise<boolean> {
  if (!loginid) return false;
  const id = loginid.trim().toLowerCase();
  const list = await getSystemAdmins();
  return list.some(x => x.trim().toLowerCase() === id);
}

/** 添加系统管理员（由现任系统管理员调用） */
export async function addSystemAdmin(loginid: string): Promise<void> {
  const p = await getPool();
  await p.request()
    .input('loginid', sql.NVarChar, loginid.trim())
    .input('at', sql.NVarChar, new Date().toISOString())
    .query(`
      IF NOT EXISTS (SELECT 1 FROM hyzs_system_admins WHERE loginid=@loginid)
      INSERT INTO hyzs_system_admins (loginid, added_at) VALUES (@loginid, @at)
    `);
}

/** 移除系统管理员（由现任系统管理员调用，但须保证至少剩1人） */
export async function removeSystemAdmin(loginid: string): Promise<{ ok: boolean; error?: string }> {
  const list = await getSystemAdmins();
  const target = loginid.trim();
  const exists = list.some(x => x.trim() === target);
  if (!exists) return { ok: true }; // 本就不在
  // 防呆：移除后不能为空
  const remaining = list.filter(x => x.trim() !== target);
  if (remaining.length === 0) return { ok: false, error: '至少保留一名系统管理员' };
  const p = await getPool();
  await p.request().input('loginid', sql.NVarChar, target)
    .query(`DELETE FROM hyzs_system_admins WHERE loginid=@loginid`);
  return { ok: true };
}
