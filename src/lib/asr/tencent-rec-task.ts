// 腾讯云 录音文件识别（异步 CreateRecTask）- 支持长文件 + 说话人分离
// 文档: https://cloud.tencent.com/document/product/1093/52598
// 所需 env: TENCENT_ASR_APPID, TENCENT_ASR_SECRET_ID, TENCENT_ASR_SECRET_KEY
// 所需 env: TENCENT_COS_SECRET_ID, TENCENT_COS_SECRET_KEY, TENCENT_COS_BUCKET, TENCENT_COS_REGION

import { createHmac } from 'crypto';
import COS from 'cos-nodejs-sdk-v5';

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

// ── 结果类型 ──────────────────────────────────────────────────
export interface TencentRecTaskUtterance {
  text: string;
  start_time: number;
  end_time: number;
  speaker_id: number;
}

export interface TencentRecTaskResult {
  labeledText: string;
  utterances: TencentRecTaskUtterance[];
}

// ── 上传到腾讯 COS ─────────────────────────────────────────────
async function uploadToCOS(
  wavBuffer: Buffer,
  filename: string
): Promise<string> {
  const secretId  = process.env.TENCENT_COS_SECRET_ID;
  const secretKey = process.env.TENCENT_COS_SECRET_KEY;
  const bucket    = process.env.TENCENT_COS_BUCKET;
  const region    = process.env.TENCENT_COS_REGION;

  if (!secretId || !secretKey || !bucket || !region) {
    throw new Error('未配置 TENCENT_COS_SECRET_ID / TENCENT_COS_SECRET_KEY / TENCENT_COS_BUCKET / TENCENT_COS_REGION');
  }

  const cos = new COS({
    SecretId: secretId,
    SecretKey: secretKey,
  });

  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: bucket,
        Region: region,
        Key: `asr/${filename}`,
        Body: wavBuffer,
      },
      (err, data) => {
        if (err) {
          console.error('[COS] 上传失败:', err);
          reject(err);
        } else {
          const url = `https://${bucket}.cos.${region}.myqcloud.com/asr/${filename}`;
          console.log('[COS] 上传成功:', url);
          resolve(url);
        }
      }
    );
  });
}

// ── 提交 CreateRecTask ───────────────────────────────────────────
async function submitRecTask(audioUrl: string): Promise<string> {
  const appId     = process.env.TENCENT_ASR_APPID;
  const secretId  = process.env.TENCENT_ASR_SECRET_ID;
  const secretKey = process.env.TENCENT_ASR_SECRET_KEY;

  if (!appId || !secretId || !secretKey) {
    throw new Error('未配置 TENCENT_ASR_APPID / TENCENT_ASR_SECRET_ID / TENCENT_ASR_SECRET_KEY');
  }

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
    callback_url:         '', // 不需要回调，我们轮询
  });

  const endpoint = `asr.cloud.tencent.com/asr/v2/${appId}`;
  const signature = getSignature(secretKey, 'POST', endpoint, params.toString());

  const url = `https://${endpoint}?${params}`;
  const body = JSON.stringify({
    url: audioUrl,
    name: 'meeting.wav',
  });

  console.log('[RecTask] 提交任务, URL:', audioUrl);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': signature,
      'Content-Type': 'application/json',
    },
    body,
  });

  const data = await res.json();
  console.log('[RecTask] 提交响应:', data);

  if (data.code !== 0) {
    throw new Error(`提交 RecTask 失败 [${data.code}]: ${data.message || '未知错误'}`);
  }

  return data.data.task_id;
}

// ── 轮询任务状态 ───────────────────────────────────────────────
async function pollTaskStatus(taskId: string): Promise<any> {
  const appId     = process.env.TENCENT_ASR_APPID;
  const secretId  = process.env.TENCENT_ASR_SECRET_ID;
  const secretKey = process.env.TENCENT_ASR_SECRET_KEY;

  if (!appId || !secretId || !secretKey) {
    throw new Error('未配置 TENCENT_ASR_APPID / TENCENT_ASR_SECRET_ID / TENCENT_ASR_SECRET_KEY');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    secretid:  secretId,
    timestamp: timestamp.toString(),
  });

  const endpoint = `asr.cloud.tencent.com/asr/v2/${appId}/${taskId}`;
  const signature = getSignature(secretKey, 'GET', endpoint, params.toString());

  const url = `https://${endpoint}?${params}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': signature,
    },
  });

  const data = await res.json();
  return data;
}

// ── 主函数 ────────────────────────────────────────────────────
export async function transcribeWithTencentRecTask(
  wavBuffer: Buffer,
  sampleRate = 16000
): Promise<TencentRecTaskResult> {
  const filename = `meeting-${Date.now()}.wav`;

  // 1. 上传到 COS
  const audioUrl = await uploadToCOS(wavBuffer, filename);

  // 2. 提交任务
  const taskId = await submitRecTask(audioUrl);
  console.log('[RecTask] 任务ID:', taskId);

  // 3. 轮询结果（最多 10 分钟）
  const maxAttempts = 120; // 10 分钟，每 5 秒查一次
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000)); // 5 秒间隔

    const status = await pollTaskStatus(taskId);
    console.log('[RecTask] 轮询', i + 1, '/', maxAttempts, 'status:', status.data?.task_status);

    if (status.code !== 0) {
      throw new Error(`查询任务状态失败 [${status.code}]: ${status.message || '未知错误'}`);
    }

    const taskStatus = status.data?.task_status;
    if (taskStatus === 2) {
      // 成功
      return parseRecTaskResult(status.data);
    } else if (taskStatus === 3) {
      // 失败
      throw new Error(`RecTask 失败: ${status.data?.message || '未知错误'}`);
    }
    // task_status === 0 (进行中) 或 === 1 (等待中)，继续轮询
  }

  throw new Error('RecTask 超时：10 分钟内未完成');
}

// ── 解析结果 ──────────────────────────────────────────────────
function parseRecTaskResult(data: any): TencentRecTaskResult {
  const result = data.result;
  const utterances: TencentRecTaskUtterance[] = [];

  console.log('[RecTask] 原始 result:', JSON.stringify(result).slice(0, 500));

  if (result && result.sentence_list) {
    for (const sent of result.sentence_list) {
      utterances.push({
        text: sent.text || '',
        start_time: sent.start_time || 0,
        end_time: sent.end_time || 0,
        speaker_id: sent.speaker_id ?? 0,
      });
    }
  }

  console.log('[RecTask] speaker_id 分布:', utterances.map(u => u.speaker_id));
  const labeledText = utterances
    .map(u => `说话人${Number(u.speaker_id) + 1}：${u.text}`)
    .join('\n');

  return { labeledText, utterances };
}
