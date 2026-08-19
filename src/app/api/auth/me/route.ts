import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resolveRole } from '@/lib/roles';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
  }

  let { name, dept } = user;
  const role = await resolveRole(user.loginid);

  return NextResponse.json({
    success: true,
    data: { loginid: user.loginid, name, dept, role },
  });
}
