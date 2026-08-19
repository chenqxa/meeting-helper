import crypto from 'crypto';
import { getOAToken } from './weaver-sso';

const OA_URL = () => process.env.WEAVER_OA_URL || '';
const APPID = () => process.env.WEAVER_OA_APPID || '';
const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5000';
const CONFIRM_SECRET = () => process.env.TASK_CONFIRM_SECRET || 'meeting-task-secret';

// ── 生成任务确认签名（防篡改） ──
export function signTaskToken(taskKey: string): string {
  return crypto
    .createHmac('sha256', CONFIRM_SECRET())
    .update(taskKey)
    .digest('hex')
    .slice(0, 16);
}

export function verifyTaskToken(taskKey: string, sig: string): boolean {
  return signTaskToken(taskKey) === sig;
}

// ── 搜索OA用户：优先链接服务器直查 hrmresource，回退到 HTTP API ──
export async function searchOAUsers(keyword: string): Promise<
  { loginid: string; lastname: string; departmentname: string; oaId?: string }[]
> {
  const oaUrl = OA_URL();
  const appid = APPID();
  if (!keyword?.trim()) return [];

  // 方式一：通过链接服务器直接查 hrmresource（复用共享连接池）
  try {
    const { getAppPool } = await import('./oa-task-push');
    const pool = await getAppPool();
    const linked = process.env.OA_LINKED_SERVER || 'FWsv';
    const oaDb = process.env.OA_DATABASE_NAME || 'ecology';
    const esc = (v: string) => v.replace(/'/g, "''");

    const res = await pool.request().query(`
      SELECT TOP 10
        CAST(r.id AS NVARCHAR(64)) AS oaId,
        r.loginid, r.lastname,
        ISNULL(d.departmentname, '') AS departmentname
      FROM [${linked}].[${oaDb}].[dbo].[hrmresource] r
      LEFT JOIN [${linked}].[${oaDb}].[dbo].[hrmdepartment] d ON r.departmentid = d.id
      WHERE r.lastname LIKE N'%${esc(keyword.trim())}%'
        AND r.status = 1
      ORDER BY r.id
    `);

    if (res.recordset.length > 0) {
      return res.recordset.map((u: any) => ({
        oaId: u.oaId || '',
        loginid: u.loginid || '',
        lastname: u.lastname || '',
        departmentname: u.departmentname || '',
      }));
    }
  } catch (sqlErr) {
    console.warn('[weaver-notify] SQL搜索失败，回退HTTP:', (sqlErr as Error).message);
  }

  // 方式二：回退 OA HTTP API
  if (!oaUrl || !appid) return [];
  try {
    const token = await getOAToken();
    const res = await fetch(`${oaUrl}/api/hrm/resful/getHrmUserInfoList`, {
      method: 'POST',
      headers: { appid, token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, pagesize: 20, currentpage: 1 }),
    });
    const data = await res.json();
    const list = data?.data?.datas || data?.data || data?.records || [];
    return list.map((u: any) => ({
      oaId: u.id ? String(u.id) : '',
      loginid: u.loginid || u.workcode || '',
      lastname: u.lastname || u.name || '',
      departmentname: u.departmentname || u.deptname || '',
    }));
  } catch (err) {
    console.error('[weaver-notify] searchOAUsers error:', err);
    return [];
  }
}

// ── 推送单条行动项待办消息给OA用户 ──
export async function pushTaskToOA(params: {
  loginid: string;        // 接收人 loginid
  assigneeName: string;   // 显示名
  taskKey: string;        // meetingId_itemIndex
  title: string;          // 任务标题
  description: string;    // 任务内容
  dueDate: string;
  priority: string;
  meetingTitle: string;
  meetingDate: string;
}): Promise<boolean> {
  const oaUrl = OA_URL();
  const appid = APPID();
  if (!oaUrl || !appid) {
    console.warn('[weaver-notify] OA未配置，跳过推送');
    return false;
  }

  try {
    const token = await getOAToken();
    const sig = signTaskToken(params.taskKey);
    const confirmUrl = `${APP_URL()}/task-confirm/${params.taskKey}?sig=${sig}`;

    const priorityText: Record<string, string> = { high: '高', medium: '中', low: '低' };

    const msgContent = [
      `<b>会议：</b>${params.meetingTitle}（${params.meetingDate}）`,
      `<b>任务：</b>${params.description}`,
      `<b>截止：</b>${params.dueDate || '未设定'}`,
      `<b>优先级：</b>${priorityText[params.priority] || params.priority}`,
      ``,
      `请点击下方链接确认任务状态。`,
    ].join('<br/>');

    const body = new URLSearchParams({
      sendSystem: '会议纪要系统',
      isSystemMsg: '1',
      receiverLoginIds: params.loginid,
      msgTitle: `待办任务：${params.description.slice(0, 30)}`,
      msgContent,
      pcurlopen: confirmUrl,
      appurlopen: confirmUrl,
    });

    const res = await fetch(
      `${oaUrl}/api/message/messagePortal/client/message/doCreateMessage`,
      {
        method: 'POST',
        headers: {
          appid,
          token,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }
    );

    const result = await res.json();
    if (result.code === 0 || result.status === true) {
      console.log(`[weaver-notify] 推送成功 → ${params.loginid} (${params.assigneeName})`);
      return true;
    }
    console.warn('[weaver-notify] 推送返回异常:', result);
    return false;
  } catch (err) {
    console.error('[weaver-notify] pushTaskToOA error:', err);
    return false;
  }
}

// ── 推送会议所有行动项（锁定时调用） ──
export async function pushAllActionItems(meeting: any): Promise<{
  total: number;
  sent: number;
  skipped: string[];
}> {
  const items: any[] = meeting.actionItems || [];
  const results = { total: items.length, sent: 0, skipped: [] as string[] };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const loginid: string = item.assigneeOaId || '';
    const assigneeName: string = item.assignee || item.owner || '';

    if (!loginid) {
      // 尝试按姓名搜索
      if (assigneeName) {
        const found = await searchOAUsers(assigneeName);
        if (found.length > 0) {
          item.assigneeOaId = found[0].loginid;
        }
      }
    }

    const resolvedLoginid = item.assigneeOaId || '';
    if (!resolvedLoginid) {
      results.skipped.push(assigneeName || `item-${i}`);
      continue;
    }

    const ok = await pushTaskToOA({
      loginid: resolvedLoginid,
      assigneeName,
      taskKey: `${meeting.id}_${i}`,
      title: item.description || '',
      description: item.description || '',
      dueDate: item.dueDate || item.due_date || '',
      priority: item.priority || 'medium',
      meetingTitle: meeting.title,
      meetingDate: meeting.meetingDate?.split('T')[0] || '',
    });

    if (ok) results.sent++;
    else results.skipped.push(assigneeName || `item-${i}`);
  }

  return results;
}
