/**
 * 企业微信消息推送
 */

import { getWeComToken } from './wecom';

const BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

/**
 * 发送文本消息给指定用户
 * @param userIds 用户ID列表（企业微信userid）
 * @param content 消息内容
 * @param agentId 应用ID
 */
export async function sendTextMessage(
  userIds: string[],
  content: string,
  agentId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getWeComToken();
    const appAgentId = agentId || process.env.WECOM_AGENT_ID;

    if (!appAgentId) {
      throw new Error('未配置企业微信应用ID (WECOM_AGENT_ID)');
    }

    const response = await fetch(`${BASE}/message/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: userIds.join('|'),
        msgtype: 'text',
        agentid: parseInt(appAgentId),
        text: {
          content,
        },
        safe: 0,
      }),
    });

    const data = await response.json();

    if (data.errcode !== 0) {
      console.error('[WeComMessage] 发送失败:', data.errmsg);
      return { success: false, error: data.errmsg };
    }

    console.log('[WeComMessage] 发送成功:', { userIds, invaliduser: data.invaliduser });
    return { success: true };
  } catch (error) {
    console.error('[WeComMessage] 发送异常:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '发送失败',
    };
  }
}

/**
 * 发送文本卡片消息（支持链接点击）
 * @param userIds 用户ID列表
 * @param title 标题
 * @param description 描述
 * @param url 跳转链接
 * @param agentId 应用ID
 */
export async function sendTextCardMessage(
  userIds: string[],
  title: string,
  description: string,
  url: string,
  agentId?: string
): Promise<{ success: boolean; error?: string; invalidUsers?: string[] }> {
  try {
    const token = await getWeComToken();
    const appAgentId = agentId || process.env.WECOM_AGENT_ID;

    if (!appAgentId) {
      throw new Error('未配置企业微信应用ID (WECOM_AGENT_ID)');
    }

    const response = await fetch(`${BASE}/message/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: userIds.join('|'),
        msgtype: 'textcard',
        agentid: parseInt(appAgentId),
        textcard: {
          title,
          description,
          url,
          btntxt: '查看详情',
        },
      }),
    });

    const data = await response.json();

    if (data.errcode !== 0) {
      console.error('[WeComMessage] 发送文本卡片失败:', data.errmsg);
      return { success: false, error: data.errmsg };
    }

    const invalidUsers = data.invaliduser ? data.invaliduser.split('|') : [];
    console.log('[WeComMessage] 文本卡片发送成功:', {
      total: userIds.length,
      invalid: invalidUsers.length,
      invalidUsers,
    });

    return {
      success: true,
      invalidUsers,
    };
  } catch (error) {
    console.error('[WeComMessage] 发送异常:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '发送失败',
    };
  }
}

/**
 * 根据姓名列表解析企业微信userid
 * 从企业微信API实时获取真实的userid
 * @param names 姓名列表
 * @param testMode 测试模式，只返回白名单中的用户
 */
export async function resolveUserIdsByNames(
  names: string[],
  testMode: boolean = false
): Promise<Map<string, string>> {
  try {
    const nameToUserId = new Map<string, string>();

    // 测试白名单
    const testWhitelist = testMode
      ? (process.env.WECOM_TEST_WHITELIST || '').split(',').map(n => n.trim()).filter(Boolean)
      : [];

    // 从企业微信API获取所有用户
    const { listAllUsers } = await import('./wecom');
    let wecomUsers: any[] = [];

    try {
      wecomUsers = await listAllUsers();
      console.log(`[WeComResolve] 从企业微信获取到 ${wecomUsers.length} 个用户`);
    } catch (error) {
      console.warn('[WeComResolve] 无法从企业微信获取用户列表，尝试使用OA数据:', error instanceof Error ? error.message : error);

      // 如果企业微信API失败，回退使用OA数据
      const { getEmployees } = await import('@/storage/database/org-storage');
      const employees = await getEmployees();

      for (const name of names) {
        const normalizedName = name.trim();
        if (!normalizedName) continue;

        if (testMode && testWhitelist.length > 0 && !testWhitelist.includes(normalizedName)) {
          continue;
        }

        const employee = employees.find(e => e.name === normalizedName && e.status === 'active');
        if (employee) {
          // 使用姓名作为userid（回退方案）
          nameToUserId.set(normalizedName, normalizedName);
          console.log(`[WeComResolve] 从OA数据匹配（回退）: ${normalizedName} -> ${normalizedName}`);
        }
      }

      return nameToUserId;
    }

    // 使用企业微信的真实userid
    for (const name of names) {
      const normalizedName = name.trim();
      if (!normalizedName) continue;

      if (testMode && testWhitelist.length > 0 && !testWhitelist.includes(normalizedName)) {
        console.log(`[WeComResolve] 测试模式，跳过非白名单用户: ${normalizedName}`);
        continue;
      }

      const user = wecomUsers.find((u: any) => u.name === normalizedName && u.status === 1);

      if (user) {
        nameToUserId.set(normalizedName, user.userid);
        console.log(`[WeComResolve] 从企业微信匹配: ${normalizedName} -> ${user.userid}`);
      } else {
        console.warn(`[WeComResolve] 未找到用户: ${normalizedName}`);
      }
    }

    if (testMode && testWhitelist.length > 0) {
      console.log(`[WeComResolve] 测试模式，白名单: ${testWhitelist.join(', ')}, 匹配: ${nameToUserId.size}个`);
    }

    return nameToUserId;
  } catch (error) {
    console.error('[WeComResolve] 解析用户ID失败:', error);
    return new Map();
  }
}
