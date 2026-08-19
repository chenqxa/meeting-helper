import crypto from 'crypto';
import forge from 'node-forge';

// 泛微OA Token认证工具类
// 基于Ecology9 Token认证接口实现

interface RegisterResponse {
  msg: string;
  code: number;
  msgShowType: string;
  status: boolean;
  spk: string;    // OA系统公钥
  secrit: string; // 加密后的secret（注意泛微拼写是secrit）
}

interface TokenResponse {
  msg: string;
  code: number;
  msgShowType: string;
  status: boolean;
  token: string;
}

interface UserInfoResponse {
  code: number;
  data: {
    loginid: string;
    lastname: string;
    departmentname: string;
    email: string;
    [key: string]: unknown;
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = parseInt(process.env.OA_HTTP_TIMEOUT_MS || '1500', 10)) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// RSA公钥加密（使用 node-forge，兼容 Node v24 + OpenSSL 3.5）
function rsaEncrypt(data: string, publicKeyBase64: string): string {
  // 清理后只保留有效 base64 字符
  let b64 = publicKeyBase64.replace(/[^A-Za-z0-9+/=]/g, '');

  // OA 返回的 SPK 尾部可能多几个字符，标准 2048 位 RSA 公钥 = 392 字符
  // 通过 DER 头判断正确长度：30 82 XX XX → 总字节 = 4 + (XX XX)
  const raw = forge.util.decode64(b64);
  if (raw.charCodeAt(0) === 0x30 && raw.charCodeAt(1) === 0x82) {
    const realBytes = 4 + ((raw.charCodeAt(2) << 8) | raw.charCodeAt(3));
    const realB64Len = Math.ceil(realBytes * 4 / 3); // 向上取整到 4 的倍数
    const paddedLen = Math.ceil(realB64Len / 4) * 4;
    if (b64.length > paddedLen) {
      b64 = b64.substring(0, paddedLen);
    }
  }

  // 构建 PEM
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  const pem = `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;

  const publicKey = forge.pki.publicKeyFromPem(pem);
  const encrypted = publicKey.encrypt(data, 'RSAES-PKCS1-V1_5');
  return forge.util.encode64(encrypted);
}

// 第一步：注册许可（只需调用一次，获取OA公钥和secret）
export async function registerWithOA(): Promise<{
  spk: string;
  secret: string;
}> {
  const oaUrl = process.env.WEAVER_OA_URL;
  const appid = process.env.WEAVER_OA_APPID;

  if (!oaUrl || !appid) {
    throw new Error('WEAVER_OA_URL 或 WEAVER_OA_APPID 未配置');
  }

  const cpk = '123'; // 第三方公钥，泛微文档说可传任意值

  const url = `${oaUrl}/api/ec/dev/auth/regist`;
  console.log('[Weaver SSO] 注册请求:', url, '| appid:', appid);

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      appid,
      cpk,
    },
  });

  const text = await res.text();
  console.log('[Weaver SSO] OA原始响应:', res.status, text.slice(0, 500));

  let data: RegisterResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`OA返回非JSON（状态码${res.status}）: ${text.slice(0, 200)}`);
  }

  if (!data.status) {
    throw new Error(`注册失败: ${data.msg}`);
  }

  console.log('[Weaver SSO] 注册成功, spk:', data.spk);
  return {
    spk: data.spk,
    secret: data.secrit,
  };
}

// 第二步：获取Token（用于调用OA业务接口）
let tokenPromise: Promise<string> | null = null;

export async function getOAToken(): Promise<string> {
  if (tokenPromise) return tokenPromise;

  tokenPromise = _getOAToken().finally(() => {
    tokenPromise = null;
  });

  return tokenPromise;
}

async function _getOAToken(): Promise<string> {
  const oaUrl = process.env.WEAVER_OA_URL;
  const appid = process.env.WEAVER_OA_APPID;
  const spk = process.env.WEAVER_OA_SPK;
  const secret = process.env.WEAVER_OA_SECRET;

  if (!oaUrl || !appid || !spk || !secret) {
    throw new Error('Weaver OA环境变量未完整配置');
  }

  // 用OA公钥加密 secret+时间戳
  const time = String(Date.now());
  console.log('[Weaver SSO] getOAToken: appid=', appid, 'time=', time);

  let encryptedSecret: string;
  try {
    encryptedSecret = rsaEncrypt(secret, spk);
    console.log('[Weaver SSO] RSA加密成功, 长度:', encryptedSecret.length);
  } catch (e) {
    console.error('[Weaver SSO] RSA加密失败:', e);
    throw e;
  }

  const url = `${oaUrl}/api/ec/dev/auth/applytoken`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      appid,
      secret: encryptedSecret,
      time,
    },
  });

  const text = await res.text();
  console.log('[Weaver SSO] applytoken响应:', res.status, text.slice(0, 300));

  let data: TokenResponse;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`OA applytoken返回非JSON(${res.status}): ${text.slice(0, 200)}`);
  }

  if (!data.status) {
    throw new Error(`获取Token失败: ${data.msg}`);
  }

  return data.token;
}

// 第三步：使用Token获取用户信息（验证loginid是否有效）
export async function getUserInfoFromOA(
  loginid: string,
): Promise<UserInfoResponse['data'] | null> {
  const oaUrl = process.env.WEAVER_OA_URL;
  const appid = process.env.WEAVER_OA_APPID;

  if (!oaUrl || !appid) {
    throw new Error('Weaver OA环境变量未配置');
  }

  try {
    const token = await getOAToken();

    // 调用OA的人员信息接口验证用户
    const url = `${oaUrl}/api/hrm/resful/getHrmUserInfoByLoginId?loginid=${encodeURIComponent(loginid)}`;
    console.log('[Weaver SSO] 查询用户:', url);

    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        appid: appid!,
        token,
      },
    });

    const text = await res.text();
    console.log('[Weaver SSO] 用户查询响应:', res.status, text.slice(0, 300));

    let data: UserInfoResponse;
    try {
      data = JSON.parse(text);
    } catch {
      console.error('[Weaver SSO] 用户查询返回非JSON:', text.slice(0, 200));
      return null;
    }

    if (data.code === 0 && data.data) {
      return data.data;
    }

    console.warn('[Weaver SSO] 用户不存在或查询失败:', data);
    return null;
  } catch (error) {
    console.error('[Weaver SSO] 获取用户信息失败:', error);
    return null;
  }
}

// E9 SSO Token 验证：OA 跳转第三方时携带 ssoToken，验证后返回 loginid
export async function checkSsoToken(ssoToken: string): Promise<string | null> {
  const oaUrl = process.env.WEAVER_OA_URL;
  // SSO Token 认证使用专用 appid（认证应用管理中注册的应用标识）
  const appid = process.env.WEAVER_SSO_APPID || process.env.WEAVER_OA_APPID;

  if (!oaUrl || !appid) return null;

  try {
    // E9 标准接口：/ssologin/checkToken
    const res = await fetch(
      `${oaUrl}/ssologin/checkToken?ssoToken=${encodeURIComponent(ssoToken)}&appid=${encodeURIComponent(appid)}`,
      { method: 'GET' }
    );
    const text = await res.text();
    console.log('[Weaver SSO] checkToken响应:', res.status, text.slice(0, 200));

    // OA 返回格式：{ loginid: "xxx", ... } 或 { code: 0, loginid: "xxx" }
    const data = JSON.parse(text);
    return data.loginid || data.data?.loginid || null;
  } catch (err) {
    console.error('[Weaver SSO] checkToken失败:', err);
    return null;
  }
}

// 旧版兼容（保留不删）
export async function verifySsoToken(ssoToken: string): Promise<boolean> {
  const loginid = await checkSsoToken(ssoToken);
  return loginid !== null;
}

// 生成签名（用于验证请求来源）
export function generateSign(
  params: Record<string, string>,
  secret: string,
): string {
  const sortedKeys = Object.keys(params).sort();
  const signStr =
    sortedKeys.map((k) => `${k}=${params[k]}`).join('&') + `&secret=${secret}`;
  return crypto.createHash('md5').update(signStr).digest('hex').toUpperCase();
}

// 验证签名
export function verifySign(
  params: Record<string, string>,
  sign: string,
  secret: string,
): boolean {
  const expected = generateSign(params, secret);
  return expected === sign;
}

// ── HMAC-SHA256 签名（兼容 EntranceDddl.jsp 的 OA 单点跳转）──
// JSP 逻辑：data = loginid + "|" + timestamp; sign = Base64(HMAC-SHA256(secret, data))
export function generateHmacSign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('base64');
}

export function verifyHmacSign(
  data: string,
  sign: string,
  secret: string,
): boolean {
  try {
    const expected = generateHmacSign(data, secret);
    // 兼容 URL 编码后的 base64（+ / = 可能被编码）
    const decoded = sign.replace(/%2B/g, '+').replace(/%2F/g, '/').replace(/%3D/g, '=');
    return expected === decoded;
  } catch {
    return false;
  }
}
