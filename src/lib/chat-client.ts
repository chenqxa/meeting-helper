// 对话系统客户端封装
// 用于通过 OA 用户 ID 批量发送 IM 消息

import https from 'https';

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

interface LoginResponse {
  errCode: number;
  errMsg: string;
  errDlt: string;
  data: {
    adminAccount: string;
    adminToken: string;
    nickname: string;
    faceURL: string;
    level: number;
    adminUserID: string;
    imUserID: string;
    imToken: string;
  };
}

interface BatchSendResponse {
  errCode: number;
  errMsg: string;
  errDlt: string;
  data: {
    results: Array<{
      oaUserId: string;
      recvID: string;
      sendTime: number;
      idempotentHit?: boolean;
    }>;
    failedOaUserIds: Array<{
      oaUserId: string;
      code: string;
      reason: string;
    }>;
  };
}

interface ResolveOAUserIdsResponse {
  errCode: number;
  errMsg: string;
  errDlt: string;
  data: {
    mapped: Array<{
      oaUserId: string;
      userID: string;
    }>;
    unmapped: string[];
    duplicateMapped: string[];
  };
}

const CHAT_ADMIN_API_BASE_URL = process.env.CHAT_ADMIN_API_BASE_URL || '';
const CHAT_API_BASE_URL = process.env.CHAT_API_BASE_URL || '';
const CHAT_ADMIN_ACCOUNT = process.env.CHAT_ADMIN_ACCOUNT || '';
const CHAT_ADMIN_PASSWORD = process.env.CHAT_ADMIN_PASSWORD || '';
const CHAT_SENDER_USER_ID = process.env.CHAT_SENDER_USER_ID || '';

let cachedAdminToken: string | null = null;
let tokenExpireTime: number = 0;

// 生成唯一 operationID
const generateOperationID = (prefix: string): string => {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 14);
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${timestamp}-${random}`;
};

// 获取管理员 Token
export async function getAdminToken(): Promise<string> {
  if (!CHAT_ADMIN_API_BASE_URL || !CHAT_ADMIN_ACCOUNT || !CHAT_ADMIN_PASSWORD) {
    throw new Error('未配置对话系统环境变量：CHAT_ADMIN_API_BASE_URL, CHAT_ADMIN_ACCOUNT, CHAT_ADMIN_PASSWORD');
  }

  // 检查缓存是否有效（假设 token 有效期 24 小时）
  if (cachedAdminToken && Date.now() < tokenExpireTime) {
    return cachedAdminToken;
  }

  const response = await fetch(`${CHAT_ADMIN_API_BASE_URL}/account/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'operationID': generateOperationID('oa-login'),
    },
    body: JSON.stringify({
      account: CHAT_ADMIN_ACCOUNT,
      password: CHAT_ADMIN_PASSWORD,
    }),
  });

  const result: LoginResponse = await response.json();

  if (result.errCode !== 0) {
    throw new Error(`对话系统登录失败: ${result.errMsg} (${result.errDlt})`);
  }

  cachedAdminToken = result.data.adminToken;
  tokenExpireTime = Date.now() + 24 * 60 * 60 * 1000; // 24 小时后过期

  return cachedAdminToken;
}

// 批量发送 OA 消息
export async function batchSendOAUserMessage(params: {
  oaUserIds: string[];
  content: string;
  ex?: string;
  idempotencyKey?: string;
}): Promise<BatchSendResponse> {
  if (!CHAT_API_BASE_URL || !CHAT_SENDER_USER_ID) {
    throw new Error('未配置对话系统环境变量：CHAT_API_BASE_URL, CHAT_SENDER_USER_ID');
  }

  const adminToken = await getAdminToken();

  const response = await fetch(`${CHAT_API_BASE_URL}/msg/batch_send_msg_by_oa`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'operationID': generateOperationID('oa-batch-send'),
      'token': adminToken,
    },
    body: JSON.stringify({
      oaUserIds: params.oaUserIds,
      sendID: CHAT_SENDER_USER_ID,
      content: params.content,
      ex: params.ex,
      idempotencyKey: params.idempotencyKey,
    }),
  });

  const result: BatchSendResponse = await response.json();

  if (result.errCode !== 0) {
    throw new Error(`批量发送消息失败: ${result.errMsg} (${result.errDlt})`);
  }

  return result;
}

// 检查 OA 用户 ID 映射情况
export async function resolveOAUserIds(oaUserIds: string[]): Promise<ResolveOAUserIdsResponse> {
  if (!CHAT_API_BASE_URL) {
    throw new Error('未配置对话系统环境变量：CHAT_API_BASE_URL');
  }

  const adminToken = await getAdminToken();

  const response = await fetch(`${CHAT_API_BASE_URL}/msg/resolve_oa_user_ids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'operationID': generateOperationID('oa-resolve'),
      'token': adminToken,
    },
    body: JSON.stringify({ oaUserIds }),
  });

  const result: ResolveOAUserIdsResponse = await response.json();

  if (result.errCode !== 0) {
    throw new Error(`解析 OA 用户 ID 失败: ${result.errMsg} (${result.errDlt})`);
  }

  return result;
}
