import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';

// 生成讯飞 RTASR 大模型版 WebSocket 签名 URL
// 文档: https://www.xfyun.cn/doc/spark/asr_llm/rtasr_llm.html
// 与标准版区别：不同域名、不同签名算法、不同必传参数
export async function GET() {
  const appId = process.env.XF_APP_ID;
  const accessKeyId = process.env.XF_API_KEY;
  const accessKeySecret = process.env.XF_API_SECRET;

  if (!appId || !accessKeyId || !accessKeySecret) {
    return NextResponse.json(
      { success: false, error: '未配置讯飞密钥 (XF_APP_ID / XF_API_KEY / XF_API_SECRET)' },
      { status: 500 }
    );
  }

  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const utc = cst.toISOString().replace(/\.\d{3}Z$/, '+0800');
  const sessionId = `hyzs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const params: Record<string, string> = {
    appId,
    accessKeyId,
    uuid: sessionId,
    utc,
    lang: 'autodialect',
    audio_encode: 'pcm_s16le',
    samplerate: '16000',
    role_type: '2',
    pd: 'court',
  };

  const sortedKeys = Object.keys(params).sort();
  const baseString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');

  const signature = createHmac('sha1', accessKeySecret)
    .update(baseString)
    .digest('base64');

  params.signature = signature;

  const queryString = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const wsUrl = `wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1?${queryString}`;

  return NextResponse.json({ success: true, wsUrl, sessionId });
}
