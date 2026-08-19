import { NextRequest, NextResponse } from 'next/server';
import { getUserInfoFromOA } from '@/lib/weaver-sso';
import { createSessionToken, buildSetCookieHeader } from '@/lib/session';
import { getAppPool } from '@/lib/oa-task-push';
import { resolveRole } from '@/lib/roles';
import * as sql from 'mssql';

// 通过 SQL 链接服务器按 loginid 精确查询真实姓名
async function resolveNameFromSQL(loginid: string): Promise<{ name: string; dept: string }> {
  try {
    const pool = await getAppPool();
    const linked = process.env.OA_LINKED_SERVER || 'FWsv';
    const oaDb = process.env.OA_DATABASE_NAME || 'ecology';
    // 使用参数化查询防止SQL注入
    const res = await pool.request()
      .input('loginid', sql.NVarChar, loginid)
      .query(`
        SELECT TOP 1 r.lastname, ISNULL(d.departmentname, '') AS departmentname
        FROM [${linked}].[${oaDb}].[dbo].[hrmresource] r
        LEFT JOIN [${linked}].[${oaDb}].[dbo].[hrmdepartment] d ON r.departmentid = d.id
        WHERE r.loginid = @loginid AND r.status = 1
      `);
    if (res.recordset.length > 0) {
      return { name: res.recordset[0].lastname || loginid, dept: res.recordset[0].departmentname || '' };
    }
  } catch { /* silent */ }
  return { name: loginid, dept: '' };
}

// POST /api/auth/login
// body: { loginid: string }
export async function POST(request: NextRequest) {
  try {
    const { loginid } = await request.json();

    if (!loginid || typeof loginid !== 'string' || !loginid.trim()) {
      return NextResponse.json(
        { success: false, error: '请输入OA登录账号' },
        { status: 400 }
      );
    }

    const id = loginid.trim();
    let name = id;
    let dept = '';

    // 优先：OA HTTP API 查询
    if (process.env.WEAVER_OA_URL) {
      try {
        const userInfo = await getUserInfoFromOA(id);
        if (userInfo) {
          name = userInfo.lastname || id;
          dept = userInfo.departmentname || '';
        }
      } catch (oaErr) {
        console.warn(`[login] OA API 查询失败，尝试 SQL: ${(oaErr as Error).message}`);
      }
    } else if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { success: false, error: 'OA系统未配置，请联系管理员' },
        { status: 503 }
      );
    }

    // 若名字仍是 loginid（OA API 未配置或失败），降级用 SQL 查询真实姓名
    if (name === id) {
      const sqlResult = await resolveNameFromSQL(id);
      name = sqlResult.name;
      dept = sqlResult.dept || dept;
    }

    const role = await resolveRole(id);
    const sessionToken = createSessionToken({ loginid: id, name, dept, role });
    console.log(`[login] 登录成功: ${id} (${name}) role=${role}`);

    const res = NextResponse.json({ success: true, data: { name, dept, role } });
    res.headers.set('Set-Cookie', buildSetCookieHeader(sessionToken));
    return res;
  } catch (error) {
    console.error('[login]', error);
    return NextResponse.json(
      { success: false, error: 'OA系统暂时不可用，请稍后重试' },
      { status: 503 }
    );
  }
}
