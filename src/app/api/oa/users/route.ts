import { NextRequest, NextResponse } from 'next/server';
import { searchOAUsers } from '@/lib/weaver-notify';

// GET /api/oa/users?keyword=张三
export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword') || '';
  if (!keyword || keyword.length < 1) {
    return NextResponse.json({ success: true, data: [] });
  }

  try {
    const raw = await searchOAUsers(keyword);
    const users = raw.map(u => ({
      oaId: u.oaId || '',
      loginid: u.loginid,
      name: u.lastname,
      dept: u.departmentname,
    }));
    return NextResponse.json({ success: true, data: users });
  } catch (error) {
    console.error('[api/oa/users]', error);
    return NextResponse.json(
      { success: false, error: 'OA用户搜索失败' },
      { status: 500 }
    );
  }
}
