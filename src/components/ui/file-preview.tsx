'use client';

import React, { useEffect, useState } from 'react';
import { X, Download, FileText, Loader2 } from 'lucide-react';

type Kind = 'image' | 'pdf' | 'docx' | 'sheet' | 'text' | 'audio' | 'video' | 'other';

function kindOf(filename: string, mime?: string): Kind {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx' || m.includes('wordprocessingml')) return 'docx';
  if (['xlsx', 'xls'].includes(ext) || m.includes('spreadsheetml') || m === 'application/vnd.ms-excel') return 'sheet';
  if (['txt', 'md', 'csv', 'json', 'log', 'xml'].includes(ext) || m.startsWith('text/')) return 'text';
  if (m.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (m.startsWith('video/') || ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  return 'other';
}

interface Props {
  url: string;
  filename: string;
  mime?: string;
  open: boolean;
  onClose: () => void;
}

/** 通用附件预览：图片/PDF/Word/Excel/文本/音视频在线看，其余下载 */
export function FilePreview({ url, filename, mime, open, onClose }: Props) {
  const kind = kindOf(filename, mime);
  const [docHtml, setDocHtml] = useState('');
  const [sheetHtml, setSheetHtml] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDocHtml(''); setSheetHtml(''); setText(''); setError('');
    if (kind === 'docx') {
      setLoading(true);
      (async () => {
        try {
          const mod: any = await import('mammoth');
          const convert = mod?.convertToHtml || mod?.default?.convertToHtml;
          const buf = await (await fetch(url)).arrayBuffer();
          const res = await convert({ arrayBuffer: buf });
          if (!cancelled) setDocHtml(res.value || '<p>（空文档）</p>');
        } catch {
          if (!cancelled) setError('Word 预览失败，请下载查看');
        }
        if (!cancelled) setLoading(false);
      })();
    } else if (kind === 'sheet') {
      setLoading(true);
      (async () => {
        try {
          const XLSX: any = await import('xlsx');
          const buf = await (await fetch(url)).arrayBuffer();
          const wb = XLSX.read(buf, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const html = XLSX.utils.sheet_to_html(ws, { editable: false });
          if (!cancelled) setSheetHtml(html);
        } catch {
          if (!cancelled) setError('表格预览失败，请下载查看');
        }
        if (!cancelled) setLoading(false);
      })();
    } else if (kind === 'text') {
      setLoading(true);
      (async () => {
        try {
          const t = await (await fetch(url)).text();
          if (!cancelled) setText(t.slice(0, 200000));
        } catch {
          if (!cancelled) setError('文本读取失败');
        }
        if (!cancelled) setLoading(false);
      })();
    }
    return () => { cancelled = true; };
  }, [open, url, kind]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <span className="text-sm font-semibold text-slate-800 truncate">{filename}</span>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> 加载中…
            </div>
          ) : error ? (
            <div className="py-16 text-center">
              <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-red-500 mb-3">{error}</p>
            </div>
          ) : (
            <>
              {kind === 'image' && <img src={url} alt={filename} className="max-w-full h-auto rounded-xl mx-auto" />}
              {kind === 'pdf' && <iframe src={url} className="w-full h-[70vh] rounded-xl border border-slate-200" title={filename} />}
              {kind === 'docx' && <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: docHtml }} />}
              {kind === 'sheet' && <div className="text-xs [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1" dangerouslySetInnerHTML={{ __html: sheetHtml }} />}
              {kind === 'text' && <pre className="text-xs whitespace-pre-wrap break-all text-slate-700">{text}</pre>}
              {kind === 'audio' && <audio controls src={url} className="w-full" />}
              {kind === 'video' && <video controls src={url} className="max-w-full mx-auto rounded-xl" />}
              {kind === 'other' && (
                <div className="py-12 text-center">
                  <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p className="text-sm text-slate-500 mb-1">该文件类型暂不支持在线预览</p>
                  <p className="text-xs text-slate-400">请下载后查看</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100">
          <a href={url} download={filename}
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg">
            <Download className="w-3.5 h-3.5" /> 下载到本地
          </a>
        </div>
      </div>
    </div>
  );
}
