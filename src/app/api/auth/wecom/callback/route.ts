import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken } from '@/lib/session';
import { getTraceFromRequest } from '@/lib/trace';

// 企微 userid/姓名 → OA loginid（session 身份统一走 OA 体系）
// 1) 按 OA loginid = 企微 userid 直接等值（多数企业两边一致时最快）
// 2) 按姓名lastname 精确反查 HrmResource.loginid
// 3) 都失败回退企微 userid（保持旧行为，至少页面能进）
async function resolveOALoginId(wecomUserid: string, name: string): Promise<string> {
  try {
    const { getAppPool } = await import('@/lib/oa-task-push');
    const pool = await getAppPool();
    const linked = process.env.OA_LINKED_SERVER || 'FWsv';
    const oaDb = process.env.OA_DATABASE_NAME || 'ecology';
    const esc = (v: string) => v.replace(/'/g, "''");

    // loginid 等值 或 姓名匹配（loginid=userid 的企业一次命中；否则按姓名）
    const res = await pool.request().query(`
      SELECT TOP 1 loginid FROM [${linked}].[${oaDb}].[dbo].[HrmResource]
      WHERE (loginid = '${esc(wecomUserid)}' OR lastname = N'${esc(name)}') AND status = 1
      ORDER BY CASE WHEN loginid = '${esc(wecomUserid)}' THEN 0 ELSE 1 END
    `);
    const oaLoginid = res.recordset[0]?.loginid;
    if (oaLoginid) {
      console.log(`[WeComAuth] 身份映射 企微:${wecomUserid}/姓名:${name} → OA loginid:${oaLoginid}`);
      return oaLoginid;
    }
  } catch (e) {
    console.warn('[WeComAuth] OA loginid 反查失败，回退企微 userid:', e instanceof Error ? e.message : e);
  }
  return wecomUserid;
}

/**
 * 企业微信OAuth回调
 * GET /api/auth/wecom/callback?code=xxx&state=xxx
 */
export async function GET(request: NextRequest) {
  const traceId = getTraceFromRequest(request, 'wecb');
  const log = (step: string, extra: Record<string, unknown> = {}) => {
    console.log('[share-trace]', JSON.stringify({ traceId, step, ...extra }));
  };
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    log('wecom.callback.received', { hasCode: !!code, hasState: !!state });

    if (!code) {
      return NextResponse.json({ success: false, error: '缺少授权码' }, { status: 400 });
    }

    const corpid = process.env.WECOM_CORPID;
    const agentSecret = process.env.WECOM_APP_SECRET;

    if (!corpid || !agentSecret) {
      return NextResponse.json({ success: false, error: '企业微信未配置' }, { status: 500 });
    }

    // 1. 获取access_token
    const tokenRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpid}&corpsecret=${agentSecret}`
    );
    const tokenData = await tokenRes.json();

    if (tokenData.errcode !== 0) {
      console.error('[WeComAuth] 获取token失败:', tokenData);
      log('wecom.callback.token-failed', { errcode: tokenData.errcode, errmsg: tokenData.errmsg });
      return NextResponse.json(
        { success: false, error: '获取access_token失败' },
        { status: 500 }
      );
    }

    const accessToken = tokenData.access_token;

    // 2. 使用code换取用户信息
    const userRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${accessToken}&code=${code}`
    );
    const userData = await userRes.json();

    if (userData.errcode !== 0) {
      console.error('[WeComAuth] 获取用户信息失败:', userData);
      log('wecom.callback.getuserinfo-failed', { errcode: userData.errcode, errmsg: userData.errmsg });
      return NextResponse.json(
        { success: false, error: '获取用户信息失败' },
        { status: 500 }
      );
    }

    const userid = userData.userid || userData.UserId;

    if (!userid) {
      console.error('[WeComAuth] 未返回userid:', userData);
      log('wecom.callback.no-userid');
      return NextResponse.json(
        { success: false, error: '未获取到用户ID' },
        { status: 500 }
      );
    }

    // 3. 获取用户详细信息
    const detailRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}&userid=${userid}`
    );
    const detailData = await detailRes.json();

    if (detailData.errcode !== 0) {
      console.error('[WeComAuth] 获取用户详情失败:', detailData);
      log('wecom.callback.user-get-failed', { userid, errcode: detailData.errcode, errmsg: detailData.errmsg });
      // 降级：使用userid作为名称
      const session = await createSessionToken({ loginid: userid, name: userid, dept: '' });
      const redirectUrl = state || '/';
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.url;

      const res = NextResponse.redirect(new URL(redirectUrl, baseUrl));
      res.cookies.set('meeting_session', session, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
      });
      log('wecom.callback.session.fallback', { userid, redirect: redirectUrl });
      return res;
    }

    const name = detailData.name || userid;
    const dept = detailData.department || '';

    // 4. 创建session并登录
    // session.loginid 统一用 OA loginid（如 chenqiaoxia），而非企微 userid（如 xibo）：
    // "我的任务"按 ownerLoginId 匹配、角色权限按 loginid 查表，用企微 userid 会全部断链
    const session = await createSessionToken({ loginid: await resolveOALoginId(userid, name), name, dept });

    // 5. 跳转到原始页面
    const redirectUrl = state || '/';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.url;
    const res = NextResponse.redirect(new URL(redirectUrl, baseUrl));
    res.cookies.set('meeting_session', session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7天
    });

    log('wecom.callback.session.created', { userid, name, redirect: redirectUrl });
    res.headers.set('x-hyzs-trace', traceId);
    return res;
  } catch (error) {
    console.error('[WeComAuth] 登录异常:', error);
    log('wecom.callback.exception', { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '登录失败' },
      { status: 500 }
    );
  }
}
