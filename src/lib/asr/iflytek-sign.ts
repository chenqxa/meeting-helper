// 讯飞实时语音转写(RTASR)鉴权
// 文档: https://www.xfyun.cn/doc/asr/rtasr/API.html

import { createHash, createHmac } from 'crypto';

export function getIflytekASRConfig() {
  const appid = process.env.IFLYTEK_ASR_APPID;
  const apiKey = process.env.IFLYTEK_ASR_API_KEY;
  if (!appid || !apiKey) {
    throw new Error('未配置 IFLYTEK_ASR_APPID / IFLYTEK_ASR_API_KEY');
  }

  const ts = Math.floor(Date.now() / 1000).toString();
  const baseString = appid + ts;
  const md5Result = createHash('md5').update(baseString).digest('hex');
  const signa = createHmac('sha1', apiKey).update(md5Result).digest('base64');

  const wsUrl = `wss://rtasr.xfyun.cn/v1/ws?appid=${appid}&ts=${ts}&signa=${encodeURIComponent(signa)}`;

  return {
    provider: 'iflytek' as const,
    wsUrl,
    sampleRate: 16000,
    frameSize: 1280,     // 40ms @ 16kHz 16bit mono
    frameInterval: 40,
  };
}
