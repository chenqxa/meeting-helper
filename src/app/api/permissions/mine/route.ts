import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getEffectivePermissions } from '@/lib/roles';
import { canViewBoard, BOARD_KEY_TO_PERM } from '@/storage/database/board-permission-storage';

// GET /api/permissions/mine - 当前用户具备的权限点集合（侧边栏/按钮显隐用）
// 优先级：系统管理员 > 人员级(hyzs_user_permissions) > 角色权限(hyzs_role_permissions) > RoleGuard 硬编码
// 看板权限点（canViewWeeklyBoard / canViewMonthlyBoard / canViewProductionBoard）额外走 canViewBoard，
// 兼容组织页「看板授权面板」的人员级开关，避免侧边栏与页面访问权限分裂。
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });

    // 基线：系统管理员 > 人员级 > 角色矩阵 > 硬编码
    const { perms: base } = await getEffectivePermissions(user.loginid);
    const perms = new Set<string>();
    for (const [key, allowed] of Object.entries(base)) {
      if (allowed) perms.add(key);
    }

    // 看板权限点：canViewBoard 综合判断（人员级看板 > 角色级 > 兜底）
    for (const boardKey of ['weekly', 'monthly', 'production'] as const) {
      const permKey = BOARD_KEY_TO_PERM[boardKey];
      let allowed = false;
      try {
        allowed = await canViewBoard(user.loginid, boardKey);
      } catch (e) {
        console.warn(`[permissions/mine] canViewBoard(${boardKey}) 异常，保留基线结果:`, e instanceof Error ? e.message : e);
        continue;
      }
      if (allowed) perms.add(permKey);
      else perms.delete(permKey);
    }

    return NextResponse.json({ success: true, data: { permissions: [...perms] } });
  } catch (error) {
    console.error('[permissions/mine]', error);
    return NextResponse.json({ success: false, error: '获取权限失败' }, { status: 500 });
  }
}
