'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Loader2, Upload, Trash2, AlertCircle, Volume2 } from 'lucide-react';
import { SpeakerLabelDialog } from '@/components/speaker-label-dialog';

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob, duration: number) => void;
  onTranscriptReceived?: (text: string) => void;
  maxDuration?: number;
}

// 获取浏览器支持的 MIME 类型
function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log('[Recorder] Supported MIME type:', type);
      return type;
    }
  }
  
  // 默认回退
  return 'audio/webm';
}

const CHUNK_SECONDS = 180; // 每 3 分钟切一段

// 浏览器端：将 Blob 转为 16kHz 16bit 单声道 PCM（不依赖 ffmpeg）
async function audioBlobToPcm16k(blob: Blob): Promise<ArrayBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const tmpCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await tmpCtx.decodeAudioData(arrayBuffer);
  await tmpCtx.close();

  const targetRate = 16000;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
  const src = offlineCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offlineCtx.destination);
  src.start(0);
  const rendered = await offlineCtx.startRendering();

  const floats = rendered.getChannelData(0);
  const pcm16 = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16.buffer;
}

// 将 PCM buffer 切成若干段
function chunkPcm(buffer: ArrayBuffer, chunkSecs: number, sampleRate = 16000): ArrayBuffer[] {
  const bytesPerChunk = chunkSecs * sampleRate * 2;
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += bytesPerChunk) {
    chunks.push(buffer.slice(offset, offset + bytesPerChunk));
  }
  return chunks;
}

export function AudioRecorder({
  onRecordingComplete,
  onTranscriptReceived,
  maxDuration = 7200, // 默认最长 2 小时
}: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [transcribeProgress, setTranscribeProgress] = useState<string>('');
  const [speakerDialogData, setSpeakerDialogData] = useState<{ speakers: string[]; labeledText: string } | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 音频电平可视化
  const startVisualization = (stream: MediaStream) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const draw = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        setAudioLevel(average);
        animationRef.current = requestAnimationFrame(draw);
      };
      
      draw();
    } catch (e) {
      console.log('[Recorder] Visualization not supported');
    }
  };

  const stopVisualization = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (analyserRef.current) {
      const ctx = analyserRef.current.context as AudioContext;
      if (ctx.state === 'running') {
        ctx.close();
      }
    }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  const startRecording = async () => {
    try {
      setError(null);
      setDebugInfo('请求麦克风权限...');
      
      // 1. 获取麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      
      streamRef.current = stream;
      setDebugInfo('麦克风权限已获取，启动录音...');

      // 2. 检测支持的 MIME 类型
      const mimeType = getSupportedMimeType();
      
      // 3. 创建 MediaRecorder
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, { mimeType });
      } catch (e) {
        // 如果不支持指定格式，使用默认
        mediaRecorder = new MediaRecorder(stream);
      }
      
      console.log('[Recorder] MediaRecorder created with MIME:', mediaRecorder.mimeType);
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      startTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        console.log('[Recorder] Data available:', event.data.size, 'bytes');
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        console.log('[Recorder] Recording stopped, chunks:', audioChunksRef.current.length);
        
        if (audioChunksRef.current.length === 0) {
          setError('录音失败：没有捕获到音频数据');
          setIsRecording(false);
          stopVisualization();
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
        
        // 使用实际录制的 MIME 类型
        const actualMimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        console.log('[Recorder] Blob created:', audioBlob.size, 'bytes, type:', actualMimeType);
        
        setAudioBlob(audioBlob);
        setAudioUrl(audioUrl);
        setRecordingTime(duration);
        onRecordingComplete(audioBlob, duration);
        setDebugInfo(`录音完成: ${audioBlob.size} bytes`);
        
        stopVisualization();
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      };

      mediaRecorder.onerror = (e: any) => {
        console.error('[Recorder] Error:', e);
        setError('录音出错: ' + (e.message || '未知错误'));
        setIsRecording(false);
        stopVisualization();
      };

      // 4. 开始录音 - 使用较大的时间片确保数据被收集
      mediaRecorder.start(1000); // 每秒收集一次
      setIsRecording(true);
      setRecordingTime(0);
      setDebugInfo('正在录音...');

      // 5. 启动可视化
      startVisualization(stream);

      // 6. 计时器
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingTime(elapsed);
        
        if (elapsed >= maxDuration) {
          stopRecording();
        }
      }, 1000);

    } catch (err: any) {
      console.error('[Recorder] Failed to start:', err);
      
      let errorMsg = '';
      if (err.name === 'NotAllowedError') {
        errorMsg = '麦克风权限被拒绝。请在浏览器地址栏点击 🔒 图标，允许麦克风访问';
      } else if (err.name === 'NotFoundError') {
        errorMsg = '没有找到麦克风设备，请检查是否已连接麦克风';
      } else if (err.name === 'NotReadableError') {
        errorMsg = '麦克风被其他应用占用，请关闭其他使用麦克风的程序';
      } else {
        errorMsg = '启动录音失败: ' + (err.message || err.name);
      }
      
      setError(errorMsg);
      setDebugInfo('');
    }
  };

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    setIsRecording(false);
  }, []);

  const clearRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    setError(null);
  };

  const handleTranscribe = async () => {
    if (!audioBlob) return;

    setIsTranscribing(true);
    setError(null);
    setTranscribeProgress('正在转写...');

    try {
      // ── 直接发原始音频到 SiliconFlow FunAudioLLM，无需 ffmpeg 或讯飞 ──
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
      const data = await res.json();

      if (!data.success) throw new Error(data.error || '转写失败');

      const text = data.text || '';
      if (!text) throw new Error('未能识别出文字，请检查录音质量');

      onTranscriptReceived?.(text);
      setTranscribeProgress(`转写完成：${text.length} 字符`);
    } catch (err: any) {
      console.error('[Recorder] Transcription error:', err);
      setError(err.message || '转写失败');
      setTranscribeProgress('');
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 说话人标注对话框 */}
      {speakerDialogData && (
        <SpeakerLabelDialog
          speakers={speakerDialogData.speakers}
          labeledText={speakerDialogData.labeledText}
          onConfirm={(mapping, finalText) => {
            setSpeakerDialogData(null);
            onTranscriptReceived?.(finalText);
            setDebugInfo(`转写成功（已标注 ${Object.keys(mapping).length} 位说话人）`);
          }}
          onSkip={(text) => {
            setSpeakerDialogData(null);
            onTranscriptReceived?.(text);
            setDebugInfo('转写成功（未标注说话人）');
          }}
        />
      )}

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
          <button 
            onClick={() => setError(null)}
            className="ml-auto text-xs underline"
          >
            清除
          </button>
        </div>
      )}

      {/* 录音按钮 */}
      {!audioBlob ? (
        <div className="flex items-center gap-4">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium transition-all ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 animate-pulse'
                : 'bg-purple-600 hover:bg-purple-700 text-white'
            }`}
          >
            {isRecording ? (
              <>
                <Square className="w-5 h-5" />
                <span>停止录音</span>
              </>
            ) : (
              <>
                <Mic className="w-5 h-5" />
                <span>开始录音</span>
              </>
            )}
          </button>

          {isRecording && (
            <div className="flex items-center gap-3 flex-1">
              {/* 音频电平可视化 */}
              <div className="flex items-center gap-2 flex-1">
                <Volume2 className={`w-4 h-4 ${audioLevel > 10 ? 'text-red-500' : 'text-slate-400'}`} />
                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-green-400 to-red-500 transition-all duration-100"
                    style={{ width: `${Math.min(audioLevel, 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-600 font-mono font-medium">
                  {formatTime(recordingTime)}
                </span>
              </div>
              <span className="text-xs text-slate-400">
                / {formatTime(maxDuration)}
              </span>
            </div>
          )}
        </div>
      ) : (
        /* 录音完成后的操作 */
        <div className="flex items-center gap-3">
          <audio 
            src={audioUrl!} 
            controls 
            className="flex-1 h-10"
          />
          <button
            onClick={handleTranscribe}
            disabled={isTranscribing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isTranscribing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>转写中...</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>转写文字</span>
              </>
            )}
          </button>
          <button
            onClick={clearRecording}
            className="p-2 text-slate-400 hover:text-red-500 transition-colors"
            title="重新录音"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 转写进度 */}
      {transcribeProgress && (
        <p className="text-xs text-blue-600 font-medium flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          {transcribeProgress}
        </p>
      )}

      {/* 调试信息 */}
      {debugInfo && !transcribeProgress && (
        <p className="text-xs text-slate-500 font-mono">{debugInfo}</p>
      )}

      {/* 提示 */}
      <p className="text-xs text-slate-400">
        支持长时间录音，自动分段转写，无需安装 ffmpeg
      </p>
    </div>
  );
}
