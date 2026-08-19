// 腾讯云 录音文件识别极速版（Flash ASR）- 带说话人分离
// 文档: https://cloud.tencent.com/document/product/1093/52097
// 所需 env: TENCENT_ASR_APPID, TENCENT_ASR_SECRET_ID, TENCENT_ASR_SECRET_KEY

import { createHmac } from 'crypto';

// ── 鉴权签名（HMAC-SHA1）────────────────────────────────────────
function getSignature(
  secretKey: string,
  httpMethod: string,
  endpoint: string,
  params: string
): string {
  const str = httpMethod + endpoint + '?' + params;
  return createHmac('sha1', secretKey).update(str).digest('base64');
}

// ── PCM → WAV（添加 44 字节 RIFF 头）────────────────────────
export function pcmToWavBuffer(pcm: Buffer, sampleRate = 16000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataLen = pcm.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);          // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, pcm]);
}

// ── 结果类型 ──────────────────────────────────────────────────
export interface TencentFlashUtterance {
  text: string;
  start_time: number;
  end_time: number;
  speaker_id: number;
}

export interface TencentFlashResult {
  labeledText: string;
  utterances: TencentFlashUtterance[];
}

// ── 主函数 ────────────────────────────────────────────────────
export async function transcribeWithTencentFlash(
  wavBuffer: Buffer,
  sampleRate = 16000
): Promise<TencentFlashResult> {
  const appId     = process.env.TENCENT_ASR_APPID;
  const secretId  = process.env.TENCENT_ASR_SECRET_ID;
  const secretKey = process.env.TENCENT_ASR_SECRET_KEY;

  if (!appId || !secretId || !secretKey) {
    throw new Error('未配置 TENCENT_ASR_APPID / TENCENT_ASR_SECRET_ID / TENCENT_ASR_SECRET_KEY');
  }

  // ── 构建查询参数 ──
  const timestamp = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    engine_type:         '16k_zh',
    extra_punc:          '0',
    filter_punc:         '0',
    first_channel_only:  '1',
    secretid:            secretId,
    speaker_diarization: '1',
    timestamp:           timestamp.toString(),
    voice_format:        'wav',
    word_info:           '0',
  });

  // ── 生成签名 ──
  const endpoint = `asr.cloud.tencent.com/asr/flash/v1/${appId}`;
  const signature = getSignature(secretKey, 'POST', endpoint, params.toString());

  // ── 发送请求 ──
  console.log('[TencentFlash] 上传音频，大小:', wavBuffer.length, 'bytes');

  const url = `https://${endpoint}?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8 * 60 * 1000); // 8分钟超时

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': signature,
        'Content-Type': 'audio/wav',
      },
      body: new Uint8Array(wavBuffer),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await res.json();
  console.log('[TencentFlash] 响应:', JSON.stringify(data));

  if (data.code !== 0) {
    throw new Error(`腾讯云 Flash ASR 失败 [${data.code}]: ${data.message || '未知错误'}`);
  }

  return parseFlashResult(data);
}

// ── 解析结果 ──────────────────────────────────────────────────
function parseFlashResult(data: any): TencentFlashResult {
  const flashResult = data.flash_result || [];
  const utterances: TencentFlashUtterance[] = [];

  console.log('[Tencent] 原始 flash_result:', JSON.stringify(flashResult).slice(0, 500));

  for (const channel of flashResult) {
    const sentenceList = channel.sentence_list || [];
    for (const sent of sentenceList) {
      utterances.push({
        text: sent.text || '',
        start_time: sent.start_time || 0,
        end_time: sent.end_time || 0,
        speaker_id: sent.speaker_id ?? 0,
      });
    }
  }

  console.log('[Tencent] speaker_id 分布:', utterances.map(u => u.speaker_id));
  const labeledText = utterances
    .map(u => `说话人${Number(u.speaker_id) + 1}：${u.text}`)
    .join('\n');

  return { labeledText, utterances };
}
