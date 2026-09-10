import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { RoleGuard, PermissionKey, resolveRole } from '@/lib/roles';
import { isSystemAdmin } from '@/lib/roles';
import { getRolePermissions } from '@/storage/database/role-permission-storage';
import { canViewBoard, BOARD_KEY_TO_PERM } from '@/storage/database/board-permission-storage';

// GET /api/permissions/mine - 当前用户具备的权限点集合（侧边栏/按钮显隐用）
// 优先级：系统管理员 > 人员级看板权限（hyzs_board_permissions）> 角色权限（hyzs_role_permissions）> RoleGuard 硬编码
// 看板权限点（canViewWeeklyBoard / canViewMonthlyBoard / canViewProductionBoard）必须走 canViewBoard，
// 否则管理员在 /org/board-permission-panel 给某人单独开看板时，侧边栏不会显示入口（只显示"无权访问"页面）
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });

    const perms = new Set<string>();
    const isAdmin = await isSystemAdmin(user.loginid);

    // 系统管理员：全部权限
    if (isAdmin) {
      for (const key of Object.keys(RoleGuard) as PermissionKey[]) perms.add(key);
      return NextResponse.json({ success: true, data: { permissions: [...perms] } });
    }

    // 普通用户：先取角色权限作为基线
    let role: 'admin' | 'manager' | 'secretary' | 'employee' = 'employee';
    let useHardcoded = false;
    try {
      role = await resolveRole(user.loginid);
      const rp = await getRolePermissions(role);
      for (const [key, allowed] of Object.entries(rp)) {
        if (allowed) perms.add(key);
      }
    } catch (e) {
      useHardcoded = true;
      console.warn('[permissions/mine] 查库失败，降级硬编码:', e instanceof Error ? e.message : e);
      role = await resolveRole(user.loginid);
      for (const key of Object.keys(RoleGuard) as PermissionKey[]) {
        if (RoleGuard[key](role)) perms.add(key);
      }
    }

    // 看板权限点：用 canViewBoard 综合判断（人员级 > 角色级 > 兜底硬编码），
    // 与 /api/board-permissions/check 完全同源，避免"侧栏看不到但页面进得去"或反之的分裂。
    // 注意：失败兜底为 false（人员级表不存在/挂掉时，按角色权限不要回退为 true，否则又退化回硬编码）
    for (const boardKey of ['weekly', 'monthly', 'production'] as const) {
      const permKey = BOARD_KEY_TO_PERM[boardKey];
      let allowed = false;
      try {
        allowed = await canViewBoard(user.loginid, boardKey);
      } catch (e) {
        // canViewBoard 异常：保留角色级结果，不静默覆盖
        console.warn(`[permissions/mine] canViewBoard(${boardKey}) 异常，保留角色级结果:`, e instanceof Error ? e.message : e);
        continue;
      }
      // 同步该看板的权限点（覆盖角色级基线）
      if (allowed) perms.add(permKey);
      else perms.delete(permKey);
    }

    // 兜底硬编码分支：把缺失的权限点用 RoleGuard 补齐（与原行为一致）
    if (useHardcoded) {
      for (const key of Object.keys(RoleGuard) as PermissionKey[]) {
        if (perms.has(key)) continue;
        if (RoleGuard[key](role)) perms.add(key);
      }
    }

    return NextResponse.json({ success: true, data: { permissions: [...perms] } });
  } catch (error) {
    console.error('[permissions/mine]', error);
    return NextResponse.json({ success: false, error: '获取权限失败' }, { status: 500 });
  }
}
