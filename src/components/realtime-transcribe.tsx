'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface RealtimeTranscribeProps {
  onTranscriptUpdate: (text: string, isFinal: boolean) => void;
  onFinalTranscript: (text: string) => void;
  language?: string;
}

const checkSpeechSupport = () => {
  if (typeof window === 'undefined') return { supported: false, error: 'SSR' };
  
  const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  
  if (!SpeechRecognitionAPI) {
    return { 
      supported: false, 
      error: '您的浏览器不支持语音识别，请使用 Chrome/Edge 浏览器' 
    };
  }
  
  return { supported: true, error: null };
};

export function RealtimeTranscribe({
  onTranscriptUpdate,
  onFinalTranscript,
  language = 'zh-CN',
}: RealtimeTranscribeProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  useEffect(() => {
    const check = checkSpeechSupport();
    setIsSupported(check.supported);
    setSupportError(check.error);
    
    // 检查麦克风权限
    if (typeof navigator !== 'undefined' && navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' as any }).then((result) => {
        setHasPermission(result.state === 'granted');
        result.addEventListener('change', () => {
          setHasPermission(result.state === 'granted');
        });
      }).catch(() => {
        setHasPermission(null);
      });
    }
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognitionAPI) return;

    // 先设置状态
    setIsListening(true);
    isListeningRef.current = true;
    setErrorMsg(null);

    recognitionRef.current = new SpeechRecognitionAPI();
    const recognition = recognitionRef.current;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = language;

    recognition.onstart = () => {
      console.log('[Speech] Recognition started');
      setInterimText('');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        const confidence = event.results[i][0].confidence;
        
        console.log(`[Speech] Result ${i}:`, transcript, 'confidence:', confidence);
        
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      setInterimText(interim);
      
      // 实时更新预览
      const currentText = finalText + final + interim;
      onTranscriptUpdate(currentText, false);
      
      if (final) {
        const newFinalText = finalText + final;
        setFinalText(newFinalText);
        onFinalTranscript(final);
        onTranscriptUpdate(newFinalText, true);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('[Speech] Error:', event.error);
      
      let errorMessage = '';
      switch (event.error) {
        case 'not-allowed':
          errorMessage = '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风';
          setHasPermission(false);
          break;
        case 'no-speech':
          errorMessage = '没有检测到语音，请大声说话或检查麦克风';
          break;
        case 'network':
          errorMessage = '网络错误，请检查网络连接';
          break;
        case 'aborted':
          errorMessage = '';
          break;
        default:
          errorMessage = `识别错误: ${event.error}`;
      }
      
      if (errorMessage) {
        setErrorMsg(errorMessage);
      }
    };

    recognition.onend = () => {
      console.log('[Speech] Recognition ended, isListeningRef:', isListeningRef.current);
      // 使用 ref 检查是否应该重启
      if (isListeningRef.current) {
        try {
          recognition.start();
        } catch (e) {
          console.error('[Speech] Restart failed:', e);
        }
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error('[Speech] Start failed:', e);
      setErrorMsg('启动失败，请重试');
      setIsListening(false);
      isListeningRef.current = false;
    }
  }, [language, onFinalTranscript, onTranscriptUpdate, finalText]);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error('[Speech] Stop error:', e);
      }
      recognitionRef.current = null;
    }
    setInterimText('');
  }, []);

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      setFinalText('');
      setInterimText('');
      setErrorMsg(null);
      startListening();
    }
  };

  const clearText = () => {
    setFinalText('');
    setInterimText('');
    onTranscriptUpdate('', true);
  };

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
        <AlertCircle className="w-5 h-5" />
        <span className="text-sm">{supportError}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 权限提示 */}
      {hasPermission === false && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">请允许麦克风权限以使用语音识别</span>
        </div>
      )}

      {/* 错误提示 */}
      {errorMsg && (
        <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>{errorMsg}</span>
          <button 
            onClick={() => setErrorMsg(null)}
            className="ml-auto text-xs underline"
          >
            清除
          </button>
        </div>
      )}

      {/* 录音按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleListening}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
            isListening
              ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {isListening ? (
            <>
              <Square className="w-4 h-4" />
              <span>停止录音</span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4" />
              <span>开始录音</span>
            </>
          )}
        </button>

        {finalText && (
          <button
            onClick={clearText}
            className="flex items-center gap-1 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            清空
          </button>
        )}

        {isListening && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>正在听...</span>
          </div>
        )}
      </div>

      {/* 转写结果预览 - 始终显示当有内容时 */}
      {(finalText || interimText || isListening) && (
        <div className="p-3 bg-white border border-slate-200 rounded-lg min-h-[100px] max-h-[200px] overflow-y-auto">
          <p className="text-sm text-slate-800 whitespace-pre-wrap">
            {finalText}
            {interimText && (
              <span className="text-slate-400 italic"> {interimText}</span>
            )}
          </p>
          {!finalText && !interimText && isListening && (
            <p className="text-sm text-slate-400">请开始说话...</p>
          )}
        </div>
      )}

      {/* 状态提示 */}
      <p className="text-xs text-slate-400">
        支持中文普通话识别，建议使用 Chrome/Edge 浏览器 · 需要联网
      </p>
    </div>
  );
}
