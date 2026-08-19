import { NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { randomUUID } from 'crypto';

// 生成腾讯云实时语音识别 WebSocket 签名 URL
// 文档: https://cloud.tencent.com/document/product/1093/48982
export async function GET() {
  const appId     = process.env.TENCENT_ASR_APPID;
  const secretId  = process.env.TENCENT_ASR_SECRET_ID;
  const secretKey = process.env.TENCENT_ASR_SECRET_KEY;

  if (!appId || !secretId || !secretKey) {
    return NextResponse.json(
      { success: false, error: '未配置腾讯 ASR 密钥' },
      { status: 500 }
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const expired = timestamp + 86400; // 24小时有效
  const nonce = timestamp + Math.floor(Math.random() * 1000);
  const voiceId = randomUUID();

  // 请求参数（不含 signature）
  const params: Record<string, string> = {
    secretid: secretId,
    timestamp: timestamp.toString(),
    expired: expired.toString(),
    nonce: nonce.toString(),
    engine_model_type: '16k_zh',           // 普通话实时流式
    voice_id: voiceId,
    voice_format: '1',                     // 1=pcm
    needvad: '1',                          // VAD
    filter_dirty: '1',                     // 过滤脏词
    filter_punc: '1',                      // 加标点
  };

  // 按字典序排列参数
  const sortedKeys = Object.keys(params).sort();
  const queryStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&');

  // 签名原文 = host/path?sortedParams
  const signStr = `asr.cloud.tencent.com/asr/v2/${appId}?${queryStr}`;

  // HmacSha1 + Base64
  const signature = createHmac('sha1', secretKey)
    .update(signStr)
    .digest('base64');

  // 最终 URL
  const wsUrl = `wss://asr.cloud.tencent.com/asr/v2/${appId}?${queryStr}&signature=${encodeURIComponent(signature)}`;

  return NextResponse.json({
    success: true,
    wsUrl,
    voiceId,
  });
}
