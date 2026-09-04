'use client';

// 会议看板「✓ 已完成项」完成详情弹窗（周例会 / 月度 / 产销会共用）
// 展示：任务基本信息 + 完成情况说明 + 证明附件（本地 /api/files 图片内嵌预览/放大/下载，其余文件打开/下载）
// 说明文本展示前清洗导入元数据（getDisplayOaResult），附件仅按 /api/files 前缀白名单判定可开。
import React, { useEffect, useState } from 'react';
import { X, FileText, Download, ExternalLink, ImageIcon, CheckCircle2, XCircle, MinusCircle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDisplayOaResult } from '@/lib/oa-result-display';

// 看板行对象里与详情相关的字段（各看板 BoardItem 需带上这些可选字段）
export interface DoneDetailItem {
  id: string;
  description: string;
  owner?: string | null;
  dept?: string | null;
  proposer?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  completion_note?: string | null;
  oa_result?: string | null;
  oa_score?: number | null;
  oa_attachments?: (string | null)[] | null;
  evidence_files?: (string | null)[] | null;
  meeting_title?: string | null;
}

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const isLocalFile = (u: unknown): u is string => typeof u === 'string' && u.startsWith('/api/files/');
function isImageUrl(u: string): boolean {
  const noQuery = u.split('?')[0];
  const ext = noQuery.slice(noQuery.lastIndexOf('.') + 1).toLowerCase();
  return IMG_EXT.has(ext);
}
function fileNameOf(u: string): string {
  const seg = u.split('/').filter(Boolean).pop() || 'attachment';
  try { return decodeURIComponent(seg); } catch { return seg; }
}

function formatDateTime(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  // 东八区显示（填报/完成时间均为北京时间口径）
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`;
}

export default function ActionDoneDetailDialog({ item, onClose }: { item: DoneDetailItem | null; onClose: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Esc 关闭（不与其他全局键冲突；弹窗仅在客户端点击后渲染）
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const desc = String(item.description || '');
  const note = getDisplayOaResult(item.oa_result) || getDisplayOaResult(item.completion_note);
  const localAtts = (item.oa_attachments || []).filter(isLocalFile);
  const legacyCount = (item.oa_attachments || []).length - localAtts.length; // OA 历史 token/docid
  const evidNames = (item.evidence_files || []).filter((f): f is string => !!f);
  const imgAtts = localAtts.filter(isImageUrl);
  const otherAtts = localAtts.filter(u => !isImageUrl(u));

  const scoreBadge =
    item.oa_score === 1 ? { label: 'V 已完成', cls: 'bg-emerald-100 text-emerald-700', Icon: CheckCircle2 } :
    item.oa_score === -1 ? { label: 'X 未完成', cls: 'bg-red-100 text-red-600', Icon: XCircle } :
    item.oa_score === 0 ? { label: '0 待定', cls: 'bg-blue-100 text-blue-700', Icon: MinusCircle } :
    { label: '未稽核', cls: 'bg-slate-100 text-slate-500', Icon: MinusCircle };

  return (
    <>
      <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
        <div
          className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已完成
              </span>
              <h3 className="text-lg font-bold text-slate-800">任务完成详情</h3>
              {item.meeting_title && <span className="text-xs text-slate-400">· {item.meeting_title}</span>}
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* 基本信息 */}
            <section>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-widest mb-2">任务信息</div>
              <p className="text-[15px] text-slate-800 leading-relaxed whitespace-pre-wrap break-words">{desc}</p>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <span className="text-slate-400 w-12 flex-shrink-0">责任人</span>
                  <span className="font-medium text-slate-800">{item.owner || '待分配'}{item.dept ? ` · ${item.dept}` : ''}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <span className="text-slate-400 w-12 flex-shrink-0">提出人</span>
                  <span className="text-slate-800">{item.proposer || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <span className="text-slate-400 w-12 flex-shrink-0">原节点</span>
                  <span className="tabular-nums text-slate-800">{item.due_date ? String(item.due_date).slice(0, 10) : '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <span className="text-slate-400 w-12 flex-shrink-0">完成于</span>
                  <span className="tabular-nums text-slate-800">
                    {formatDateTime(item.completed_at) || '—'}{item.completed_by ? `（${item.completed_by}）` : ''}
                  </span>
                </div>
              </div>
              <div className="mt-3">
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold', scoreBadge.cls)}>
                  <scoreBadge.Icon className="w-3.5 h-3.5" /> 稽核：{scoreBadge.label}
                </span>
              </div>
            </section>

            {/* 完成情况说明 */}
            <section>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-widest mb-2">完成情况说明</div>
              {note ? (
                <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                  {note}
                </div>
              ) : (
                <div className="text-sm text-slate-300">（无说明）</div>
              )}
            </section>

            {/* 证明附件 */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-widest">证明附件</span>
                <span className="text-xs text-slate-300">（{localAtts.length}）</span>
              </div>

              {localAtts.length === 0 && (
                <div className="text-sm text-slate-300">
                  （无附件）
                  {evidNames.length > 0 && (
                    <span className="text-slate-400">　已登记证明文件名：{evidNames.join('、')}（仅文件名，无可预览文件）</span>
                  )}
                </div>
              )}

              {imgAtts.length > 0 && (
                <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mb-3">
                  {imgAtts.map((u, i) => (
                    <button
                      key={u}
                      onClick={() => setPreviewUrl(u)}
                      title="点击放大"
                      className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group bg-slate-50"
                    >
                      <img src={u} alt={`附件${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors" />
                      <span className="absolute bottom-1 right-1 w-5 h-5 bg-black/50 text-white rounded flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <ChevronRight className="w-3 h-3" />
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {otherAtts.length > 0 && (
                <ul className="space-y-1.5">
                  {otherAtts.map(u => (
                    <li key={u} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                      <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                      <span className="text-sm text-slate-700 truncate flex-1">{fileNameOf(u)}</span>
                      <a href={u} target="_blank" rel="noreferrer" title="打开"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                        <ExternalLink className="w-3.5 h-3.5" /> 打开
                      </a>
                      <a href={u} download={fileNameOf(u)} title="下载"
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                        <Download className="w-3.5 h-3.5" /> 下载
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {legacyCount > 0 && (
                <p className="mt-2 text-xs text-slate-400">
                  另有 {legacyCount} 个历史 OA 附件（旧通道），暂不支持预览。
                </p>
              )}
            </section>
          </div>

          {/* 底部 */}
          <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-end flex-shrink-0">
            <button onClick={onClose} className="px-4 h-9 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
              关闭
            </button>
          </div>
        </div>
      </div>

      {/* 图片大图预览 */}
      {previewUrl && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={() => setPreviewUrl(null)}>
          <button onClick={() => setPreviewUrl(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 flex items-center justify-center text-white transition-colors z-10">
            <X className="w-5 h-5" />
          </button>
          <img src={previewUrl} alt="预览" className="max-w-[92vw] max-h-[90vh] rounded-xl object-contain" onClick={e => e.stopPropagation()} />
          <div className="absolute bottom-5 left-0 right-0 flex justify-center gap-3">
            <a href={previewUrl} download={fileNameOf(previewUrl)}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white/90 text-slate-800 text-sm font-medium hover:bg-white">
              <Download className="w-4 h-4" /> 下载
            </a>
            <a href={previewUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white/15 text-white text-sm font-medium hover:bg-white/25">
              <ImageIcon className="w-4 h-4" /> 新窗口打开
            </a>
          </div>
        </div>
      )}
    </>
  );
}
