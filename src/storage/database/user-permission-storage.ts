// 人员级权限存储：hyzs_user_permissions 表 CRUD
// 语义：在角色权限矩阵之外，按人追加/撤销任意权限点（覆盖角色默认）。
// 优先级：系统管理员 > 人员级(本表) > 角色级(hyzs_role_permissions) > RoleGuard 硬编码
import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface UserPermissionRecord {
  loginid: string;
  permissionKey: string;
  allowed: boolean;
  updatedAt: string;
  updatedBy?: string | null;
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
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_user_permissions')
    CREATE TABLE hyzs_user_permissions (
      loginid        NVARCHAR(64) NOT NULL,
      permission_key NVARCHAR(64) NOT NULL,
      allowed        BIT NOT NULL DEFAULT 1,
      updated_at     NVARCHAR(30) NOT NULL,
      updated_by     NVARCHAR(64) NULL,
      CONSTRAINT PK_user_permissions PRIMARY KEY (loginid, permission_key)
    );`);
}

// 进程内缓存（TTL 10 分钟，与角色缓存一致）；变更后 clearUserPermissionCache 立即失效
const permCache = new Map<string, { map: Record<string, boolean>; expAt: number }>();
const PERM_TTL_MS = 10 * 60 * 1000;

export function clearUserPermissionCache(loginid?: string) {
  if (loginid) permCache.delete(loginid);
  else permCache.clear();
}

/** 获取某人全部人员级权限（无记录返回空对象） */
export const getUserPermissions = async (loginid: string): Promise<Record<string, boolean>> => {
  const key = String(loginid || '').trim();
  if (!key) return {};
  const cached = permCache.get(key);
  if (cached && cached.expAt > Date.now()) return cached.map;
  try {
    const p = await getPool();
    const r = await p.request()
      .input('loginid', sql.NVarChar, key)
      .query(`SELECT permission_key, allowed FROM hyzs_user_permissions WHERE loginid=@loginid`);
    const map: Record<string, boolean> = {};
    for (const row of r.recordset) map[row.permission_key] = !!row.allowed;
    permCache.set(key, { map, expAt: Date.now() + PERM_TTL_MS });
    return map;
  } catch (e) {
    console.warn('[user_permissions] 读取失败（按空处理）:', e instanceof Error ? e.message : e);
    return {};
  }
};

/** 设置某人某权限点（upsert） */
export const setUserPermission = async (
  loginid: string,
  permissionKey: string,
  allowed: boolean,
  updatedBy?: string,
): Promise<void> => {
  const p = await getPool();
  const now = new Date().toISOString();
  await p.request()
    .input('loginid', sql.NVarChar, loginid)
    .input('pk', sql.NVarChar, permissionKey)
    .input('allowed', sql.Bit, allowed ? 1 : 0)
    .input('updated_at', sql.NVarChar, now)
    .input('updated_by', sql.NVarChar, updatedBy || null)
    .query(`
      MERGE hyzs_user_permissions AS t
      USING (SELECT @loginid AS loginid, @pk AS permission_key) AS s
      ON t.loginid = s.loginid AND t.permission_key = s.permission_key
      WHEN MATCHED THEN
        UPDATE SET allowed = @allowed, updated_at = @updated_at, updated_by = @updated_by
      WHEN NOT MATCHED THEN
        INSERT (loginid, permission_key, allowed, updated_at, updated_by)
        VALUES (@loginid, @pk, @allowed, @updated_at, @updated_by);`);
  clearUserPermissionCache(loginid);
};

/** 清除某人全部人员级权限（恢复角色默认） */
export const clearUserPermissions = async (loginid: string): Promise<number> => {
  const p = await getPool();
  const r = await p.request().input('loginid', sql.NVarChar, loginid)
    .query(`DELETE FROM hyzs_user_permissions WHERE loginid=@loginid`);
  clearUserPermissionCache(loginid);
  return r.rowsAffected[0] || 0;
};

/** 获取全部人员级权限（管理页用） */
export const getAllUserPermissions = async (): Promise<UserPermissionRecord[]> => {
  const p = await getPool();
  const r = await p.request().query(`SELECT * FROM hyzs_user_permissions ORDER BY loginid, permission_key`);
  return r.recordset.map((row: {
    loginid: string; permission_key: string; allowed: boolean | number;
    updated_at: string; updated_by?: string | null;
  }) => ({
    loginid: row.loginid,
    permissionKey: row.permission_key,
    allowed: !!row.allowed,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null,
  }));
};
