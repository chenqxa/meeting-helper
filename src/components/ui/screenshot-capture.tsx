'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Camera, X, Loader2, Image as ImageIcon } from 'lucide-react';

interface ScreenshotCaptureProps {
  onCapture: (imageDataUrl: string) => void;
  disabled?: boolean;
}

export function ScreenshotCapture({ onCapture, disabled }: ScreenshotCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCapture = useCallback(async () => {
    try {
      setIsCapturing(true);
      
      // 使用 getDisplayMedia 获取屏幕/窗口/标签页
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const video = videoRef.current;
      if (!video) return;

      video.srcObject = stream;
      await video.play();

      // 等待视频加载完成
      await new Promise(resolve => {
        video.onloadedmetadata = () => resolve(null);
      });

      // 稍微延迟确保画面稳定
      await new Promise(resolve => setTimeout(resolve, 300));

      // 捕获画面
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0);

      // 停止共享
      stream.getTracks().forEach(track => track.stop());

      // 获取图片数据
      const imageDataUrl = canvas.toDataURL('image/png');
      setPreview(imageDataUrl);
      setIsCapturing(false);
    } catch (error) {
      console.error('[Screenshot] Capture failed:', error);
      setIsCapturing(false);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (preview) {
      onCapture(preview);
      setPreview(null);
    }
  }, [preview, onCapture]);

  const handleCancel = useCallback(() => {
    setPreview(null);
  }, []);

  if (preview) {
    return (
      <div className="relative inline-block">
        <img
          src={preview}
          alt="截图预览"
          className="max-w-full max-h-64 rounded-lg border border-slate-200"
        />
        <div className="absolute top-2 right-2 flex gap-2">
          <button
            onClick={handleConfirm}
            className="p-1.5 bg-emerald-500 text-white rounded-md hover:bg-emerald-600 transition-colors"
            title="确认使用"
          >
            <Camera className="w-4 h-4" />
          </button>
          <button
            onClick={handleCancel}
            className="p-1.5 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
            title="取消"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={startCapture}
        disabled={disabled || isCapturing}
        className="flex items-center gap-1.5 text-xs text-purple-600 border border-purple-200 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
      >
        {isCapturing ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 截图中...</>
        ) : (
          <><Camera className="w-3.5 h-3.5" /> 截图</>
        )}
      </button>
      
      {/* 隐藏的 video 和 canvas 元素 */}
      <video ref={videoRef} className="hidden" />
      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}
