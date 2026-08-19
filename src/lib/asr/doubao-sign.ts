// 火山引擎 豆包语音识别 (Doubao / Seed-ASR) - WebSocket SAUC bigmodel
// 协议: wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
// 文档: https://www.volcengine.com/docs/6348/1581712

import WebSocket from 'ws';
import { gzipSync, gunzipSync } from 'zlib';
import { randomUUID } from 'crypto';

// ── 协议常量 ──────────────────────────────────────────────────
const PROTOCOL_VERSION  = 0x01;
const HEADER_SIZE       = 0x01;

const MSG_FULL_CLIENT   = 0x01;  // 初始 JSON 配置帧
const MSG_AUDIO_ONLY    = 0x02;  // 音频数据帧
const MSG_FULL_SERVER   = 0x09;  // 服务端完整响应
const MSG_SERVER_ERROR  = 0x0f;  // 服务端错误

const FLAG_POS_SEQ      = 0x01;  // 正序（非最后一包）
const FLAG_NEG_SEQ      = 0x03;  // 负序（最后一包）

const SER_JSON          = 0x01;
const COMP_GZIP         = 0x01;

// ── 帧构建工具 ────────────────────────────────────────────────
function buildFrame(msgType: number, flags: number, seqNum: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (PROTOCOL_VERSION << 4) | HEADER_SIZE;
  header[1] = (msgType << 4) | flags;
  header[2] = (SER_JSON << 4) | COMP_GZIP;
  header[3] = 0;

  const seqBuf = Buffer.alloc(4);
  seqBuf.writeInt32BE(seqNum, 0);

  const compressed = gzipSync(payload);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeInt32BE(compressed.length, 0);

  return Buffer.concat([header, seqBuf, sizeBuf, compressed]);
}

// ── 配置读取 ──────────────────────────────────────────────────
export function getDoubaoASRConfig() {
  const appKey    = process.env.VOLCENGINE_APP_KEY;
  const accessKey = process.env.VOLCENGINE_ACCESS_KEY;
  const resourceId = process.env.VOLCENGINE_ASR_RESOURCE_ID || 'volc.seedasr.sauc.duration';

  if (!appKey || !accessKey) {
    throw new Error('未配置 VOLCENGINE_APP_KEY / VOLCENGINE_ACCESS_KEY');
  }
  return { appKey, accessKey, resourceId };
}

export interface DoubaoASRResult {
  text: string;
  utterances?: Array<{ text: string; start_time: number; end_time: number }>;
}

// ── 主识别函数（内部 WebSocket，外部 HTTP 不变）──────────────
export async function transcribeWithDoubao(
  pcmBuffer: Buffer,
  sampleRate = 16000
): Promise<DoubaoASRResult> {
  const { appKey, accessKey, resourceId } = getDoubaoASRConfig();

  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', {
      headers: {
        'X-Api-App-Key':     appKey,
        'X-Api-Access-Key':  accessKey,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Connect-Id':  randomUUID(),
      },
    });

    let seq = 1;
    let settled = false;

    const done = (result?: DoubaoASRResult, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve(result!);
    };

    const timer = setTimeout(() => done(undefined, new Error('豆包 ASR 超时（10s）')), 10_000);

    ws.on('open', () => {
      // 1. 发送初始 JSON 配置帧
      const initJson = JSON.stringify({
        user:    { uid: 'hyzs_meeting' },
        audio:   { format: 'pcm', sample_rate: sampleRate, bits: 16, channel: 1, codec: 'raw' },
        request: { model_name: 'bigmodel', enable_punc: true, enable_itn: true, show_utterances: true },
      });
      ws.send(buildFrame(MSG_FULL_CLIENT, FLAG_POS_SEQ, seq++, Buffer.from(initJson)));

      // 2. 分块发送 PCM（每帧 3200 字节 = 100ms）
      const CHUNK = 3200;
      for (let i = 0; i < pcmBuffer.length; i += CHUNK) {
        const chunk = pcmBuffer.subarray(i, Math.min(i + CHUNK, pcmBuffer.length));
        ws.send(buildFrame(MSG_AUDIO_ONLY, FLAG_POS_SEQ, seq++, chunk));
      }

      // 3. 发送结束帧（空 payload，负序号）
      ws.send(buildFrame(MSG_AUDIO_ONLY, FLAG_NEG_SEQ, -seq, Buffer.alloc(0)));
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msgType = (raw[1] >> 4) & 0x0f;
        const flags   = raw[1] & 0x0f;
        const compress = raw[2] & 0x0f;

        if (msgType === MSG_SERVER_ERROR) {
          const errMsg = raw.slice(8).toString();
          return done(undefined, new Error(`豆包 SAUC 错误: ${errMsg}`));
        }

        if (msgType === MSG_FULL_SERVER && flags === FLAG_NEG_SEQ) {
          const payloadSize = raw.readUInt32BE(8);
          const payload     = raw.subarray(12, 12 + payloadSize);
          const payloadStr  = compress === COMP_GZIP
            ? gunzipSync(payload).toString('utf-8')
            : payload.toString('utf-8');
          const result = JSON.parse(payloadStr);
          const text = result.result?.text ?? '';
          const utterances = result.result?.utterances ?? [];
          console.log('[DoubaoASR] 识别完成:', text.slice(0, 60));
          console.log('[DoubaoASR] utterances[0]:', JSON.stringify(utterances[0]));
          done({ text, utterances });
        }
      } catch (e: any) {
        done(undefined, new Error(`豆包响应解析失败: ${e.message}`));
      }
    });

    ws.on('error', (e) => done(undefined, new Error(`豆包 WS 连接失败: ${e.message}`)));
    ws.on('close', (code) => {
      if (!settled && code !== 1000) {
        done(undefined, new Error(`豆包 WS 意外关闭: ${code}`));
      }
    });
  });
}
