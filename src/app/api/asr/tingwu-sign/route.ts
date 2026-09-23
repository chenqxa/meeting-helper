import { NextResponse } from 'next/server';

function resolveDashscopeApiKey() {
  const dashscopeKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  const qwenKey = String(process.env.QWEN_API_KEY || '').trim();
  const isRealKey = (value: string) => /^sk-[A-Za-z0-9]{16,}$/.test(value);

  if (isRealKey(dashscopeKey)) return dashscopeKey;
  if (isRealKey(qwenKey)) return qwenKey;
  return dashscopeKey || qwenKey;
}

// 返回 Qwen3-ASR Realtime 配置
export async function GET() {
  const apiKey = resolveDashscopeApiKey();
  const model = (process.env.QWEN_MODEL || 'qwen3-asr-flash-realtime').trim().toLowerCase();
  const region = (process.env.QWEN_REGION || 'cn').trim().toLowerCase();
  const defaultBase = region === 'intl'
    ? 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime'
    : 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
  const wsBaseUrl = (process.env.QWEN_WS_BASE_URL || defaultBase).trim();
  const backupBase = wsBaseUrl.includes('dashscope-intl.aliyuncs.com')
    ? 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime'
    : 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: '未配置 DASHSCOPE_API_KEY 或 QWEN_API_KEY。Qwen3 实时不能使用 ALIYUN_ACCESS_KEY_ID，需要单独配置 DashScope API Key。' },
      { status: 500 }
    );
  }

  const wsUrl = `${wsBaseUrl}?model=${encodeURIComponent(model)}`;
  const backupWsUrl = `${backupBase}?model=${encodeURIComponent(model)}`;

  return NextResponse.json({ success: true, wsUrl, backupWsUrl, apiKey });
}
