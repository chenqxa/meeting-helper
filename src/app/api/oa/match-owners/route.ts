import { NextRequest, NextResponse } from 'next/server';
import { searchOAUsers } from '@/lib/weaver-notify';

// POST /api/oa/match-owners
// body: { names: string[] }
// 返回每个名字对应的 OA 最佳匹配用户
export async function POST(request: NextRequest) {
  try {
    const { names } = await request.json() as { names: string[] };
    if (!names?.length) return NextResponse.json({ success: true, matches: {} });

    const matches: Record<string, { loginid: string; name: string; dept: string; oaId?: string } | null> = {};

    // 对每个名字搜索 OA，并发执行
    await Promise.all(names.map(async (name) => {
      if (!name?.trim()) { matches[name] = null; return; }
      try {
        const list = await searchOAUsers(name.trim());
        if (!list.length) { matches[name] = null; return; }

        // 优先姓名包含关键字的精确匹配，其次取第一条
        const exact = list.find(u => u.lastname.includes(name.trim()));
        const best = exact || list[0];
        matches[name] = {
          oaId: best.oaId || '',
          loginid: best.loginid,
          name: best.lastname,
          dept: best.departmentname,
        };
        console.log(`[match-owners] "${name}" → "${best.lastname}" (${best.loginid}) [${best.departmentname}]`);
      } catch {
        matches[name] = null;
      }
    }));

    return NextResponse.json({ success: true, matches });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
