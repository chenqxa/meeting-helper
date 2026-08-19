import sql from 'mssql';

export type UserRole = 'admin' | 'manager' | 'secretary' | 'employee';

// 进程内缓存，TTL 10分钟
const roleCache = new Map<string, { role: UserRole; expAt: number }>();
const ROLE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_ROLE_ENV_KEYS: Array<[UserRole, string]> = [
  ['admin', 'DEFAULT_ADMIN_LOGINIDS'],
  ['manager', 'DEFAULT_MANAGER_LOGINIDS'],
  ['secretary', 'DEFAULT_SECRETARY_LOGINIDS'],
];

function resolveRoleFromEnv(loginid: string): UserRole | null {
  const normalized = loginid?.trim().toLowerCase();
  if (!normalized) return null;

  for (const [role, envKey] of DEFAULT_ROLE_ENV_KEYS) {
    const raw = process.env[envKey];
    if (!raw) continue;
    const candidates = raw
      .split(/[,;\s]+/)
      .map(v => v.trim().toLowerCase())
      .filter(Boolean);
    if (candidates.includes(normalized)) return role;
  }

  return null;
}

function cacheRole(loginid: string, role: UserRole) {
  roleCache.set(loginid, { role, expAt: Date.now() + ROLE_TTL_MS });
}

/** 根据 loginid 解析用户角色，优先级：缓存 > SQL 查询 > 默认 employee */
export async function resolveRole(loginid: string): Promise<UserRole> {
  // 命中缓存
  const cached = roleCache.get(loginid);
  if (cached && cached.expAt > Date.now()) return cached.role;

  const envRole = resolveRoleFromEnv(loginid);
  if (envRole) {
    cacheRole(loginid, envRole);
    return envRole;
  }

  if (!process.env.DATABASE_URL) return 'employee';
  try {
    const { getPool } = await import('@/storage/database/sqlserver-storage');
    const pool = await getPool();
    const result = await pool.request()
      .input('loginid', sql.VarChar(50), loginid)
      .query('SELECT role FROM hyzs_user_roles WHERE loginid = @loginid');
    const role: UserRole = result.recordset.length > 0
      ? result.recordset[0].role as UserRole
      : 'employee';
    cacheRole(loginid, role);
    return role;
  } catch (err) {
    console.error(`[resolveRole] SQL error for ${loginid}:`, err);
  }
  return 'employee';
}

/** 清除某用户的角色缓存（权限变更后调用）*/
export function clearRoleCache(loginid?: string) {
  if (loginid) roleCache.delete(loginid);
  else roleCache.clear();
}

/** 角色权限判断工具函数 */
export const RoleGuard = {
  /** 可以新建/上传会议、锁定版本 */
  canCreateMeeting: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以查看全部任务看板（非仅我的任务） */
  canViewAllTasks: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以访问行动项台账 */
  canViewTracking: (role: UserRole) => role === 'admin' || role === 'manager',
  /** 可以进行稽核评分 V/X */
  canAudit: (role: UserRole) => role === 'admin' || role === 'manager',
  /** 可以执行结算超期 */
  canSettle: (role: UserRole) => role === 'admin',
  /** 可以重新派发任务 */
  canRedelegate: (role: UserRole) => role === 'admin' || role === 'manager',
  /** 可以管理组织架构 */
  canManageOrg: (role: UserRole) => role === 'admin',
  /** 可以查看组织架构 */
  canViewOrg: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
};
