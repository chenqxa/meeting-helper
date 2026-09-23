'use client';

import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';

interface Props {
  images: string[];
  index?: number;
  open: boolean;
  onClose: () => void;
}

/** 图片放大预览：多图切换、左右键、ESC 关闭、下载 */
export function ImagePreview({ images, index = 0, open, onClose }: Props) {
  const [cur, setCur] = useState(index);

  useEffect(() => { setCur(index); }, [index, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setCur((c) => (c - 1 + images.length) % images.length);
      if (e.key === 'ArrowRight') setCur((c) => (c + 1) % images.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, images.length, onClose]);

  if (!open || images.length === 0) return null;
  const safeCur = Math.min(Math.max(cur, 0), images.length - 1);
  const url = images[safeCur];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
        title="关闭 (ESC)"
      >
        <X className="w-5 h-5" />
      </button>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setCur((c) => (c - 1 + images.length) % images.length); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            title="上一张 (←)"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setCur((c) => (c + 1) % images.length); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
            title="下一张 (→)"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      <img
        src={url}
        alt=""
        className="max-h-[90vh] max-w-[92vw] object-contain rounded-lg select-none"
        onClick={(e) => e.stopPropagation()}
      />

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 text-white/80 text-xs">
        <a
          href={url}
          download
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20"
        >
          <Download className="w-3.5 h-3.5" /> 下载
        </a>
        {images.length > 1 && <span>{safeCur + 1} / {images.length}</span>}
      </div>
    </div>
  );
}
