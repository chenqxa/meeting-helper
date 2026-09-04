import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { RoleGuard, PermissionKey } from '@/lib/roles';
import { isSystemAdmin } from '@/lib/roles';
import { getRolePermissions } from '@/storage/database/role-permission-storage';

// GET /api/permissions/mine - 当前用户具备的权限点集合（侧边栏/按钮显隐用）
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });

    const perms = new Set<string>();
    // 系统管理员：全部权限
    if (await isSystemAdmin(user.loginid)) {
      for (const key of Object.keys(RoleGuard) as PermissionKey[]) perms.add(key);
      return NextResponse.json({ success: true, data: { permissions: [...perms] } });
    }
    // 普通用户：查角色权限表
    try {
      const { resolveRole } = await import('@/lib/roles');
      const role = await resolveRole(user.loginid);
      const rp = await getRolePermissions(role);
      for (const [key, allowed] of Object.entries(rp)) {
        if (allowed) perms.add(key);
      }
    } catch (e) {
      // 表不可用 → 降级 RoleGuard 硬编码
      console.warn('[permissions/mine] 查库失败，降级硬编码:', e instanceof Error ? e.message : e);
      const { resolveRole } = await import('@/lib/roles');
      const role = await resolveRole(user.loginid);
      for (const key of Object.keys(RoleGuard) as PermissionKey[]) {
        if (RoleGuard[key](role)) perms.add(key);
      }
    }
    return NextResponse.json({ success: true, data: { permissions: [...perms] } });
  } catch (error) {
    console.error('[permissions/mine]', error);
    return NextResponse.json({ success: false, error: '获取权限失败' }, { status: 500 });
  }
}
