import { NextRequest, NextResponse } from 'next/server';
import { canViewBoard } from '@/storage/database/board-permission-storage';
import { getCurrentUser } from '@/lib/session';

// GET /api/board-permissions/check?key=weekly - 当前用户能否看某块看板
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    const key = new URL(request.url).searchParams.get('key') || '';
    if (!['weekly', 'monthly', 'production'].includes(key)) {
      return NextResponse.json({ success: false, error: '无效的看板 key' }, { status: 400 });
    }
    const allowed = await canViewBoard(user.loginid, key as 'weekly' | 'monthly' | 'production');
    return NextResponse.json({ success: true, data: { allowed } });
  } catch (e) {
    console.error('[board-permissions check]', e);
    return NextResponse.json({ success: false, error: '检查失败' }, { status: 500 });
  }
}
