import { NextResponse } from 'next/server';
import { getAllTaskBatches } from '@/storage';
import { getCurrentUser } from '@/lib/session';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const allBatches = await getAllTaskBatches();
    // 只返回当前用户创建的批次
    const myBatches = allBatches.filter(b => b.createdByLoginId === user.loginid);

    return NextResponse.json({ success: true, data: myBatches });
  } catch (error) {
    console.error('[batch list]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '获取失败' }, { status: 500 });
  }
}
