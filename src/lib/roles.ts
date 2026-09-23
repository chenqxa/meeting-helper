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
      .input('loginid', sql.NVarChar(64), loginid)
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
  /** 可以新建会议（默认全员可建，2026-09-18 确认） */
  canCreateMeeting: () => true,
  /** 可以归档/锁定会议（admin/manager/secretary；会议创建人另有资源条件放行） */
  canLockMeeting: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以解锁已归档会议（仅 admin/manager） */
  canUnlockMeeting: (role: UserRole) => role === 'admin' || role === 'manager',
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
  /** 可以修改行动项责任人（admin/manager；会议主持人另有资源条件放行） */
  canEditActionOwner: (role: UserRole) => role === 'admin' || role === 'manager',
  /** 可以批量导入行动项 */
  canBatchImport: (role: UserRole) => role === 'admin',
  /** 可以手动推送持续项 */
  canPushContinuous: (role: UserRole) => role === 'admin',
  /** 可以手动推送批次/导入项的企微提醒 */
  canPushBatch: (role: UserRole) => role === 'admin',
  /** 可以配置推送节奏/OA回拉 */
  canManagePushConfig: (role: UserRole) => role === 'admin',
  /** 可以管理组织架构 */
  canManageOrg: (role: UserRole) => role === 'admin',
  /** 可以查看组织架构 */
  canViewOrg: (role: UserRole) => role === 'admin',
  /** 可以访问看板（周例会/月度/产销会）——总开关 */
  canViewBoard: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以访问周例会看板 */
  canViewWeeklyBoard: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以访问月度看板 */
  canViewMonthlyBoard: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以访问产销会看板 */
  canViewProductionBoard: (role: UserRole) => role === 'admin' || role === 'manager' || role === 'secretary',
  /** 可以处置反馈（处理/删除） */
  canManageFeedback: (role: UserRole) => role === 'admin',
  /** 可以管理角色名单 */
  canManageRoles: (role: UserRole) => role === 'admin',
};

export type PermissionKey = keyof typeof RoleGuard;

export interface EffectivePermissions {
  isSystemAdmin: boolean;
  role: UserRole;
  perms: Record<string, boolean>;
}

/**
 * 计算用户"生效权限点"，优先级：
 *   系统管理员 > 人员级覆盖(hyzs_user_permissions) > 角色矩阵(hyzs_role_permissions) > RoleGuard 硬编码
 * 前后端/守卫统一经此，保证"矩阵展示 = 前端显隐 = 后端鉴权"三方同源。
 */
export async function getEffectivePermissions(loginid: string): Promise<EffectivePermissions> {
  // 系统管理员：所有权限恒有
  if (await isSystemAdmin(loginid)) {
    const perms: Record<string, boolean> = {};
    for (const key of Object.keys(RoleGuard) as PermissionKey[]) perms[key] = true;
    return { isSystemAdmin: true, role: 'admin', perms };
  }
  const role = await resolveRole(loginid);

  // 角色矩阵（表不可用 → RoleGuard 降级）
  let rolePerms: Record<string, boolean> = {};
  try {
    const { getRolePermissions } = await import('@/storage/database/role-permission-storage');
    rolePerms = await getRolePermissions(role);
  } catch (e) {
    console.warn('[getEffectivePermissions] 角色权限查库失败，降级硬编码:', e instanceof Error ? e.message : e);
    for (const key of Object.keys(RoleGuard) as PermissionKey[]) rolePerms[key] = RoleGuard[key](role);
  }

  // 人员级覆盖（按人追加/撤销任意权限点）
  let userPerms: Record<string, boolean> = {};
  try {
    const { getUserPermissions } = await import('@/storage/database/user-permission-storage');
    userPerms = await getUserPermissions(loginid);
  } catch (e) {
    console.warn('[getEffectivePermissions] 人员级权限读取失败，忽略:', e instanceof Error ? e.message : e);
  }

  return { isSystemAdmin: false, role, perms: { ...rolePerms, ...userPerms } };
}

/**
 * 单权限点判定（守卫/前端显隐用）。内部走 getEffectivePermissions。
 */
export async function hasPermission(loginid: string, permission: PermissionKey): Promise<boolean> {
  const { isSystemAdmin: sys, perms } = await getEffectivePermissions(loginid);
  if (sys) return true;
  if (perms[permission] !== undefined) return perms[permission] === true;
  // 兜底：RoleGuard 硬编码
  const role = await resolveRole(loginid);
  const guard = RoleGuard[permission];
  return guard ? guard(role) : false;
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
  { key: 'canViewBoard', label: '看板总开关', group: '查看' },
  { key: 'canViewWeeklyBoard', label: '周例会看板', group: '查看' },
  { key: 'canViewMonthlyBoard', label: '月度看板', group: '查看' },
  { key: 'canViewProductionBoard', label: '产销会看板', group: '查看' },
  { key: 'canViewTracking', label: '行动项台账', group: '查看' },
  { key: 'canViewContinuous', label: '持续项跟进', group: '查看' },
  { key: 'canViewAllTasks', label: '全部任务看板', group: '查看' },
  { key: 'canViewOrg', label: '组织架构查看', group: '查看' },
  { key: 'canAudit', label: '稽核评分 V/X/0', group: '台账操作' },
  { key: 'canRedelegate', label: '重新派发任务', group: '台账操作' },
  { key: 'canBatchImport', label: '批量导入行动项', group: '台账操作' },
  { key: 'canEditActionOwner', label: '修改行动项责任人', group: '台账操作' },
  { key: 'canSettle', label: '超期结算', group: '台账操作' },
  { key: 'canCreateMeeting', label: '创建会议', group: '会议' },
  { key: 'canLockMeeting', label: '归档会议', group: '会议' },
  { key: 'canUnlockMeeting', label: '解锁会议', group: '会议' },
  { key: 'canPushContinuous', label: '手动推送持续项', group: '推送' },
  { key: 'canPushBatch', label: '推送批次企微提醒', group: '推送' },
  { key: 'canManagePushConfig', label: '推送/回拉配置', group: '推送' },
  { key: 'canManageOrg', label: '组织架构管理', group: '系统管理' },
  { key: 'canManageFeedback', label: '反馈处置', group: '系统管理' },
  { key: 'canManageRoles', label: '角色名单管理', group: '系统管理' },
];
