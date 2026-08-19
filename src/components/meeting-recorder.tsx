'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Loader2, Users } from 'lucide-react';
import { normalizeTranscriptLine, normalizeTranscriptText, type TranscriptHintContext } from '@/lib/asr/transcript-normalizer';

type Provider = 'qwen_rt' | 'tencent_rt' | 'xf_rt' | 'tingwu';

// 合并多段 PCM buffer 为单个 Uint8Array
function mergePcmBuffers(buffers: ArrayBuffer[]): Uint8Array {
  const totalLen = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const buf of buffers) {
    merged.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return merged;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const PROVIDER_INFO: Record<Provider, { label: string; color: string; hint: string }> = {
  qwen_rt:   { label: 'Qwen3实时', color: 'text-violet-600', hint: 'Qwen3 实时展示，停止后自动切听悟最终稿' },
  xf_rt:     { label: '讯飞实时', color: 'text-cyan-600',   hint: '实时流式说话人分离（每字级别）' },
  tencent_rt: { label: '腾讯分段', color: 'text-orange-600', hint: 'VAD 自动切段 + Flash ASR，说话人标注准确（约 2 秒延迟）' },
  tingwu:    { label: '听悟',     color: 'text-indigo-600', hint: '阿里云实时转写，停止后精确说话人分离' },
};

interface MeetingRecorderProps {
  onTranscriptUpdate?: (fullText: string) => void;
  onRecordingEnd?: (fullText: string, audioBlob: Blob | null) => void;
  disabled?: boolean;
  participantCount?: number;
  transcriptHints?: TranscriptHintContext;
}

export default function MeetingRecorder({
  onTranscriptUpdate,
  onRecordingEnd,
  disabled,
  participantCount,
  transcriptHints,
}: MeetingRecorderProps) {
  const [provider, setProvider] = useState<Provider>('xf_rt');
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [recognizing, setRecognizing] = useState(false);
  const [finalTexts, setFinalTexts] = useState<string[]>([]);

  const [diarizationPhase, setDiarizationPhase] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [diarizationError, setDiarizationError] = useState<string>('');
  const [interimText, setInterimText] = useState<string>('');  // 腾讯实时：当前说话中的句子

  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pcmBufferRef = useRef<ArrayBuffer[]>([]);
  const fullPcmRef = useRef<ArrayBuffer[]>([]);  // 暂保留结构，当前未使用
  const sendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef(false);
  const finalTextsRef = useRef<string[]>([]);
  const recordingDurationRef = useRef(0);
  const tencentWsRef = useRef<WebSocket | null>(null);
  const xfWsRef = useRef<WebSocket | null>(null);
  const xfSessionIdRef = useRef<string>('');
  const qwenWsRef = useRef<WebSocket | null>(null);
  const tingwuWsRef = useRef<WebSocket | null>(null);
  const tingwuTaskIdRef = useRef<string | null>(null);
  const tingwuAppKeyRef = useRef<string>('');
  const tencentReconnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentBuffersRef    = useRef<ArrayBuffer[]>([]);
  const silenceSamplesRef    = useRef<number>(0);
  const segmentSamplesRef    = useRef<number>(0);
  const segmentIndexRef      = useRef<number>(0);
  const pendingSegmentsRef   = useRef<number>(0);

  // 同步 ref
  useEffect(() => { finalTextsRef.current = finalTexts; }, [finalTexts]);

  // 录音时长
  useEffect(() => {
    if (isRecording) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - start) / 1000);
        setDuration(s);
        recordingDurationRef.current = s;
      }, 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    } else {
      setDuration(0);
    }
  }, [isRecording]);

  // 文本变化回调
  useEffect(() => {
    const sep = (provider === 'qwen_rt' || provider === 'tencent_rt' || provider === 'xf_rt' || provider === 'tingwu') ? '\n' : '';
    const full = finalTexts.filter(Boolean).join(sep);
    onTranscriptUpdate?.(full);
  }, [finalTexts, onTranscriptUpdate, provider]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const cleanup = useCallback(() => {
    recordingRef.current = false;
    if (sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
    if (tencentReconnTimerRef.current) { clearInterval(tencentReconnTimerRef.current); tencentReconnTimerRef.current = null; }
    if (tencentWsRef.current) {
      try { tencentWsRef.current.send(JSON.stringify({ type: 'end' })); } catch {}
      tencentWsRef.current.close();
      tencentWsRef.current = null;
    }
    if (xfWsRef.current) {
      xfWsRef.current.close();
      xfWsRef.current = null;
    }
    if (qwenWsRef.current) {
      qwenWsRef.current.close();
      qwenWsRef.current = null;
    }
    if (tingwuWsRef.current) {
      tingwuWsRef.current.close();
      tingwuWsRef.current = null;
    }
    if (workletRef.current) { workletRef.current.disconnect(); workletRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') { mediaRecorderRef.current.stop(); }
  }, []);

  // ── 通用：初始化麦克风 + AudioWorklet ──
  const initAudio = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('麦克风不可用：请通过 HTTPS 访问本应用，或在 Chrome 中将此地址加入安全例外（chrome://flags/#unsafely-treat-insecure-origin-as-secure）');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        sampleSize: 16,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    // 存档录音（webm）
    try {
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(1000);
      mediaRecorderRef.current = mr;
    } catch { /* 不支持也没关系 */ }

    const audioCtx = new AudioContext({ sampleRate: 48000 });
    await audioCtx.audioWorklet.addModule('/pcm-processor.js');
    const source = audioCtx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioCtx, 'pcm-processor');

    pcmBufferRef.current = [];
    fullPcmRef.current = [];
    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      pcmBufferRef.current.push(e.data);
      fullPcmRef.current.push(e.data.slice(0));
    };

    source.connect(worklet);
    worklet.connect(audioCtx.destination);
    audioCtxRef.current = audioCtx;
    workletRef.current = worklet;

    if (audioCtx.state === 'suspended') await audioCtx.resume();
    return stream;
  }, []);

  const startQwenRtWs = useCallback(async () => {
    const traceId = `qwen-rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signRes = await fetch('/api/asr/tingwu-sign');
    const signData = await signRes.json();
    // #region debug-point B:qwen-client-sign
    fetch('http://127.0.0.1:7777/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'qwen3-realtime-error',runId:'pre-fix',hypothesisId:'B',location:'meeting-recorder:startQwenRtWs:sign',traceId,msg:'[DEBUG] qwen client sign response',data:{ok:!!signData.success,status:signRes.status,error:signData.error||null,hasWsUrl:!!signData.wsUrl,hasApiKey:!!signData.apiKey},ts:Date.now()})}).catch(()=>{});
    // #endregion
    if (!signData.success) throw new Error(signData.error || '获取 Qwen3 实时配置失败');

    const primaryUrl = signData.wsUrl as string;
    const backupUrl = (signData.backupWsUrl as string) || '';
    const apiKey = signData.apiKey as string;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const candidates = [primaryUrl, backupUrl].filter(Boolean);
    const buildProxyUrl = (target: string) =>
      `${protocol}//${window.location.host}/ws/asr` +
      `?target=${encodeURIComponent(target)}` +
      `&authorization=${encodeURIComponent(`Bearer ${apiKey}`)}` +
      `&openaiBeta=${encodeURIComponent('realtime=v1')}`;

    const eventId = () => `event_${Math.random().toString(36).slice(2, 12)}`;

    return new Promise<void>((resolve, reject) => {
      let connected = false;
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      const sendSessionUpdate = (socket: WebSocket) => {
        socket.send(JSON.stringify({
          event_id: eventId(),
          type: 'session.update',
          session: {
            input_audio_format: 'pcm',
            sample_rate: 16000,
            input_audio_transcription: {
              language: 'zh',
              corpus: {
                text: [
                  transcriptHints?.organizer,
                  ...(transcriptHints?.participants || []),
                  ...(transcriptHints?.terms || []),
                ].filter(Boolean).join('\n'),
              },
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.0,
              silence_duration_ms: 400,
            },
          },
        }));
      };

      const connectAttempt = (attemptIndex: number) => {
        const targetUrl = candidates[attemptIndex];
        const socket = new WebSocket(buildProxyUrl(targetUrl));
        qwenWsRef.current = socket;
        const connTimeout = setTimeout(() => {
          if (connected || settled || qwenWsRef.current !== socket) return;
          try { socket.close(); } catch {}
          if (attemptIndex + 1 < candidates.length) {
            connectAttempt(attemptIndex + 1);
          } else {
            done(() => reject(new Error('Qwen3 实时连接超时（15s），请检查 DashScope 配置或网络出口')));
          }
        }, 15000);

        socket.onopen = () => {
          if (settled || qwenWsRef.current !== socket) return;
          sendSessionUpdate(socket);
        };

        socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          const type = msg.type;
          if (type === 'session.created' || type === 'session.updated' || type === 'error' || type === 'conversation.item.input_audio_transcription.failed') {
            // #region debug-point B:qwen-client-events
            fetch('http://127.0.0.1:7777/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'qwen3-realtime-error',runId:'pre-fix',hypothesisId:'B',location:'meeting-recorder:startQwenRtWs:onmessage',traceId,msg:'[DEBUG] qwen client ws event',data:{type,error:msg.error?.message||msg.message||null},ts:Date.now()})}).catch(()=>{});
            // #endregion
          }

          if (type === 'session.created') {
            return;
          }

          if (type === 'session.updated') {
            connected = true;
            clearTimeout(connTimeout);
            done(resolve);
            sendTimerRef.current = setInterval(() => {
              if (!recordingRef.current || socket.readyState !== WebSocket.OPEN) return;
              const buffers = pcmBufferRef.current.splice(0);
              if (buffers.length === 0) return;
              const merged = mergePcmBuffers(buffers);
              const base64 = bytesToBase64(merged);
              socket.send(JSON.stringify({
                event_id: eventId(),
                type: 'input_audio_buffer.append',
                audio: base64,
              }));
              if (tingwuWsRef.current && tingwuWsRef.current.readyState === WebSocket.OPEN) {
                tingwuWsRef.current.send(merged.buffer.slice(0) as ArrayBuffer);
              }
            }, 100);
            return;
          }

          if (type === 'conversation.item.input_audio_transcription.delta' || type === 'conversation.item.input_audio_transcription.text') {
            const liveText = `${msg.delta || msg.text || ''}${msg.stash || ''}`;
            if (liveText.trim()) {
              setInterimText(normalizeTranscriptLine(liveText, transcriptHints));
              setRecognizing(true);
            }
            return;
          }

          if (type === 'conversation.item.input_audio_transcription.completed') {
            const transcript = (msg.transcript || '').trim();
            if (transcript) {
              setFinalTexts((prev) => [...prev, normalizeTranscriptLine(transcript, transcriptHints)]);
            }
            setInterimText('');
            setRecognizing(false);
            return;
          }

          if (type === 'conversation.item.input_audio_transcription.failed' || type === 'error') {
            const errMsg = msg.error?.message || msg.message || 'Qwen3 实时识别失败';
            setInterimText(`⚠️ ${errMsg}`);
            setRecognizing(false);
            return;
          }

          if (type === 'input_audio_buffer.speech_started') {
            setRecognizing(true);
            return;
          }

          if (type === 'input_audio_buffer.speech_stopped' || type === 'session.finished') {
            setRecognizing(false);
            return;
          }
        } catch (e) {
          console.warn('[QwenRT] 解析失败:', e);
        }
        };

        socket.onerror = () => {
          // #region debug-point B:qwen-client-ws-error
          fetch('http://127.0.0.1:7777/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'qwen3-realtime-error',runId:'pre-fix',hypothesisId:'B',location:'meeting-recorder:startQwenRtWs:onerror',traceId,msg:'[DEBUG] qwen client ws error',data:{readyState:socket.readyState,attempt:attemptIndex,targetUrl},ts:Date.now()})}).catch(()=>{});
          // #endregion
          clearTimeout(connTimeout);
          if (connected || settled || qwenWsRef.current !== socket) return;
          if (attemptIndex + 1 < candidates.length) {
            try { socket.close(); } catch {}
            connectAttempt(attemptIndex + 1);
            return;
          }
          done(() => reject(new Error('Qwen3 Realtime WebSocket 连接失败')));
        };

        socket.onclose = (event) => {
          // #region debug-point B:qwen-client-ws-close
          fetch('http://127.0.0.1:7777/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'qwen3-realtime-error',runId:'pre-fix',hypothesisId:'B',location:'meeting-recorder:startQwenRtWs:onclose',traceId,msg:'[DEBUG] qwen client ws close',data:{code:event.code,reason:event.reason||null,wasClean:event.wasClean,connected,attempt:attemptIndex,targetUrl},ts:Date.now()})}).catch(()=>{});
          // #endregion
          clearTimeout(connTimeout);
          if (qwenWsRef.current === socket) {
            qwenWsRef.current = null;
          }
          if (!connected && !settled && qwenWsRef.current === socket) {
            if (attemptIndex + 1 < candidates.length) {
              connectAttempt(attemptIndex + 1);
              return;
            }
            done(() => reject(new Error(event.reason || `Qwen3 Realtime WebSocket 已关闭（code=${event.code}）`)));
          }
        };
      };
      connectAttempt(0);
    });
  }, [transcriptHints]);

  // ── 讯飞 RTASR WebSocket（rl=1，实时说话人分离）──
  // 协议：二进制 PCM 帧（无 JSON 包装），响应为双层 JSON
  const startXfRtWs = useCallback(async () => {
    const signRes = await fetch('/api/asr/xf-rt-sign');
    const signData = await signRes.json();
    if (!signData.success) throw new Error(signData.error || '讯飞签名失败');

    console.log('[XfRT] 正在连接 RTASR 大模型版...');
    const ws = new WebSocket(signData.wsUrl);
    xfWsRef.current = ws;
    xfSessionIdRef.current = signData.sessionId || '';
    const xfSessionId = xfSessionIdRef.current;

    let curText = '';
    let curRole = '';

    return new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        console.log('[XfRT] RTASR 大模型版已连接，开始流式发送 PCM');
        resolve();

        sendTimerRef.current = setInterval(() => {
          if (!recordingRef.current || ws.readyState !== WebSocket.OPEN) return;
          const buffers = pcmBufferRef.current.splice(0);
          if (buffers.length === 0) return;
          const merged = mergePcmBuffers(buffers);
          if (merged.length > 0) ws.send(merged.buffer as ArrayBuffer);
        }, 40);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          const msgType = msg.msg_type;
          const data = msg.data;

          if (msgType === 'action' && data?.action === 'started') {
            console.log('[XfRT] 握手成功, sessionId:', data.sessionId);
            if (data.sessionId) xfSessionIdRef.current = data.sessionId;
            return;
          }

          if (msgType === 'action' && data?.action === 'error') {
            console.error('[XfRT] 服务端错误:', JSON.stringify(data));
            setInterimText(`❌ 讯飞错误: ${data.desc || data.code || '未知'}`);
            return;
          }

          if (msgType === 'result' && data) {
            const rt = data.cn?.st?.rt;
            if (!rt?.length) return;

            const item = rt[0];
            let text = '';
            let speakerRl = 0;
            for (const wi of (item.ws || [])) {
              for (const cw of (wi.cw || [])) {
                text += cw.w;
                const cwRl = Number(cw.rl);
                if (cwRl > 0) speakerRl = cwRl;
              }
            }
            if (!text) return;

            const role = speakerRl > 0 ? `说话人${speakerRl}` : '';

            const resultType = data.cn?.st?.type;
            const isFinal = String(resultType) === '0';
            const ls = data.ls === true;

            if (!isFinal) {
              curText = text;
              if (role) curRole = role;
              const label = curRole ? `${curRole}：` : '';
              setInterimText(normalizeTranscriptLine(`${label}${text}`, transcriptHints));
              setRecognizing(true);
            } else {
              const finalRole = role || curRole;
              const label = finalRole ? `${finalRole}：` : '';
              if (text.trim()) {
                setFinalTexts(prev => [...prev, normalizeTranscriptLine(`${label}${text}`, transcriptHints)]);
              }
              curText = '';
              curRole = '';
              setInterimText('');
              setRecognizing(false);
            }

            if (ls) {
              console.log('[XfRT] 收到最后一帧');
            }
          }
        } catch (e) { console.warn('[XfRT] 解析失败:', e); }
      };

      ws.onerror = () => reject(new Error('讯飞 RTASR 连接失败'));
      ws.onclose  = () => { xfWsRef.current = null; };
    });
  }, []);

  // ── 听悟实时 WebSocket（先创建任务获取推流 URL，再 WebSocket 推流）──
  const startTingwuWs = useCallback(async (options?: { manualAudioPump?: boolean; silentRealtime?: boolean }) => {
    const manualAudioPump = options?.manualAudioPump ?? false;
    const silentRealtime = options?.silentRealtime ?? false;
    // 1. 创建任务获取推流 URL
    const cfgRes = await fetch('/api/tingwu/config');
    const cfgData = await cfgRes.json();
    if (!cfgData.success) throw new Error(cfgData.error || '获取听悟配置失败');
    const appKey = cfgData.appKey;
    tingwuAppKeyRef.current = appKey;
    console.log('[Tingwu] appKey:', appKey);
    const createRes = await fetch('/api/tingwu/create-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speakerCount: participantCount ?? 0 }),
    });
    const createData = await createRes.json();
    if (!createData.success) throw new Error(createData.error || '听悟创建任务失败');

    const { taskId, streamUrl } = createData;
    tingwuTaskIdRef.current = taskId;
    console.log('[Tingwu] 任务创建成功, taskId:', taskId, 'streamUrl:', streamUrl);

    // 2. 连接 WebSocket 推流
    const ws = new WebSocket(streamUrl);
    tingwuWsRef.current = ws;

    let curText = '';
    let curSpeaker = '';

    // 生成随机 message_id
    const msgId = () => Math.random().toString(36).substring(2, 18).padEnd(16, '0');

    return new Promise<void>((resolve, reject) => {
      // 15 秒连接超时：防止 TranscriptionStarted 永不到达导致界面卡死
      const connTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('听悟连接超时（15s），请检查网络或听悟服务状态'));
      }, 15000);

      const done = (fn: () => void) => { clearTimeout(connTimeout); fn(); };

      ws.onopen = () => {
        console.log('[Tingwu] WebSocket 已连接，发送 StartTranscription...');

        // 必须先发 StartTranscription 指令，再推送音频
        ws.send(JSON.stringify({
          header: {
            message_id: msgId(),
            task_id: taskId,
            namespace: 'SpeechTranscriber',
            name: 'StartTranscription',
            appkey: tingwuAppKeyRef.current,
          },
          payload: {
            format: 'pcm',
            sample_rate: 16000,
            enable_intermediate_result: true,
            enable_punctuation_prediction: true,
            enable_inverse_text_normalization: false,
          },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          const name = msg.header?.name;
          const payload = msg.payload;
          console.log('[Tingwu]', name, payload?.result ?? payload?.index ?? '');

          if (name === 'TranscriptionStarted') {
            console.log('[Tingwu] 握手完成，开始流式发送 PCM');
            done(resolve);
            if (!manualAudioPump) {
              sendTimerRef.current = setInterval(() => {
                if (!recordingRef.current || ws.readyState !== WebSocket.OPEN) return;
                const buffers = pcmBufferRef.current.splice(0);
                if (buffers.length === 0) return;
                const merged = mergePcmBuffers(buffers);
                if (merged.length > 0) ws.send(merged.buffer as ArrayBuffer);
              }, 40);
            }
          } else if (name === 'SentenceEnd') {
            // 句子结束：最终识别结果（实时流 speaker_id 从 1 起，0=未识别）
            console.log('[Tingwu] SentenceEnd payload:', JSON.stringify(payload));
            const text = payload?.result || '';
            const speakerId = payload?.speaker_id;
            const speaker = (speakerId != null && Number(speakerId) > 0) ? `说话人${Number(speakerId)}` : '';
            const label = speaker ? `${speaker}：` : '';
            if (!silentRealtime && text.trim()) {
              setFinalTexts(prev => [...prev, normalizeTranscriptLine(`${label}${text}`, transcriptHints)]);
            }
            curText = '';
            curSpeaker = '';
            if (!silentRealtime) {
              setInterimText('');
              setRecognizing(false);
            }
          } else if (name === 'TranscriptionResultChanged') {
            // 句中变化：实时中间结果
            const text = payload?.result || '';
            const speakerId = payload?.speaker_id;
            const speaker = (speakerId != null && Number(speakerId) > 0) ? `说话人${Number(speakerId)}` : curSpeaker;
            curText = text;
            curSpeaker = speaker;
            const label = speaker ? `${speaker}：` : '';
            if (!silentRealtime) {
              setInterimText(normalizeTranscriptLine(`${label}${text}`, transcriptHints));
              setRecognizing(true);
            }
          } else if (name === 'SentenceBegin') {
            const speakerId = payload?.speaker_id;
            if (speakerId != null && Number(speakerId) > 0) curSpeaker = `说话人${Number(speakerId)}`;
          }
        } catch (e) { console.warn('[Tingwu] 解析失败:', e); }
      };

      ws.onerror = (e) => { console.error('[Tingwu] WebSocket 错误:', e); done(() => reject(new Error('听悟 WebSocket 连接失败'))); };
      ws.onclose = (e) => {
        console.warn('[Tingwu] WebSocket 关闭, code:', e.code, 'reason:', e.reason);
        tingwuWsRef.current = null;
        // Qwen3 双轨模式下，听悟只是后台最终稿链路；意外断开时不要打断实时录音。
        if (recordingRef.current && silentRealtime) {
          tingwuTaskIdRef.current = null;
          return;
        }
        // 若仍在录音状态则说明是意外断开，停止计时器并提示用户
        if (recordingRef.current) {
          if (!manualAudioPump && sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
          setRecognizing(false);
          setInterimText('⚠️ 与听悟的连接已断开，请停止录音并重新开始');
        }
      };
    });
  }, [transcriptHints]);

  const finalizeWithTingwuResult = useCallback((audioBlob: Blob | null, fallbackText: string) => {
    const taskId = tingwuTaskIdRef.current;
    if (!taskId) {
      setTimeout(() => {
        onRecordingEnd?.(fallbackText, audioBlob);
      }, 300);
      return;
    }

    setDiarizationPhase('uploading');
    (async () => {
      try {
        await fetch('/api/tingwu/stop-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId }),
        });
        console.log('[Tingwu] 任务已停止，开始轮询结果...');

        const maxPolls = 30;
        for (let i = 0; i < maxPolls; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const res = await fetch(`/api/tingwu/get-task?taskId=${taskId}`);
          const data = await res.json();
          if (data.success && data.taskStatus === 'COMPLETED') {
            const transcriptionUrl = data._debug?.Result?.Transcription;
            if (transcriptionUrl) {
              const proxyRes = await fetch(`/api/tingwu/get-transcription?url=${encodeURIComponent(transcriptionUrl)}`);
              const proxyData = await proxyRes.json();
              const transData = proxyData?.data;
              if (proxyData?.success && transData?.Transcription?.Paragraphs) {
                const labeledTexts = transData.Transcription.Paragraphs.map((p: any) => {
                  const speakerId = p.SpeakerId;
                  const speakerNum = speakerId != null ? parseInt(speakerId, 10) : null;
                  const speaker = (speakerNum != null && !isNaN(speakerNum) && speakerNum > 0) ? `说话人${speakerNum}` : '';
                  const label = speaker ? `${speaker}：` : '';
                  const text = p.Words?.map((w: any) => w.Text || '').join('') || '';
                  return normalizeTranscriptLine(`${label}${text}`, transcriptHints);
                }).filter(Boolean);

                if (labeledTexts.length > 0) {
                  finalTextsRef.current = labeledTexts;
                  setFinalTexts(labeledTexts);
                  setDiarizationPhase('done');
                  setTimeout(() => {
                    const fullText = normalizeTranscriptText(labeledTexts.join('\n'), transcriptHints);
                    onRecordingEnd?.(fullText, audioBlob);
                  }, 300);
                  return;
                }
              }
            }
            break;
          }
          console.log('[Tingwu] 轮询中...', data.taskStatus);
        }
      } catch (e) {
        console.warn('[Tingwu] 最终稿获取失败:', e);
        setDiarizationError(e instanceof Error ? e.message : '未知错误');
        setDiarizationPhase('error');
      }

      setTimeout(() => {
        onRecordingEnd?.(fallbackText, audioBlob);
      }, 300);
    })();
  }, [onRecordingEnd, transcriptHints]);

  // ── 腾讯分段 Flash ASR：VAD 静音切段 + Flash ASR，有说话人标注 ──
  const flushTencentSegment = useCallback(async (buffers: ArrayBuffer[]) => {
    const totalBytes = buffers.reduce((s, b) => s + b.byteLength, 0);
    if (totalBytes < 3200) return; // < 100ms，忽略

    pendingSegmentsRef.current++;
    const merged = mergePcmBuffers(buffers);
    try {
      const res = await fetch('/api/asr/tencent-flash-segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: merged.slice(0),
      });
      const data = await res.json();
      if (data.success && data.utterances?.length) {
        const lines: string[] = data.utterances
          .filter((u: any) => u.text?.trim())
          .map((u: any) => normalizeTranscriptLine(`说话人${Number(u.speaker_id) + 1}：${u.text}`, transcriptHints));
        if (lines.length > 0) setFinalTexts(prev => [...prev, ...lines]);
      } else if (!data.success) {
        console.warn('[TencentChunked] 识别失败:', data.error);
      }
    } catch (e) {
      console.warn('[TencentChunked] 请求失败:', e);
    } finally {
      pendingSegmentsRef.current = Math.max(0, pendingSegmentsRef.current - 1);
      if (pendingSegmentsRef.current === 0) {
        setInterimText('');
        setRecognizing(false);
      }
    }
  }, []);

  const startTencentChunked = useCallback(() => {
    segmentBuffersRef.current = [];
    silenceSamplesRef.current = 0;
    segmentSamplesRef.current = 0;
    segmentIndexRef.current   = 0;
    pendingSegmentsRef.current = 0;

    const SILENCE_THRESHOLD  = 500;    // Int16 RMS 低于此值视为静音
    const SILENCE_CUT_MS     = 500;    // 连续静音 500ms 触发切段
    const MIN_SEG_MS         = 1000;   // 最短段时长 1s
    const MAX_SEG_MS         = 40000;  // 最长段时长 40s（强制切）
    const SR                 = 16000;  // 16kHz

    sendTimerRef.current = setInterval(() => {
      if (!recordingRef.current) return;

      const incoming = pcmBufferRef.current.splice(0);

      if (incoming.length === 0) {
        // 无数据时积累静音（PCM worklet 每 100ms 一批，偶尔延迟）
        if (segmentSamplesRef.current > 0) {
          silenceSamplesRef.current += Math.round(SR * 0.1);
          if (silenceSamplesRef.current >= (SILENCE_CUT_MS / 1000) * SR
            && segmentSamplesRef.current >= (MIN_SEG_MS / 1000) * SR) {
            const toFlush = segmentBuffersRef.current.splice(0);
            segmentSamplesRef.current = 0;
            silenceSamplesRef.current = 0;
            segmentIndexRef.current++;
            setInterimText(`⏳ 处理第 ${segmentIndexRef.current} 段...`);
            setRecognizing(true);
            flushTencentSegment(toFlush);
          }
        }
        return;
      }

      // 计算本批 RMS
      let sumSq = 0, totalSamples = 0;
      for (const buf of incoming) {
        const s = new Int16Array(buf);
        for (let i = 0; i < s.length; i++) sumSq += s[i] * s[i];
        totalSamples += s.length;
        segmentBuffersRef.current.push(buf);
        segmentSamplesRef.current += s.length;
      }
      const rms = totalSamples > 0 ? Math.sqrt(sumSq / totalSamples) : 0;

      if (rms < SILENCE_THRESHOLD) {
        silenceSamplesRef.current += totalSamples;
      } else {
        silenceSamplesRef.current = 0;
      }

      const cutBySilence = silenceSamplesRef.current >= (SILENCE_CUT_MS / 1000) * SR
        && segmentSamplesRef.current >= (MIN_SEG_MS / 1000) * SR;
      const forceCut = segmentSamplesRef.current >= (MAX_SEG_MS / 1000) * SR;

      if (cutBySilence || forceCut) {
        const toFlush = segmentBuffersRef.current.splice(0);
        segmentSamplesRef.current = 0;
        silenceSamplesRef.current = 0;
        segmentIndexRef.current++;
        setInterimText(`⏳ 处理第 ${segmentIndexRef.current} 段...`);
        setRecognizing(true);
        flushTencentSegment(toFlush);
      }
    }, 100);

    return Promise.resolve();
  }, [flushTencentSegment]);

  // ── 统一开始录音 ──
  const startRecording = useCallback(async () => {
    if (isRecording || isConnecting) return;
    setIsConnecting(true);
    setFinalTexts([]);
    setInterimText('');
    setDiarizationPhase('idle');
    setDiarizationError('');

    try {
      await initAudio();
      recordingRef.current = true;

      if (provider === 'qwen_rt') {
        try {
          await startTingwuWs({ manualAudioPump: true, silentRealtime: true });
        } catch (err) {
          console.warn('[DualTrack] 听悟后台链路启动失败，将仅使用 Qwen3 实时结果:', err);
          tingwuTaskIdRef.current = null;
        }
        await startQwenRtWs();
      } else if (provider === 'xf_rt') {
        await startXfRtWs();
      } else if (provider === 'tencent_rt') {
        await startTencentChunked();
      } else if (provider === 'tingwu') {
        await startTingwuWs();
      }

      setIsRecording(true);
      recordingDurationRef.current = 0;
    } catch (err) {
      console.error('[ASR] 启动失败:', err);
      alert(`录音启动失败: ${err instanceof Error ? err.message : '未知错误'}`);
      cleanup();
    } finally {
      setIsConnecting(false);
    }
  }, [isRecording, isConnecting, provider, initAudio, startQwenRtWs, startXfRtWs, startTencentChunked, startTingwuWs, cleanup]);

  // ── 统一停止录音 ──
  const stopRecording = useCallback(async () => {
    if (provider === 'qwen_rt') {
      if (qwenWsRef.current && qwenWsRef.current.readyState === WebSocket.OPEN) {
        const buffers = pcmBufferRef.current.splice(0);
        if (buffers.length > 0) {
          const merged = mergePcmBuffers(buffers);
          const base64 = bytesToBase64(merged);
          qwenWsRef.current.send(JSON.stringify({
            event_id: `event_${Math.random().toString(36).slice(2, 12)}`,
            type: 'input_audio_buffer.append',
            audio: base64,
          }));
          if (tingwuWsRef.current && tingwuWsRef.current.readyState === WebSocket.OPEN) {
            tingwuWsRef.current.send(merged.buffer.slice(0) as ArrayBuffer);
          }
        }
        qwenWsRef.current.send(JSON.stringify({
          event_id: `event_${Math.random().toString(36).slice(2, 12)}`,
          type: 'session.finish',
        }));
        await new Promise(r => setTimeout(r, 800));
      }
      if (tingwuWsRef.current && tingwuWsRef.current.readyState === WebSocket.OPEN) {
        tingwuWsRef.current.send(JSON.stringify({
          header: {
            message_id: Math.random().toString(36).substring(2),
            task_id: tingwuTaskIdRef.current,
            namespace: 'SpeechTranscriber',
            name: 'StopTranscription',
            appkey: tingwuAppKeyRef.current,
          },
        }));
        await new Promise(r => setTimeout(r, 800));
      }
      cleanup();
      setIsRecording(false);
      const audioBlob = chunksRef.current.length > 0
        ? new Blob(chunksRef.current, { type: 'audio/webm' })
        : null;
      const fallbackText = normalizeTranscriptText(finalTextsRef.current.filter(Boolean).join('\n'), transcriptHints);
      finalizeWithTingwuResult(audioBlob, fallbackText);
      return;
    } else if (provider === 'xf_rt') {
      if (xfWsRef.current && xfWsRef.current.readyState === WebSocket.OPEN) {
        // 先把最后一批 PCM 二进制发出去
        const buffers = pcmBufferRef.current.splice(0);
        if (buffers.length > 0) {
          const merged = mergePcmBuffers(buffers);
          xfWsRef.current.send(merged.buffer as ArrayBuffer);
        }
        // RTASR 结束信号
        xfWsRef.current.send(JSON.stringify({ end: true, sessionId: xfSessionIdRef.current }));
        // 等待最后一句识别
        await new Promise(r => setTimeout(r, 800));
      }
    } else if (provider === 'tencent_rt') {
      // 停止 VAD 计时器，发送剩余音频段
      if (sendTimerRef.current) { clearInterval(sendTimerRef.current); sendTimerRef.current = null; }
      const remaining = segmentBuffersRef.current.splice(0);
      segmentSamplesRef.current = 0;
      if (remaining.length > 0) {
        segmentIndexRef.current++;
        setInterimText(`⏳ 处理最后一段...`);
        setRecognizing(true);
        flushTencentSegment(remaining);
      }
      // 等待所有分段处理完成（最多 15 秒）
      let waited = 0;
      while (pendingSegmentsRef.current > 0 && waited < 150) {
        await new Promise(r => setTimeout(r, 100));
        waited++;
      }
    } else if (provider === 'tingwu') {
      // 听悟实时：发送最后一批 PCM，发 StopTranscription
      if (tingwuWsRef.current && tingwuWsRef.current.readyState === WebSocket.OPEN) {
        const buffers = pcmBufferRef.current.splice(0);
        if (buffers.length > 0) {
          const merged = mergePcmBuffers(buffers);
          tingwuWsRef.current.send(merged.buffer as ArrayBuffer);
        }
        tingwuWsRef.current.send(JSON.stringify({
          header: {
            message_id: Math.random().toString(36).substring(2),
            task_id: tingwuTaskIdRef.current,
            namespace: 'SpeechTranscriber',
            name: 'StopTranscription',
            appkey: tingwuAppKeyRef.current,
          },
        }));
        await new Promise(r => setTimeout(r, 800));
      }

      // 立即停止录音 UI，轮询在后台进行
      cleanup();
      setIsRecording(false);
      const audioBlob = chunksRef.current.length > 0
        ? new Blob(chunksRef.current, { type: 'audio/webm' })
        : null;

      const fallbackText = normalizeTranscriptText(finalTextsRef.current.filter(Boolean).join('\n'), transcriptHints);
      finalizeWithTingwuResult(audioBlob, fallbackText);
      return; // 听悟走独立路径，跳过下面的公共收尾
    }

    const recDuration = recordingDurationRef.current;
    cleanup();
    setIsRecording(false);

    const audioBlob = chunksRef.current.length > 0
      ? new Blob(chunksRef.current, { type: 'audio/webm' })
      : null;

    // qwen_rt / xf_rt / tencent_rt：直接回调
    setTimeout(() => {
      const fullText = normalizeTranscriptText(finalTextsRef.current.filter(Boolean).join('\n'), transcriptHints);
      onRecordingEnd?.(fullText, audioBlob);
    }, 300);
  }, [cleanup, finalizeWithTingwuResult, flushTencentSegment, onRecordingEnd, provider, transcriptHints]);

  useEffect(() => { return () => { cleanup(); }; }, [cleanup]);

  const fullText = finalTexts.filter(Boolean).join((provider === 'qwen_rt' || provider === 'tencent_rt' || provider === 'xf_rt' || provider === 'tingwu') ? '\n' : '');
  const info = PROVIDER_INFO[provider];
  const isAnalyzing = diarizationPhase === 'uploading';

  // 自动滚动到底部
  useEffect(() => {
    const el = document.getElementById('transcript-scroll');
    if (el) el.scrollTop = el.scrollHeight;
  }, [finalTexts]);

  return (
    <div className="border border-slate-200 rounded-xl bg-white shadow-sm">
      {/* 控制栏 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        {/* 提供商切换 */}
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-xs">
          {(['qwen_rt', 'xf_rt', 'tingwu', 'tencent_rt'] as Provider[]).map(p => (
            <button
              key={p}
              onClick={() => !isRecording && setProvider(p)}
              disabled={isRecording}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                provider === p
                  ? `bg-white ${PROVIDER_INFO[p].color} shadow-sm font-medium`
                  : 'text-slate-500 hover:text-slate-700'
              } disabled:opacity-50`}
            >
              {PROVIDER_INFO[p].label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* 录音时长 + 识别状态 */}
        {isRecording && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm text-red-500 font-mono">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {formatDuration(duration)}
            </div>
            {provider === 'qwen_rt' ? (
              <span className="text-[10px] text-violet-600 flex items-center gap-1 bg-violet-50 px-1.5 py-0.5 rounded">
                <Users className="w-3 h-3" /> 真流式识别中
              </span>
            ) : provider === 'xf_rt' ? (
              <span className="text-[10px] text-cyan-600 flex items-center gap-1 bg-cyan-50 px-1.5 py-0.5 rounded">
                <Users className="w-3 h-3" /> 实时说话人分离中
              </span>
            ) : provider === 'tingwu' ? (
              <span className="text-[10px] text-indigo-600 flex items-center gap-1 bg-indigo-50 px-1.5 py-0.5 rounded">
                <Users className="w-3 h-3" /> 实时说话人分离中
              </span>
            ) : provider === 'tencent_rt' ? (
              <span className="text-[10px] text-orange-600 flex items-center gap-1 bg-orange-50 px-1.5 py-0.5 rounded">
                <Users className="w-3 h-3" /> 分段识别中
              </span>
            ) : recognizing ? (
              <span className="text-[10px] text-blue-500 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> 识别中
              </span>
            ) : null}
          </div>
        )}
        {/* 说话人分析状态（录音停止后）*/}
        {isAnalyzing && (
          <span className="text-[10px] text-purple-600 flex items-center gap-1">
            <Users className="w-3 h-3" />
            <Loader2 className="w-3 h-3 animate-spin" /> 分析说话人...
          </span>
        )}
        {diarizationPhase === 'done' && !isRecording && (
          <span className="text-[10px] text-green-600 flex items-center gap-1">
            <Users className="w-3 h-3" /> 说话人已标注
          </span>
        )}
        {diarizationPhase === 'error' && !isRecording && (
          <span className="text-[10px] text-red-500" title={diarizationError}>
            ⚠️ 说话人分析失败（见控制台）
          </span>
        )}

        {/* 录音按钮 */}
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={disabled || isConnecting}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            {isConnecting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 连接中...</>
            ) : (
              <><Mic className="w-4 h-4" /> 开始录音</>
            )}
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-slate-700 hover:bg-slate-800 text-white rounded-lg transition-colors"
          >
            <Square className="w-3.5 h-3.5" /> 停止
          </button>
        )}
      </div>

      {/* 转写结果区 */}
      {(isRecording || fullText || interimText) && (
        <div className="px-4 py-3 max-h-64 overflow-y-auto" id="transcript-scroll">
          {(fullText || interimText) ? (
            (provider === 'qwen_rt' || provider === 'tencent_rt' || provider === 'xf_rt' || provider === 'tingwu') ? (
              <div className="space-y-1.5">
                {finalTexts.filter(Boolean).map((line, i) => {
                  const match = line.match(/^(说话人\d+)：(.+)$/);
                  if (match) {
                    const colors = ['text-blue-600', 'text-emerald-600', 'text-purple-600', 'text-orange-600'];
                    const spkNum = parseInt(match[1].replace('说话人', '')) - 1;
                    return (
                      <div key={i} className="flex gap-2 text-sm">
                        <span className={`font-medium shrink-0 ${colors[spkNum % colors.length]}`}>{match[1]}</span>
                        <span className="text-slate-700">{match[2]}</span>
                      </div>
                    );
                  }
                  return <p key={i} className="text-sm text-slate-700">{line}</p>;
                })}
                {/* 实时中间结果（打字中） */}
                {interimText && (
                  <div className="flex gap-2 text-sm opacity-60 italic">
                    {(() => {
                      const m = interimText.match(/^(说话人\d+)：(.+)$/);
                      if (m) {
                        const colors = ['text-blue-600', 'text-emerald-600', 'text-purple-600', 'text-orange-600'];
                        const spkNum = parseInt(m[1].replace('说话人', '')) - 1;
                        return <><span className={`font-medium shrink-0 ${colors[spkNum % colors.length]}`}>{m[1]}</span><span className="text-slate-600">{m[2]}</span></>;
                      }
                      return <span className="text-slate-500">{interimText}</span>;
                    })()}
                    <span className="animate-pulse">▌</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{fullText}</p>
            )
          ) : (
            <p className="text-sm text-slate-400 flex items-center gap-2">
              <Mic className="w-4 h-4" /> 录音中，{info.hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
