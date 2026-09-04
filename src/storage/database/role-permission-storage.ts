import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';
import { RoleGuard, PermissionKey, UserRole } from '@/lib/roles';

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
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_role_permissions')
    CREATE TABLE hyzs_role_permissions (
      role           NVARCHAR(20)  NOT NULL,
      permission_key NVARCHAR(64)  NOT NULL,
      allowed        BIT           NOT NULL DEFAULT 1,
      updated_at     NVARCHAR(30)  NULL,
      CONSTRAINT PK_role_permissions PRIMARY KEY (role, permission_key)
    );
  `);
}

/** 权限点种子：默认值 = 当前 RoleGuard 硬编码口径（保证迁移后行为一致） */
const SEED: Array<{ role: UserRole; permissionKey: PermissionKey }> = [];
for (const role of ['admin', 'manager', 'secretary', 'employee'] as UserRole[]) {
  for (const key of Object.keys(RoleGuard) as PermissionKey[]) {
    if (RoleGuard[key](role)) SEED.push({ role, permissionKey: key });
  }
}

/** 初始化/补齐种子（幂等）：仅插入缺失行，不覆盖已有配置。进程内只跑一次 */
let seeded = false;
export async function seedRolePermissions(): Promise<void> {
  if (seeded) return;
  try {
    const p = await getPool();
    for (const s of SEED) {
      await p.request()
        .input('role', sql.NVarChar, s.role)
        .input('pk', sql.NVarChar, s.permissionKey)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM hyzs_role_permissions WHERE role=@role AND permission_key=@pk)
          INSERT INTO hyzs_role_permissions (role, permission_key, allowed, updated_at)
          VALUES (@role, @pk, 1, CONVERT(nvarchar(30), GETDATE(), 120))
        `);
    }
    seeded = true;
  } catch (e) {
    console.warn('[role_permissions] seed 失败:', e instanceof Error ? e.message : e);
  }
}

/** 读取某角色全部权限点（缺省视为 allowed=0，但用种子兜底） */
export async function getRolePermissions(role: string): Promise<Record<string, boolean>> {
  await seedRolePermissions(); // 首次调用时种子，之后进程内跳过
  const p = await getPool();
  const r = await p.request()
    .input('role', sql.NVarChar, role)
    .query(`SELECT permission_key, allowed FROM hyzs_role_permissions WHERE role=@role`);
  const map: Record<string, boolean> = {};
  for (const row of r.recordset) map[row.permission_key] = !!row.allowed;
  // 兜底：RoleGuard 中该角色未配置的行（表里可能没 seed 到）默认 false
  for (const key of Object.keys(RoleGuard) as PermissionKey[]) {
    if (map[key] === undefined) map[key] = false;
  }
  return map;
}

/** 设置某角色某权限点（true=勾选 / false=取消） */
export async function setRolePermission(role: string, permissionKey: string, allowed: boolean): Promise<void> {
  const p = await getPool();
  const exists = await p.request()
    .input('role', sql.NVarChar, role)
    .input('pk', sql.NVarChar, permissionKey)
    .query(`SELECT 1 FROM hyzs_role_permissions WHERE role=@role AND permission_key=@pk`);
  if (exists.recordset.length > 0) {
    await p.request()
      .input('role', sql.NVarChar, role)
      .input('pk', sql.NVarChar, permissionKey)
      .input('allowed', sql.Bit, allowed ? 1 : 0)
      .input('at', sql.NVarChar, new Date().toISOString())
      .query(`UPDATE hyzs_role_permissions SET allowed=@allowed, updated_at=@at WHERE role=@role AND permission_key=@pk`);
  } else {
    await p.request()
      .input('role', sql.NVarChar, role)
      .input('pk', sql.NVarChar, permissionKey)
      .input('allowed', sql.Bit, allowed ? 1 : 0)
      .input('at', sql.NVarChar, new Date().toISOString())
      .query(`INSERT INTO hyzs_role_permissions (role, permission_key, allowed, updated_at) VALUES (@role, @pk, @allowed, @at)`);
  }
}
