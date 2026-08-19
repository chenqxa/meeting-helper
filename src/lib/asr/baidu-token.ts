// 百度实时语音识别鉴权
// 文档: https://ai.baidu.com/ai-doc/SPEECH/Vk38lxily

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getBaiduAccessToken(): Promise<string> {
  // Token 有效期内复用
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const apiKey = process.env.BAIDU_ASR_API_KEY;
  const secretKey = process.env.BAIDU_ASR_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error('未配置 BAIDU_ASR_API_KEY / BAIDU_ASR_SECRET_KEY');
  }

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`百度Token请求超时或网络不通: ${(e as Error).message}`);
  }
  clearTimeout(timer);
  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`百度Token获取失败: ${JSON.stringify(data).slice(0, 200)}`);
  }

  cachedToken = {
    token: data.access_token,
    // expires_in 通常 2592000 秒(30天)，提前1小时过期
    expiresAt: Date.now() + (data.expires_in - 3600) * 1000,
  };

  return cachedToken.token;
}

export function getBaiduASRConfig(token: string) {
  const appid = parseInt(process.env.BAIDU_ASR_APP_ID || '0', 10);
  const appkey = process.env.BAIDU_ASR_API_KEY || '';

  return {
    provider: 'baidu' as const,
    wsUrl: `wss://vop.baidu.com/realtime_asr`,
    appid,
    appkey,
    token,
    // dev_pid: 15372 = 普通话实时识别（支持标点）
    devPid: 15372,
    sampleRate: 16000,
    frameSize: 1280,     // 40ms @ 16kHz 16bit mono = 1280 bytes
    frameInterval: 40,
  };
}
