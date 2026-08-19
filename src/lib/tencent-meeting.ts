import crypto from 'crypto';

const APPID = () => process.env.TENCENT_MEETING_APPID || '';
const SECRET_ID = () => process.env.TENCENT_MEETING_SECRET_ID || '';
const SECRET_KEY = () => process.env.TENCENT_MEETING_SECRET_KEY || '';
const BASE_URL = 'https://api.meeting.qq.com';

export interface TencentMeeting {
  meeting_id: string;
  meeting_code: string;
  subject: string;
  start_time: string;   // Unix timestamp string
  end_time: string;
  status: number;       // 1=待开始 2=进行中 3=已结束
  hosts: { userid: string; username?: string }[];
  participants?: { userid: string; username?: string }[];
}

function sign(method: string, path: string, query: string, body: string, timestamp: number, nonce: number): string {
  const lines = [method, path, query, `X-TC-Key=${APPID()}&X-TC-Nonce=${nonce}&X-TC-Timestamp=${timestamp}`, body].join('\n');
  return crypto.createHmac('sha256', SECRET_KEY()).update(lines).digest('hex');
}

async function tmRequest<T>(method: 'GET' | 'POST', path: string, query: Record<string, string> = {}, body?: object): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.floor(Math.random() * 999999999);
  const qs = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const bodyStr = body ? JSON.stringify(body) : '';
  const sig = sign(method, path, qs, bodyStr, timestamp, nonce);

  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-TC-Key': APPID(),
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Nonce': String(nonce),
      'X-TC-Signature': sig,
      'AppId': APPID(),
      'SdkId': SECRET_ID(),
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[TencentMeeting] HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// 查询用户的会议列表（最近 N 天）
export async function listMeetings(userid: string, days = 30): Promise<TencentMeeting[]> {
  const start_time = Math.floor(Date.now() / 1000 - days * 86400);
  const end_time = Math.floor(Date.now() / 1000 + 7 * 86400);
  const res: any = await tmRequest('GET', '/v1/meetings', {
    userid,
    instanceid: '1',
    start_time: String(start_time),
    end_time: String(end_time),
  });
  return res.meeting_info_list || [];
}

// 查询会议详情（含参会人）
export async function getMeetingDetail(meeting_id: string, userid: string): Promise<TencentMeeting | null> {
  try {
    const res: any = await tmRequest('GET', `/v1/meetings/${meeting_id}`, { userid, instanceid: '1' });
    return res.meeting_info || null;
  } catch { return null; }
}

// 查询参会人员
export async function getMeetingParticipants(meeting_id: string, userid: string): Promise<{ userid: string; username: string }[]> {
  try {
    const res: any = await tmRequest('GET', `/v1/meetings/${meeting_id}/participants`, { userid });
    return (res.participants || []).map((p: any) => ({ userid: p.userid || '', username: p.username || p.userid || '' }));
  } catch { return []; }
}
