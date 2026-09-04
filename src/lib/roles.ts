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

/** 角色权限判断工具函数（前端显隐与后端 guard 共用此单一数据源） */
export const RoleGuard = {
  /** 可以新建/上传会议、锁定版本 */
  canCreateMeeting: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以查看全部任务看板（非仅我的任务） */
  canViewAllTasks: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以访问行动项台账（全员可见：普通员工仅见责任人/提出人为自己的项，数据层自动过滤） */
  canViewTracking: (role: UserRole) => true,
  /** 可以访问持续项跟进（全员可见：普通员工仅见责任人/提出人为自己的项，数据层自动过滤） */
  canViewContinuous: (role: UserRole) => true,
  /** 可以进行稽核评分 V/X（后端 guardWrite('admin') 实际拦截，manager 仅前端历史口径） */
  canAudit: (role: UserRole) => role === 'admin',
  /** 可以执行结算超期 */
  canSettle: (role: UserRole) => role === 'admin',
  /** 可以重新派发任务 */
  canRedelegate: (role: UserRole) => role === 'admin',
  /** 可以批量导入行动项 */
  canBatchImport: (role: UserRole) => role === 'admin',
  /** 可以手动推送持续项 */
  canPushContinuous: (role: UserRole) => role === 'admin',
  /** 可以配置推送节奏/OA回拉 */
  canManagePushConfig: (role: UserRole) => role === 'admin',
  /** 可以管理组织架构 */
  canManageOrg: (role: UserRole) => role === 'admin',
  /** 可以查看组织架构 */
  canViewOrg: (role: UserRole) => role === 'admin',
  /** 可以访问看板（周例会/月度/产销会） */
  canViewBoard: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以处置反馈（处理/删除） */
  canManageFeedback: (role: UserRole) => role === 'admin',
  /** 可以管理角色名单 */
  canManageRoles: (role: UserRole) => role === 'admin',
};

export type PermissionKey = keyof typeof RoleGuard;

/**
 * 权限扩展点（v1：硬编码角色映射；v2：查 role_permissions 表）
 * 现在实现：系统管理员(chenqiaoxia)恒有权限；其余查 role_permissions 表。
 * guardWrite / 前端显隐统一经此判断，保证"矩阵展示 = 前端显隐 = 后端鉴权"三方同源。
 */
export async function hasPermission(loginid: string, permission: PermissionKey): Promise<boolean> {
  const role = await resolveRole(loginid);
  // 系统管理员：所有权限恒有
  if (await isSystemAdmin(loginid)) return true;
  try {
    const { getRolePermissions } = await import('@/storage/database/role-permission-storage');
    const perms = await getRolePermissions(role);
    return perms[permission] === true;
  } catch (e) {
    // 表不可用 → 降级到硬编码 RoleGuard
    console.warn('[hasPermission] 查库失败，降级硬编码:', e instanceof Error ? e.message : e);
    const guard = RoleGuard[permission];
    return guard ? guard(role) : false;
  }
}

/**
 * 系统管理员：拥有编辑权限矩阵的最高权限，且权限恒有。
 * 名单存 hyzs_system_admins 表，由现任系统管理员自举任命（默认 chenqiaoxia）。
 * admin 角色无权任命系统管理员。
 */
export async function isSystemAdmin(loginid: string | null | undefined): Promise<boolean> {
  try {
    const { isSystemAdminDB } = await import('@/storage/database/system-admin-storage');
    return await isSystemAdminDB(loginid);
  } catch (e) {
    console.warn('[isSystemAdmin] 查库失败，回退默认 chenqiaoxia:', e instanceof Error ? e.message : e);
    return !!(loginid && loginid.trim().toLowerCase() === 'chenqiaoxia');
  }
}

/** 权限矩阵元数据：权限管理页展示用（标签与分组顺序） */
export const PERMISSION_MATRIX: Array<{ key: PermissionKey; label: string; group: string }> = [
  { key: 'canViewBoard', label: '看板（周例会/月度/产销会）', group: '查看' },
  { key: 'canViewTracking', label: '行动项台账', group: '查看' },
  { key: 'canViewContinuous', label: '持续项跟进', group: '查看' },
  { key: 'canViewAllTasks', label: '全部任务看板', group: '查看' },
  { key: 'canViewOrg', label: '组织架构查看', group: '查看' },
  { key: 'canAudit', label: '稽核评分 V/X/0', group: '台账操作' },
  { key: 'canRedelegate', label: '重新派发任务', group: '台账操作' },
  { key: 'canBatchImport', label: '批量导入行动项', group: '台账操作' },
  { key: 'canSettle', label: '超期结算', group: '台账操作' },
  { key: 'canCreateMeeting', label: '创建/归档会议', group: '会议' },
  { key: 'canPushContinuous', label: '手动推送持续项', group: '推送' },
  { key: 'canManagePushConfig', label: '推送/回拉配置', group: '推送' },
  { key: 'canManageOrg', label: '组织架构管理', group: '系统管理' },
  { key: 'canManageFeedback', label: '反馈处置', group: '系统管理' },
  { key: 'canManageRoles', label: '角色名单管理', group: '系统管理' },
];
