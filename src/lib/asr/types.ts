// ASR 提供商类型
export type ASRProvider = 'baidu' | 'iflytek' | 'doubao';

// 前端连接 ASR 所需的配置
export interface ASRAuthConfig {
  provider: ASRProvider;
  wsUrl: string;            // WebSocket 连接地址
  // 百度专用
  appid?: number;
  appkey?: string;
  devPid?: number;
  // 通用
  sampleRate: number;       // 采样率（统一 16000）
  frameSize: number;        // 每帧字节数（40ms = 1280 bytes @ 16kHz 16bit）
  frameInterval: number;    // 发送间隔 ms
}

// 实时转写结果
export interface ASRResult {
  text: string;             // 当前句识别文本
  isFinal: boolean;         // 是否为最终结果（非中间结果）
  timestamp: number;
}
