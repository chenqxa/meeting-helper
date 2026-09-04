import { NextRequest, NextResponse } from 'next/server';
import { isSystemAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getSystemAdmins, addSystemAdmin, removeSystemAdmin } from '@/storage/database/system-admin-storage';
import { clearRoleCache } from '@/lib/roles';
import { logOperation } from '@/lib/operation-log';

// GET /api/system-admin - 系统管理员名单（仅系统管理员可见）
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    const isSystem = await isSystemAdmin(user.loginid);
    const list = await getSystemAdmins();
    return NextResponse.json({ success: true, data: { systemAdmins: list, isSystemAdmin: isSystem } });
  } catch (error) {
    console.error('[system-admin GET]', error);
    return NextResponse.json({ success: false, error: '获取失败' }, { status: 500 });
  }
}

// POST /api/system-admin - 添加/移除系统管理员（仅现任系统管理员可操作）
// body: { action: 'add' | 'remove', loginid }
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    if (!(await isSystemAdmin(user.loginid))) {
      void logOperation({
        action: 'forbidden',
        targetType: 'system',
        summary: `越权尝试：${user.loginid} 尝试任命/撤销系统管理员（仅系统管理员可操作）`,
      }).catch(() => {});
      return NextResponse.json({ success: false, error: '仅系统管理员可任命/撤销系统管理员', code: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await request.json();
    const { action, loginid } = body as { action: string; loginid: string };
    if (!loginid?.trim()) return NextResponse.json({ success: false, error: '请提供 loginid' }, { status: 400 });

    if (action === 'add') {
      await addSystemAdmin(loginid);
      clearRoleCache(loginid.trim()); // 新系统管理员权限立即生效
      await logOperation({
        action: 'system_admin_add',
        targetType: 'system',
        targetId: loginid.trim(),
        summary: `任命系统管理员：${loginid}（由 ${user.loginid} 操作）`,
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'remove') {
      const res = await removeSystemAdmin(loginid);
      if (!res.ok) return NextResponse.json({ success: false, error: res.error || '移除失败' }, { status: 400 });
      clearRoleCache(loginid.trim());
      await logOperation({
        action: 'system_admin_remove',
        targetType: 'system',
        targetId: loginid.trim(),
        summary: `撤销系统管理员：${loginid}（由 ${user.loginid} 操作）`,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: '无效 action' }, { status: 400 });
  } catch (error) {
    console.error('[system-admin POST]', error);
    return NextResponse.json({ success: false, error: '操作失败' }, { status: 500 });
  }
}
