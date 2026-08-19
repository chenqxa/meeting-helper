import { NextRequest, NextResponse } from 'next/server';
import { getTraceFromRequest, appendTraceToUrl } from '@/lib/trace';

const COOKIE_NAME = 'meeting_session';

// ============================================
// 企业微信域名验证配置
// ============================================
// 从企业微信后台下载验证文件，将内容填入下面
const WECOM_VERIFY_FILES: Record<string, string> = {
  // 示例：'WW_verify_abc123xyz.txt': '你的验证码内容',

  // ⬇️ 请在这里添加你的验证文件
  'WW_verify_nxdIbimKG021ox1q.txt': 'nxdIbimKG021ox1q',
};

// 不需要登录的路径
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/',
  '/api/health', '/api/health/',
  '/api/admin/cleanup-orphans',
  '/api/seed',
  '/api/debug/',
  '/task-confirm/',
  '/_next/',
  '/favicon',
  '/meeting/share/', // 分享链接页面
  '/api/meetings/share/', // 分享链接验证API
];

// 轻量 session 解析
function parseSessionLight(token: string): { loginid: string; name: string; exp: number } | null {
  try {
    const [payload] = token.split('.');
    if (!payload) return null;

    // 使用 Buffer 而不是 atob（兼容性更好）
    const json = Buffer.from(payload, 'base64url').toString('utf-8');
    const session = JSON.parse(json);

    if (!session.loginid || !session.exp) return null;
    if (session.exp < Date.now()) return null;

    return session;
  } catch (error) {
    console.error('[middleware] Parse error:', error);
    return null;
  }
}

function handleWeComVerify(pathname: string): NextResponse {
  const filename = pathname.substring(1); // 去掉开头的 /
  const content = WECOM_VERIFY_FILES[filename];

  if (content && !content.includes('请将')) {
    return new NextResponse(content, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new NextResponse(
    `验证文件未配置。\n请编辑 src/middleware.ts 中的 WECOM_VERIFY_FILES，添加：\n'${filename}': '你的验证码内容'`,
    {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const traceId = getTraceFromRequest(request, 'mw');
  const log = (step: string, extra: Record<string, unknown> = {}) => {
    console.log('[share-trace]', JSON.stringify({ traceId, step, pathname, ...extra }));
  };

  // 处理企业微信域名验证文件
  if (pathname.startsWith('/WW_verify_') && pathname.endsWith('.txt')) {
    return handleWeComVerify(pathname);
  }

  // 检查是否是通过分享链接访问会议详情页
  if (pathname.startsWith('/meeting/') && !pathname.startsWith('/meeting/share/')) {
    const url = request.nextUrl;
    const isSharedAccess = url.searchParams.get('shared') === 'true';

    if (!isSharedAccess) {
      // 非分享入口交给下面的 session 校验
    } else {
      const token = request.cookies.get(COOKIE_NAME)?.value;
      const user = token ? parseSessionLight(token) : null;

      if (user) {
        log('shared.access.has-session', { loginid: user.loginid });
        const pass = NextResponse.next();
        stampUserHeaders(pass, user);
        return pass;
      }

      const corpid = process.env.WECOM_CORPID;
      const agentId = process.env.WECOM_AGENT_ID;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || '';

      if (!corpid || !agentId) {
        log('shared.oauth.skipped.no-config');
        return NextResponse.next();
      }

      const targetWithTrace = appendTraceToUrl(`${pathname}${url.search}`, traceId);
      const redirectUri = encodeURIComponent(`${appUrl}/api/auth/wecom/callback`);
      const state = encodeURIComponent(targetWithTrace);
      const authUrl =
        `https://open.weixin.qq.com/connect/oauth2/authorize` +
        `?appid=${corpid}` +
        `&redirect_uri=${redirectUri}` +
        `&response_type=code` +
        `&scope=snsapi_base` +
        `&state=${state}` +
        `&agentid=${agentId}` +
        `#wechat_redirect`;

      log('shared.oauth.redirect', { agentId, appUrl, target: targetWithTrace });
      const res = NextResponse.redirect(authUrl);
      res.headers.set('x-hyzs-trace', traceId);
      return res;
    }
  }

  // 放行公开路径
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 放行内部调用
  if (pathname.startsWith('/api/org/sync')) {
    const syncToken = request.headers.get('x-sync-token');
    const secret = process.env.INTERNAL_SYNC_SECRET;
    if (secret && syncToken === secret) {
      return NextResponse.next();
    }
  }

  // 检查 session
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const user = token ? parseSessionLight(token) : null;

  if (!user) {
    if (pathname.startsWith('/api/')) {
      log('api.no-session');
      return NextResponse.json(
        { success: false, error: '未登录', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }
    log('page.no-session.redirect-login');
    // 用当前请求的实际地址跳登录页，避免 NEXT_PUBLIC_APP_URL 配置与实际访问端口不一致时跳错（如本地 5000 被带到 3100）
    const reqUrl = new URL(request.url);
    const loginUrl = new URL('/login', reqUrl.origin);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  log('session.ok', { loginid: user.loginid });
  const res = NextResponse.next();
  stampUserHeaders(res, user);
  res.headers.set('x-hyzs-trace', traceId);
  return res;
}

function stampUserHeaders(res: NextResponse, user: { loginid: string; name: string }) {
  try {
    const safeLoginId = user.loginid?.replace(/[^\x00-\x7F]/g, ''); // 移除非ASCII字符
    if (safeLoginId) {
      res.headers.set('x-user-loginid', safeLoginId);
    }
    if (user.name) {
      res.headers.set('x-user-name', encodeURIComponent(user.name));
    }
  } catch (e) {
    console.warn('[middleware] Failed to set user headers:', e);
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
