import { NextRequest, NextResponse } from 'next/server';
import { getAllBoardPermissions, setBoardPermission, clearBoardPermissions } from '@/storage/database/board-permission-storage';
import { isSystemAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// GET /api/board-permissions - 获取全部人员级看板权限（系统管理员）
// POST /api/board-permissions - 设置某人某看板权限（系统管理员）
// DELETE /api/board-permissions?loginid=xx - 清除某人全部人员级配置（系统管理员）

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    if (!(await isSystemAdmin(user.loginid))) {
      return NextResponse.json({ success: false, error: '仅系统管理员可查看' }, { status: 403 });
    }
    const data = await getAllBoardPermissions();
    return NextResponse.json({ success: true, data });
  } catch (e) {
    console.error('[board-permissions GET]', e);
    return NextResponse.json({ success: false, error: '查询失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    if (!(await isSystemAdmin(user.loginid))) {
      return NextResponse.json({ success: false, error: '仅系统管理员可操作' }, { status: 403 });
    }
    const body = await request.json();
    const { loginid, boardKey, allowed } = body;
    if (!loginid || !boardKey || !['weekly', 'monthly', 'production'].includes(boardKey)) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 });
    }
    await setBoardPermission(String(loginid), boardKey, !!allowed, user.loginid);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[board-permissions POST]', e);
    return NextResponse.json({ success: false, error: '设置失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    if (!(await isSystemAdmin(user.loginid))) {
      return NextResponse.json({ success: false, error: '仅系统管理员可操作' }, { status: 403 });
    }
    const loginid = new URL(request.url).searchParams.get('loginid');
    if (!loginid) return NextResponse.json({ success: false, error: '缺少 loginid' }, { status: 400 });
    const deleted = await clearBoardPermissions(loginid);
    return NextResponse.json({ success: true, data: { deleted } });
  } catch (e) {
    console.error('[board-permissions DELETE]', e);
    return NextResponse.json({ success: false, error: '清除失败' }, { status: 500 });
  }
}
