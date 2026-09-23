import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resolveRole, hasPermission, getEffectivePermissions, PermissionKey } from '@/lib/roles';
import { defineAbilityFor, asSubject, AppAction, AppSubject } from '@/lib/ability';
import { logOperation } from '@/lib/operation-log';

// ─────────────────────────────────────────────────────────────
// 权限模型说明（重要）：
// 本守卫是「全局角色」校验，不是「行级/部门级」校验——
// guardWrite('manager') 放行的 manager 可以操作【全部】会议/数据，
// 不区分"只限本部门"。未来若需要部门级行管，需在路由内叠加数据过滤，
// 不能只靠本守卫。
// ─────────────────────────────────────────────────────────────

// 守卫级别 → 所需权限点映射（升级到完整 RBAC 时，改这里的映射即可，调用方零改动）
const GUARD_PERMISSION: Record<'admin' | 'manager', PermissionKey> = {
  admin: 'canManageRoles',   // admin 级守卫：要求具备"角色管理"级权限（仅 admin 拥有）
  manager: 'canViewTracking' // manager 级守卫：要求具备"台账可见"级权限（admin/manager 拥有）
};

/**
 * 写操作守卫：校验当前登录用户是否具备守卫级别对应权限。
 * 内部走 hasPermission 扩展点（v1 角色映射 / v2 可换 DB 权限表）。
 * 用法（路由处理器首行）：
 *   const guard = await guardWrite('admin');
 *   if (!guard.ok) return guard.response;
 */
export async function guardWrite(min: 'admin' | 'manager') {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json(
      { success: false, error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  const pass = await hasPermission(user.loginid, GUARD_PERMISSION[min]);
  if (!pass) {
    const role = await resolveRole(user.loginid); // 仅供日志展示
    // 越权留痕：记录当时角色，便于排查「为何此人仍有权限」（角色缓存最多滞后10分钟）
    void logOperation({
      action: 'forbidden',
      targetType: 'api',
      summary: `越权尝试：${user.loginid}(role=${role}) 请求需 ${min} 的接口`,
    }).catch(() => {});
    return { ok: false as const, response: NextResponse.json(
      { success: false, error: '无权限执行此操作', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true as const, user };
}

function unauthorizedResponse() {
  return NextResponse.json(
    { success: false, error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 });
}

function forbiddenResponse(user: { loginid: string }, what: string, role?: string) {
  void logOperation({
    action: 'forbidden',
    targetType: 'api',
    summary: `越权尝试：${user.loginid}${role ? `(role=${role})` : ''} 请求 ${what}`,
  }).catch(() => {});
  return NextResponse.json(
    { success: false, error: '无权限执行此操作', code: 'FORBIDDEN' }, { status: 403 });
}

/**
 * 精确权限点守卫（推荐新代码使用）：按权限点判定，内部走 getEffectivePermissions（含人员级覆盖）。
 * 用法：const g = await guardPermission('canCreateMeeting'); if (!g.ok) return g.response;
 */
export async function guardPermission(key: PermissionKey) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, response: unauthorizedResponse() };
  const { isSystemAdmin, perms, role } = await getEffectivePermissions(user.loginid);
  const ability = defineAbilityFor(user, perms, isSystemAdmin);
  const map = (await import('@/lib/ability')).PERMISSION_ABILITY[key];
  const pass = map ? ability.can(map[0], map[1]) : perms[key] === true;
  if (!pass) return { ok: false as const, response: forbiddenResponse(user, `权限点 ${key}`, role) };
  return { ok: true as const, user, ability, perms, role };
}

/**
 * CASL 资源守卫：功能权限（由 ability rules 表达）+ 资源条件。
 * resource 会带类型标记后交给 ability.can 做条件判断（如 meeting.organizer / meeting.status）。
 */
export async function guardAbility(action: AppAction, subjectType: AppSubject, resource?: object) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, response: unauthorizedResponse() };
  const { isSystemAdmin, perms, role } = await getEffectivePermissions(user.loginid);
  const ability = defineAbilityFor(user, perms, isSystemAdmin);
  const target = resource ? asSubject(subjectType, resource) : subjectType;
  if (!ability.can(action, target as any)) {
    return { ok: false as const, response: forbiddenResponse(user, `${action}:${subjectType}`, role), ability };
  }
  return { ok: true as const, user, ability, perms, role };
}
