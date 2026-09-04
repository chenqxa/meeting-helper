import { NextRequest, NextResponse } from 'next/server';
import { RoleGuard, UserRole, PERMISSION_MATRIX, isSystemAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getRolePermissions, setRolePermission } from '@/storage/database/role-permission-storage';
import { clearRoleCache } from '@/lib/roles';
import { logOperation } from '@/lib/operation-log';

const ROLES: UserRole[] = ['admin', 'manager', 'secretary', 'employee'];

// GET /api/permissions/matrix - 权限矩阵（数据源：role_permissions 表 + RoleGuard 兜底）
// 返回每个权限点在每个角色下的 true/false，以及当前用户是否为系统管理员（可编辑）
export async function GET() {
  try {
    const user = await getCurrentUser();
    const isSystem = await isSystemAdmin(user?.loginid);
    // 并行读取四个角色权限
    const [mAdmin, mManager, mSecretary, mEmployee] = await Promise.all([
      getRolePermissions('admin'),
      getRolePermissions('manager'),
      getRolePermissions('secretary'),
      getRolePermissions('employee'),
    ]);
    const matrixMap = { admin: mAdmin, manager: mManager, secretary: mSecretary, employee: mEmployee };
    const permissions = PERMISSION_MATRIX.map(p => ({
      key: p.key,
      label: p.label,
      group: p.group,
      admin: matrixMap.admin[p.key] === true,
      manager: matrixMap.manager[p.key] === true,
      secretary: matrixMap.secretary[p.key] === true,
      employee: matrixMap.employee[p.key] === true,
    }));
    return NextResponse.json({ success: true, data: { roles: ROLES, permissions, isSystemAdmin: isSystem } });
  } catch (error) {
    console.error('[permissions/matrix GET]', error);
    return NextResponse.json({ success: false, error: '获取权限矩阵失败' }, { status: 500 });
  }
}

// POST /api/permissions/matrix - 更新某角色某权限点（仅系统管理员）
// body: { role, permissionKey, allowed }
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    if (!(await isSystemAdmin(user.loginid))) {
      void logOperation({
        action: 'forbidden',
        targetType: 'system',
        summary: `越权尝试：${user.loginid} 尝试编辑权限矩阵（仅系统管理员）`,
      }).catch(() => {});
      return NextResponse.json({ success: false, error: '仅系统管理员可编辑权限矩阵', code: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await request.json();
    const { role, permissionKey, allowed } = body as { role: string; permissionKey: string; allowed: boolean };
    if (!ROLES.includes(role as UserRole)) return NextResponse.json({ success: false, error: '无效角色' }, { status: 400 });
    if (!permissionKey || typeof permissionKey !== 'string') return NextResponse.json({ success: false, error: '无效权限点' }, { status: 400 });

    // 防呆：系统管理员自己的"角色名单管理"权限不可关闭（防止自己锁死）
    if (role === 'admin' && permissionKey === 'canManageRoles' && !allowed) {
      return NextResponse.json({ success: false, error: '不能关闭超级管理员的角色管理权限（防止锁死）' }, { status: 400 });
    }

    await setRolePermission(role, permissionKey, !!allowed);
    clearRoleCache(); // 权限变更立即生效
    await logOperation({
      action: 'permission_update',
      targetType: 'system',
      targetId: `${role}/${permissionKey}`,
      summary: `权限矩阵变更：${role}.${permissionKey} → ${allowed ? '授予' : '撤销'}`,
      detail: { role, permissionKey, allowed, operator: user.loginid },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[permissions/matrix POST]', error);
    return NextResponse.json({ success: false, error: '更新权限失败' }, { status: 500 });
  }
}
