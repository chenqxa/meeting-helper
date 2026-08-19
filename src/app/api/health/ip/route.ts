import { NextResponse } from 'next/server';

// GET /api/health/ip - 查看服务器出口 IP（用于 OA 认证应用白名单配置）
export async function GET() {
  const results: Record<string, string> = {};

  // 1. 外部 IP 检测服务（取第一个成功的）
  for (const url of ['http://ifconfig.me/ip', 'http://ip.3322.net', 'http://myip.ipip.net']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = (await res.text()).trim();
      const match = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (match) { results.externalIp = match[1]; break; }
    } catch { /* try next */ }
  }

  // 2. OA 视角 IP：调 OA getToken，从错误信息中提取（最准确）
  try {
    const oaUrl = process.env.WEAVER_OA_URL;
    const appid = process.env.WEAVER_OA_APPID;
    const secret = process.env.WEAVER_OA_SECRET;
    if (oaUrl && appid && secret) {
      const res = await fetch(`${oaUrl}/ssologin/getToken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&loginid=chenqiaoxia`,
        signal: AbortSignal.timeout(12000),
      });
      const text = await res.text();
      const ipMatch = text.match(/IP:\s*([\d.]+)/) || text.match(/IP\s*[:：]\s*([\d.]+)/);
      if (ipMatch) {
        results.oaViewIp = ipMatch[1];
      } else if (!text.startsWith('Token')) {
        // getToken 成功（IP 已在白名单），记下状态
        results.oaViewIp = 'IP 已在白名单（getToken 成功）';
      } else {
        results.oaViewIp = `getToken 返回: ${text.slice(0, 60)}`;
      }
    }
  } catch (e) {
    results.oaViewIp = `OA 检测失败: ${e instanceof Error ? e.message : '未知错误'}`;
  }

  return NextResponse.json({
    success: true,
    data: {
      ...results,
      note: 'externalIp 为公网出口 IP；oaViewIp 为 OA 认证应用视角的 IP（加白名单时以此为准）',
    },
  });
}
