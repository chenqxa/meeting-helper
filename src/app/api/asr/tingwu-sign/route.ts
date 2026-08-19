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
  // #region debug-point A:qwen-sign-config
  await (async()=>{let u='http://127.0.0.1:7777/event',s='qwen3-realtime-error';try{const {readFileSync}=await import('fs');const e=readFileSync('.dbg/qwen3-realtime-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'A',location:'api/asr/tingwu-sign:5',msg:'[DEBUG] qwen sign config check',data:{hasApiKey:!!apiKey,hasDashscopeKey:!!process.env.DASHSCOPE_API_KEY,hasQwenApiKey:!!process.env.QWEN_API_KEY,hasAliyunAccessKey:!!process.env.ALIYUN_ACCESS_KEY_ID,model},ts:Date.now()})}).catch(()=>{})})();
  // #endregion

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: '未配置 DASHSCOPE_API_KEY 或 QWEN_API_KEY。Qwen3 实时不能使用 ALIYUN_ACCESS_KEY_ID，需要单独配置 DashScope API Key。' },
      { status: 500 }
    );
  }

  const wsUrl = `${wsBaseUrl}?model=${encodeURIComponent(model)}`;
  const backupWsUrl = `${backupBase}?model=${encodeURIComponent(model)}`;
  // #region debug-point A:qwen-sign-success
  await (async()=>{let u='http://127.0.0.1:7777/event',s='qwen3-realtime-error';try{const {readFileSync}=await import('fs');const e=readFileSync('.dbg/qwen3-realtime-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'A',location:'api/asr/tingwu-sign:14',msg:'[DEBUG] qwen sign config ready',data:{wsUrl},ts:Date.now()})}).catch(()=>{})})();
  // #endregion

  return NextResponse.json({ success: true, wsUrl, backupWsUrl, apiKey });
}
