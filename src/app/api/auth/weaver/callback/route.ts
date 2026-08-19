import { NextRequest, NextResponse } from 'next/server';
import { getUserInfoFromOA, verifySign, verifyHmacSign, checkSsoToken } from '@/lib/weaver-sso';
import { createSessionToken, buildSetCookieHeader } from '@/lib/session';
import { getAppPool } from '@/lib/oa-task-push';
import * as sql from 'mssql';

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

// 泛微OA SSO回调 - 同时支持 GET（OA跳转）和 POST（程序调用）
// GET参数: ?loginid=xxx&username=xxx&sign=xxx&timestamp=xxx&redirect=/
// 或带 ssoToken: ?ssoToken=xxx&redirect=/

async function resolveUser(loginid: string, fallbackName: string): Promise<{
  loginid: string; name: string; dept: string;
}> {
  const appid = process.env.WEAVER_OA_APPID;
  const spk = process.env.WEAVER_OA_SPK;
  const secret = process.env.WEAVER_OA_SECRET;

  if (appid && spk && secret) {
    try {
      const info = await getUserInfoFromOA(loginid);
      if (info) {
        return {
          loginid,
          name: info.lastname || fallbackName,
          dept: info.departmentname || '',
        };
      }
    } catch {
      console.warn('[SSO callback] OA用户信息获取失败，尝试 SQL');
    }
  }

  // OA API 失败时降级用 SQL 查询真实姓名
  if (fallbackName === loginid) {
    const sql = await resolveNameFromSQL(loginid);
    return { loginid, name: sql.name, dept: sql.dept };
  }
  return { loginid, name: fallbackName, dept: '' };
}

async function buildSessionResponse(
  user: { loginid: string; name: string; dept: string },
  redirectUrl: string,
  request: NextRequest
) {
  const { resolveRole } = await import('@/lib/roles');
  const role = await resolveRole(user.loginid);
  const token = createSessionToken({ ...user, role });
  const origin = getBaseUrl(request);
  const res = NextResponse.redirect(new URL(redirectUrl, origin));
  res.headers.set('Set-Cookie', buildSetCookieHeader(token));
  console.log(`[SSO callback] 登录成功: ${user.loginid} (${user.name}) role=${role} -> ${origin}${redirectUrl}`);
  return res;
}

function getBaseUrl(request: NextRequest): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return appUrl;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const redirectTo = sp.get('redirect') || '/';
    const oaSecret = process.env.WEAVER_OA_SECRET;
    const base = getBaseUrl(request);

    if (!process.env.WEAVER_OA_URL) {
      return NextResponse.redirect(new URL('/login?error=oa_unavailable', base));
    }

    // 优先处理 E9 ssoToken（OA 生成 token，我们验证后换取 loginid）
    const ssoToken = sp.get('ssoToken') || sp.get('token') || sp.get('_key');
    if (ssoToken) {
      const resolvedLoginid = await checkSsoToken(ssoToken);
      if (!resolvedLoginid) {
        return NextResponse.redirect(new URL('/login?error=sso_failed', base));
      }
      const user = await resolveUser(resolvedLoginid, resolvedLoginid);
      return buildSessionResponse(user, redirectTo, request);
    }

    const loginid = sp.get('loginid') || sp.get('username') || sp.get('lastname') || '';
    const username = loginid;
    const sign = sp.get('sign');
    const timestamp = sp.get('timestamp');

    if (!loginid) {
      return NextResponse.redirect(new URL('/login?error=missing_loginid', base));
    }

    // 签名验证（可选，OA配置了才校验）
    if (sign && timestamp) {
      const timeDiff = Math.abs(Date.now() - parseInt(timestamp, 10));
      if (timeDiff > 5 * 60 * 1000) {
        return NextResponse.redirect(new URL('/login?error=expired', base));
      }
      // 1) HMAC-SHA256（EntranceDddl.jsp 方式：data = loginid|timestamp）
      const hmacSecret = process.env.WEAVER_SSO_HMAC_SECRET;
      if (hmacSecret && verifyHmacSign(`${loginid}|${timestamp}`, sign, hmacSecret)) {
        // 通过
      }
      // 2) MD5（原 verifySign 方式）
      else if (oaSecret && verifySign({ loginid, timestamp }, sign, oaSecret)) {
        // 通过
      }
      // 3) 都没有 → 失败
      else {
        return NextResponse.redirect(new URL('/login?error=sso_failed', base));
      }
    }

    const user = await resolveUser(loginid, username || loginid);
    return buildSessionResponse(user, redirectTo, request);
  } catch (error) {
    console.error('[SSO callback GET]', error);
    const base = getBaseUrl(request);
    return NextResponse.redirect(new URL('/login?error=sso_failed', base));
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawLoginid = (body as Record<string, string>).loginid;
    const rawUsername = (body as Record<string, string>).username || (body as Record<string, string>).lastname;
    const loginid = rawLoginid || rawUsername || '';
    const username = loginid;
    const sign = (body as Record<string, string>).sign;
    const timestamp = (body as Record<string, string>).timestamp;
    const oaSecret = process.env.WEAVER_OA_SECRET;

    if (!loginid) {
      return NextResponse.json({ success: false, error: '缺少loginid' }, { status: 400 });
    }

    if (sign && oaSecret && timestamp) {
      if (!verifySign({ loginid, timestamp }, sign, oaSecret)) {
        return NextResponse.json({ success: false, error: '签名验证失败' }, { status: 403 });
      }
    }

    const user = await resolveUser(loginid, username || loginid);
    const token = createSessionToken(user);

    const res = NextResponse.json({ success: true, data: { loginid: user.loginid, name: user.name } });
    res.headers.set('Set-Cookie', buildSetCookieHeader(token));
    return res;
  } catch (error) {
    console.error('[SSO callback POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 }
    );
  }
}
