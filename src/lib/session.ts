import crypto from 'crypto';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'meeting_session';
const SESSION_SECRET = (): string => {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.warn('[session] SESSION_SECRET not configured, using fallback (NOT SECURE FOR PRODUCTION)');
    return 'default-meeting-secret-change-me-in-production';
  }
  if (secret.length < 32) {
    console.warn('[session] SESSION_SECRET should be at least 32 characters for better security');
  }
  return secret;
};
const SESSION_TTL_HOURS = 24;

export interface SessionUser {
  loginid: string;   // OA loginid，唯一标识
  name: string;      // 显示名（lastname）
  dept: string;      // 部门
  role?: string;     // 用户角色：admin | manager | secretary | employee
  exp: number;       // 过期时间戳（ms）
}

// ── 签名 ──
function sign(payload: string): string {
  return crypto
    .createHmac('sha256', SESSION_SECRET())
    .update(payload)
    .digest('base64url');
}

// ── 创建 session token ──
export function createSessionToken(user: Omit<SessionUser, 'exp'>): string {
  const session: SessionUser = {
    ...user,
    exp: Date.now() + SESSION_TTL_HOURS * 3600 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

// ── 验证并解析 token ──
export function parseSessionToken(token: string): SessionUser | null {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    if (sign(payload) !== sig) return null;

    const session: SessionUser = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8')
    );
    if (session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

// ── 从 Next.js cookie 中获取当前用户（Server Component / Route Handler 用）──
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return parseSessionToken(token);
}

// ── 设置 session cookie 的响应头参数（在 Route Handler 里用）──
export function buildSetCookieHeader(token: string): string {
  const maxAge = SESSION_TTL_HOURS * 3600;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${maxAge}`;
}

export function buildClearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export { COOKIE_NAME };
