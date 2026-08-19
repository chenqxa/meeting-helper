/**
 * 企业微信通讯录 API 客户端
 * 自动缓存 access_token（有效期 7200 秒，提前 5 分钟续期）
 */

const BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

interface TokenCache {
  token: string;
  expireAt: number; // ms timestamp
}

let _cache: TokenCache | null = null;

// 获取应用的access_token（用于发送消息）
export async function getWeComToken(): Promise<string> {
  const now = Date.now();
  if (_cache && _cache.expireAt > now + 5 * 60 * 1000) {
    return _cache.token;
  }
  const corpid = process.env.WECOM_CORPID;
  // 使用应用Secret
  const secret = process.env.WECOM_APP_SECRET;
  if (!corpid || !secret) throw new Error('企业微信未配置 WECOM_CORPID / WECOM_APP_SECRET');

  const res = await fetch(`${BASE}/gettoken?corpid=${corpid}&corpsecret=${secret}`);
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`企微获取token失败: ${data.errmsg}`);

  _cache = { token: data.access_token, expireAt: now + data.expires_in * 1000 };
  return _cache.token;
}

// 获取通讯录使用同一个token（应用Secret）
async function getContactsToken(): Promise<string> {
  return getWeComToken(); // 直接使用应用token
}

export interface WeComUser {
  userid: string;
  name: string;
  department: number[];
  mobile?: string;
  email?: string;
  status: number; // 1=已激活 2=已禁用 4=未激活 5=退出
}

// 递归拉取部门下所有成员（使用应用Secret）
export async function listAllUsers(): Promise<WeComUser[]> {
  const token = await getWeComToken(); // 使用应用token

  // 使用应用的user/list接口（可以读取可见范围内的通讯录）
  const res = await fetch(
    `${BASE}/user/list?access_token=${token}&department_id=1&fetch_child=1`
  );
  const data = await res.json();
  if (data.errcode !== 0) throw new Error(`企微拉取成员失败: ${data.errmsg}`);

  return (data.userlist || []) as WeComUser[];
}

// 按姓名找 userid（用于重新派发时解析 owner → loginid）
export async function resolveUserIdByName(name: string): Promise<string | null> {
  if (!name) return null;
  try {
    const users = await listAllUsers();
    const match = users.find(u => u.name === name && u.status === 1);
    return match?.userid || null;
  } catch (e) {
    console.warn('[WeComResolve]', (e as Error).message);
    return null;
  }
}
