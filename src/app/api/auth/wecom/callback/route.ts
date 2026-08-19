import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken } from '@/lib/session';
import { getTraceFromRequest } from '@/lib/trace';

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
    const session = await createSessionToken({ loginid: userid, name, dept });

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
