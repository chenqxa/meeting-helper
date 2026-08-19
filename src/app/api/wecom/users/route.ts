import { NextResponse } from 'next/server';
import { listAllUsers } from '@/lib/wecom';

// GET /api/wecom/users
// 返回全员名单，供前端下拉选择责任人时使用
export async function GET() {
  try {
    const users = await listAllUsers();
    const active = users
      .filter(u => u.status === 1)
      .map(u => ({ userid: u.userid, name: u.name }));
    return NextResponse.json({ success: true, data: active });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 503 }
    );
  }
}
