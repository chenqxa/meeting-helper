import { NextRequest, NextResponse } from 'next/server';
import { searchOAUsers } from '@/lib/weaver-notify';
import { matchUserFuzzy } from '@/lib/name-matcher';

// POST /api/oa/match-owners
// body: { names: string[] }
// 返回每个名字对应的 OA 最佳匹配用户
// 支持"名字带部门"的模糊匹配：'陈巧霞（开发部）'/'开发部陈巧霞' 等 → 匹配到 '陈巧霞'
// 匹配不到的名字不出现在 matches 里（前端保留原值，不限制自定义人名）
export async function POST(request: NextRequest) {
  try {
    const { names } = await request.json() as { names: string[] };
    if (!names?.length) return NextResponse.json({ success: true, matches: {} });

    const matches: Record<string, { loginid: string; name: string; dept: string; oaId?: string } | null> = {};

    // 对每个名字搜索 OA，并发执行
    await Promise.all(names.map(async (name) => {
      if (!name?.trim()) { matches[name] = null; return; }
      try {
        // 先按原逻辑精确匹配（lastname 包含关键字）
        const list = await searchOAUsers(name.trim());
        if (list.length > 0) {
          const exact = list.find(u => u.lastname.includes(name.trim()));
          const best = exact || list[0];
          matches[name] = {
            oaId: best.oaId || '',
            loginid: best.loginid,
            name: best.lastname,
            dept: best.departmentname,
          };
          console.log(`[match-owners] "${name}" → "${best.lastname}" (${best.loginid}) [${best.departmentname}]`);
          return;
        }

        // 原逻辑查不到：走模糊匹配（剥离部门/括号注记后再查）
        const fuzzy = await matchUserFuzzy(name);
        if (fuzzy) {
          matches[name] = {
            oaId: fuzzy.oaId || '',
            loginid: fuzzy.loginid,
            name: fuzzy.name,
            dept: fuzzy.dept,
          };
          console.log(`[match-owners] 模糊匹配 "${name}" → "${fuzzy.name}" (${fuzzy.loginid}) [${fuzzy.dept}]`);
        } else {
          matches[name] = null;
        }
      } catch {
        matches[name] = null;
      }
    }));

    return NextResponse.json({ success: true, matches });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
