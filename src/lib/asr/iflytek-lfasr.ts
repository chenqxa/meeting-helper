// 讯飞录音文件识别（LFASR v2）— 带说话人分离
// 文档: https://www.xfyun.cn/doc/asr/lfasr/API.html
// 所需 env: IFLYTEK_ASR_APPID + IFLYTEK_LFASR_SECRET_KEY

import { createHash, createHmac } from 'crypto';

// ── 鉴权签名 ──────────────────────────────────────────────────
function getSigna(appId: string, secretKey: string, ts: string): string {
  const md5 = createHash('md5').update(appId + ts).digest('hex');
  return createHmac('sha1', secretKey).update(md5).digest('base64');
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
export interface LFASRUtterance {
  speaker: string;     // "说话人1" / "说话人2" ...
  text: string;
  beginTime: number;   // ms
  endTime: number;
}

export interface LFASRResult {
  labeledText: string;             // "说话人1：...\n说话人2：..."
  utterances: LFASRUtterance[];
}

// ── 主函数 ────────────────────────────────────────────────────
export async function transcribeWithLFASR(
  wavBuffer: Buffer,
  durationSeconds: number,
  speakerNum = 0   // 0=自动检测说话人数
): Promise<LFASRResult> {
  const appId     = process.env.IFLYTEK_ASR_APPID     || process.env.XF_APP_ID;
  const secretKey = process.env.IFLYTEK_LFASR_SECRET_KEY || process.env.XF_API_SECRET;

  if (!appId || !secretKey) {
    throw new Error('未配置讯飞凭证：需要 IFLYTEK_ASR_APPID + IFLYTEK_LFASR_SECRET_KEY（或 XF_APP_ID + XF_API_SECRET）');
  }

  // ── 1. 上传音频 ──
  const ts = Math.floor(Date.now() / 1000).toString();
  const signa = getSigna(appId, secretKey, ts);

  const uploadParams = new URLSearchParams({
    appId,
    signa,
    ts,
    fileSize:     wavBuffer.length.toString(),
    fileName:     'meeting.wav',
    duration:     Math.ceil(durationSeconds).toString(),
    roleType:     '1',                          // 开启说话人分离
    roleNum:      speakerNum.toString(),         // 0=自动
    language:     'cn',
    pd:           'court',                       // 会议场景
  });

  console.log('[LFASR] 上传音频，大小:', wavBuffer.length, 'bytes，时长:', durationSeconds, 's');

  const uploadRes = await fetch(
    `https://raasr.xfyun.cn/v2/api/upload?${uploadParams}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(wavBuffer),
    }
  );

  const uploadData = await uploadRes.json();
  console.log('[LFASR] 上传响应:', JSON.stringify(uploadData));

  if (uploadData.code !== '000000') {
    throw new Error(`LFASR 上传失败 [${uploadData.code}]: ${uploadData.descInfo}`);
  }

  const orderId: string = uploadData.content.orderId;
  console.log('[LFASR] 任务ID:', orderId);

  // ── 2. 轮询结果（最多等 15 分钟）──
  const MAX_POLLS = 180;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, 5000)); // 每 5 秒查一次

    const qts = Math.floor(Date.now() / 1000).toString();
    const qSigna = getSigna(appId, secretKey, qts);
    const queryParams = new URLSearchParams({ appId, signa: qSigna, ts: qts, orderId });

    const qRes  = await fetch(`https://raasr.xfyun.cn/v2/api/getResult?${queryParams}`);
    const qData = await qRes.json();

    if (qData.code !== '000000') {
      throw new Error(`LFASR 查询失败 [${qData.code}]: ${qData.descInfo}`);
    }

    const orderInfo = qData.content?.orderInfo;
    const status    = orderInfo?.status;
    console.log(`[LFASR] 第 ${i + 1} 次查询，状态:`, status);

    if (status === 4) {
      // 识别完成
      return parseOrderResult(qData.content?.orderResult);
    } else if (status === -1) {
      throw new Error('LFASR 识别失败（服务端错误）');
    }
    // status: 0=等待 1=处理中 2=处理中 3=处理中
  }

  throw new Error('LFASR 超时（15分钟）');
}

// ── 解析结果 ──────────────────────────────────────────────────
function parseOrderResult(orderResult: any): LFASRResult {
  if (!orderResult) return { labeledText: '', utterances: [] };

  let raw: any;
  try {
    raw = typeof orderResult === 'string' ? JSON.parse(orderResult) : orderResult;
  } catch {
    return { labeledText: String(orderResult), utterances: [] };
  }

  const utterances: LFASRUtterance[] = [];

  // 说话人结果在 lattice2 或 lattice 字段
  const lattice = raw.lattice2 || raw.lattice || [];
  for (const seg of lattice) {
    const speakerIdx = seg.json_1best?.st?.rl ?? seg.rl ?? 0;
    const label = `说话人${Number(speakerIdx) + 1}`;

    const rtArr = seg.json_1best?.st?.rt || [];
    const words = rtArr.flatMap((rt: any) => rt.ws || [])
      .flatMap((ws: any) => ws.cw || [])
      .map((cw: any) => cw.w || '')
      .join('');

    if (words.trim()) {
      utterances.push({
        speaker:   label,
        text:      words,
        beginTime: Number(seg.json_1best?.st?.bg || 0),
        endTime:   Number(seg.json_1best?.st?.ed || 0),
      });
    }
  }

  const labeledText = utterances
    .map(u => `${u.speaker}：${u.text}`)
    .join('\n');

  return { labeledText, utterances };
}
