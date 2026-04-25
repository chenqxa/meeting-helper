// 讯飞语音识别 (Xunfei ASR) 工具
// 文档: https://www.xfyun.cn/doc/asr/voicedictation/API.html

import crypto from 'crypto';
import { WebSocket } from 'ws';

interface XfConfig {
  appId: string;
  apiKey: string;
  apiSecret: string;
}

// 生成讯飞 API 鉴权 URL
export function getXfAuthUrl(config: XfConfig): string {
  const host = 'iat-api.xfyun.cn';
  const path = '/v2/iat';
  const date = new Date().toUTCString();
  
  // 1. 构建签名原文
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
  
  // 2. HMAC-SHA256 签名
  const signature = crypto
    .createHmac('sha256', config.apiSecret)
    .update(signatureOrigin)
    .digest('base64');
  
  // 3. 构建 authorization
  const authorizationOrigin = `api_key="${config.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');
  
  // 4. 构建完整 URL
  const params = new URLSearchParams({
    authorization,
    date,
    host,
  });
  
  return `wss://${host}${path}?${params.toString()}`;
}

// 将音频数据转为讯飞要求的格式
export function encodeAudioToBase64(audioBuffer: Buffer): string {
  return audioBuffer.toString('base64');
}

export interface XfTranscriptResult {
  text: string;           // 纯文字（无说话人标注）
  labeledText: string;    // 带说话人标注：角色1: xxx\n角色2: yyy
  speakers: string[];     // 检测到的说话人列表：['角色1', '角色2', ...]
  hasSpeakers: boolean;   // 是否成功识别出多个说话人
}

// 调用讯飞 WebSocket ASR
export async function transcribeWithXf(
  config: XfConfig,
  audioBuffer: Buffer,
  sampleRate: number = 16000
): Promise<XfTranscriptResult> {
  return new Promise((resolve, reject) => {
    const authUrl = getXfAuthUrl(config);
    const ws = new WebSocket(authUrl);
    
    // 带说话人标注的段落列表：[{ role: '角色1', text: '...' }, ...]
    const segments: { role: string; text: string }[] = [];
    let lastRole = '';
    let isClosed = false;
    
    // 用于构建最终结果
    const buildResult = (): XfTranscriptResult => {
      const speakerSet = new Set(segments.map(s => s.role).filter(Boolean));
      const speakers = Array.from(speakerSet);
      const hasSpeakers = speakers.length > 1;
      
      const labeledText = segments
        .map(s => s.role ? `${s.role}: ${s.text}` : s.text)
        .join('\n');
      
      const text = segments.map(s => s.text).join('');
      
      return { text, labeledText, speakers, hasSpeakers };
    };
    
    // 音频分片大小 (每次发送 1280 字节)
    const frameSize = 1280;
    let currentPos = 0;
    
    const sendAudio = () => {
      if (isClosed) return;
      
      const endPos = Math.min(currentPos + frameSize, audioBuffer.length);
      const chunk = audioBuffer.slice(currentPos, endPos);
      const isLast = endPos >= audioBuffer.length;
      
      if (chunk.length > 0) {
        const data = {
          data: {
            status: isLast ? 2 : 1, // 1=中间, 2=最后
            format: 'audio/L16;rate=' + sampleRate,
            encoding: 'raw',
            audio: chunk.toString('base64'),
          },
        };
        ws.send(JSON.stringify(data));
        currentPos = endPos;
      }
      
      if (!isLast) {
        // 每 40ms 发送一次，模拟实时流
        setTimeout(sendAudio, 40);
      }
    };
    
    ws.on('open', () => {
      console.log('[XfASR] WebSocket connected');
      
      // 发送业务参数
      const businessParams = {
        common: {
          app_id: config.appId,
        },
        business: {
          language: 'zh_cn',
          domain: 'iat',
          accent: 'mandarin',
          dwa: 'wpgs',        // 动态修正
          ptt: 1,             // 添加标点
          roleType: 1,        // 开启说话人分离（1=开启）
          roleNum: 10,        // 最多识别10个说话人
          rlang: 'zh-cn',     // 说话人语言
        },
        data: {
          status: 0,
          format: 'audio/L16;rate=' + sampleRate,
          encoding: 'raw',
          audio: '',
        },
      };
      
      ws.send(JSON.stringify(businessParams));
      
      // 开始发送音频数据
      sendAudio();
    });
    
    ws.on('message', (data) => {
      try {
        const result = JSON.parse(data.toString());
        console.log('[XfASR] Result:', result);
        
        // 检查错误
        if (result.code !== 0) {
          reject(new Error(`ASR error: ${result.code} - ${result.message}`));
          isClosed = true;
          ws.close();
          return;
        }
        
        // 解析结果（支持说话人分离）
        if (result.data?.result?.ws) {
          const wsResults = result.data.result.ws;
          let sentence = '';
          let role = '';
          
          for (const wsItem of wsResults) {
            // 提取说话人角色（roleType 开启时）
            if (wsItem.rl !== undefined) {
              role = `角色${wsItem.rl + 1}`;
            }
            for (const cw of wsItem.cw) {
              sentence += cw.w;
            }
          }

          const pgs = result.data.result.pgs;
          
          if (pgs === 'rpl') {
            // 替换模式：替换最后一段
            if (segments.length > 0) {
              segments[segments.length - 1] = { role: role || lastRole, text: sentence };
            } else {
              segments.push({ role, text: sentence });
            }
          } else {
            // 追加模式
            // 相同角色则合并到上一段，否则新建段落
            if (role && role === lastRole && segments.length > 0) {
              segments[segments.length - 1].text += sentence;
            } else {
              if (sentence.trim()) {
                segments.push({ role, text: sentence });
                if (role) lastRole = role;
              }
            }
          }
        }
        
        // 检查是否结束
        if (result.data?.status === 2) {
          isClosed = true;
          ws.close();
          resolve(buildResult());
        }
        
      } catch (e) {
        console.error('[XfASR] Parse error:', e);
      }
    });
    
    ws.on('error', (err) => {
      console.error('[XfASR] WebSocket error:', err);
      reject(new Error('ASR 连接错误'));
    });
    
    ws.on('close', () => {
      console.log('[XfASR] WebSocket closed');
      if (!isClosed) {
        resolve(buildResult());
      }
    });
    
    // 超时处理（30秒）
    setTimeout(() => {
      if (!isClosed) {
        isClosed = true;
        ws.close();
        resolve(buildResult());
      }
    }, 30000);
  });
}
