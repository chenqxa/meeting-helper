'use client';

import { useState, useRef, useCallback } from 'react';
import { X, Bug, Lightbulb, HelpCircle, MessageSquare, ImagePlus, Loader2, FileText } from 'lucide-react';
import { ImagePreview } from '@/components/ui/image-preview';
import { FilePreview } from '@/components/ui/file-preview';

interface FeedbackItem {
  category: 'bug' | 'feature' | 'question' | 'other';
}

interface FeedbackImage {
  url: string;
  name?: string;
}

const CATEGORY_MAP: Record<string, { label: string; icon: typeof Bug; color: string; bg: string }> = {
  bug: { label: '问题反馈', icon: Bug, color: 'text-red-600', bg: 'bg-red-50' },
  feature: { label: '功能建议', icon: Lightbulb, color: 'text-amber-600', bg: 'bg-amber-50' },
  question: { label: '使用疑问', icon: HelpCircle, color: 'text-blue-600', bg: 'bg-blue-50' },
  other: { label: '其他', icon: MessageSquare, color: 'text-slate-600', bg: 'bg-slate-50' },
};

interface FeedbackSubmitDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function FeedbackSubmitDialog({ open, onClose, onSuccess }: FeedbackSubmitDialogProps) {
  const [form, setForm] = useState({ title: '', content: '', category: 'bug' as FeedbackItem['category'] });
  const [images, setImages] = useState<FeedbackImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selPreviewOpen, setSelPreviewOpen] = useState(false);
  const [selPreviewIdx, setSelPreviewIdx] = useState(0);
  const [selFilePreview, setSelFilePreview] = useState<FeedbackImage | null>(null);

  const hasContent = form.title.trim() || form.content.trim();

  const uploadImage = useCallback(async (file: File): Promise<FeedbackImage | null> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', file.type.startsWith('image/') ? 'image' : 'file');
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success && data.url) return { url: data.url, name: file.name };
    } catch { /* ignore */ }
    return null;
  }, []);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const results = await Promise.all(arr.map(uploadImage));
      const ok = results.filter((r): r is FeedbackImage => r !== null);
      if (ok.length > 0) setImages(prev => [...prev, ...ok]);
    } finally {
      setUploading(false);
    }
  }, [uploadImage]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }, [handleFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));

  const handleClose = () => {
    if (submitting || uploading) return;
    if (hasContent || images.length > 0) {
      if (!confirm('已填写的内容将丢失，确定关闭吗？')) return;
    }
    setForm({ title: '', content: '', category: 'bug' });
    setImages([]);
    onClose();
  };

  if (!open) return null;

  const handleSubmit = async () => {
    if (!form.title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, images: images.length > 0 ? images : undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setForm({ title: '', content: '', category: 'bug' });
        setImages([]);
        onSuccess?.();
        onClose();
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={handleClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-emerald-500 rounded-full" />
              提交反馈
            </h3>
            <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-50 rounded-xl transition-all">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">反馈类型</label>
              <div className="grid grid-cols-4 gap-2">
                {(Object.entries(CATEGORY_MAP) as [string, typeof CATEGORY_MAP['bug']][]).map(([key, val]) => {
                  const Icon = val.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => setForm(prev => ({ ...prev, category: key as FeedbackItem['category'] }))}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-all ${
                        form.category === key
                          ? `${val.bg} ${val.color} border-current/20 shadow-sm`
                          : 'bg-white border-slate-100 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {val.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">标题 <span className="text-red-500">*</span></label>
              <input
                className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 transition-all outline-none text-sm"
                placeholder="简要描述你遇到的问题或建议"
                value={form.title}
                onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">详细描述</label>
              <textarea
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 transition-all outline-none text-sm min-h-[120px] resize-none"
                placeholder="请详细描述问题现象、复现步骤或你的建议...（支持粘贴/拖拽截图）"
                value={form.content}
                onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
                onPaste={handlePaste}
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
              />
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {images.map((img, idx) => {
                    const isImg = /\.(jpe?g|png|gif|webp|bmp)$/i.test(img.url) || /\.(jpe?g|png|gif|webp|bmp)$/i.test(img.name || '');
                    return (
                      <div key={idx} className="relative group">
                        {isImg ? (
                          <img
                            src={img.url}
                            alt={img.name || ''}
                            className="w-20 h-20 object-cover rounded-lg border border-slate-200 cursor-zoom-in"
                            onClick={() => {
                              const imgs = images.filter(x => /\.(jpe?g|png|gif|webp|bmp)$/i.test(x.url));
                              setSelPreviewIdx(Math.max(0, imgs.indexOf(img)));
                              setSelPreviewOpen(true);
                            }}
                          />
                        ) : (
                          <button type="button" onClick={() => setSelFilePreview(img)}
                            className="w-20 h-20 rounded-lg border border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1 px-1 hover:bg-slate-100">
                            <FileText className="w-5 h-5 text-slate-400" />
                            <span className="text-[9px] text-slate-500 break-all text-center" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{img.name}</span>
                          </button>
                        )}
                        <button
                          onClick={() => removeImage(idx)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  {uploading ? '上传中...' : '添加附件'}
                </button>
                <span className="text-[11px] text-slate-400">支持粘贴/拖拽（图片/Word/Excel/PDF 等）</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 bg-slate-50/50 flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!form.title.trim() || submitting}
            className="flex-[2] py-3 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-50"
          >
            {submitting ? '提交中...' : '提交反馈'}
          </button>
        </div>
      </div>

      {/* 已选附件预览（图片放大 / 文件在线预览） */}
      <ImagePreview
        images={images.filter(x => /\.(jpe?g|png|gif|webp|bmp)$/i.test(x.url)).map(x => x.url)}
        index={selPreviewIdx}
        open={selPreviewOpen}
        onClose={() => setSelPreviewOpen(false)}
      />
      {selFilePreview && (
        <FilePreview
          url={selFilePreview.url}
          filename={selFilePreview.name || selFilePreview.url}
          open={!!selFilePreview}
          onClose={() => setSelFilePreview(null)}
        />
      )}
    </div>
  );
}
