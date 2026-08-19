'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { RefreshCw, FileText, X, CalendarDays, AlertTriangle, CheckCircle2, Clock, Ban, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getActionDisplayLabel, getActionDisplayStatus } from '@/lib/action-status';
import { getDisplayOaResult } from '@/lib/oa-result-display';

interface MyTask {
  id: string;
  description: string;
  owner: string | null;
  proposer?: string | null;
  due_date: string | null;
  due_date_type?: 'date' | 'continuous' | 'tbd' | null;
  cycle_date?: string | null;
  priority: string;
  status: string;
  meeting_id: string;
  meeting_title: string;
  meeting_type: string;
  meeting_date: string;
  meeting_organizer: string;
  oa_result: string | null;
  oa_result_at: string | null;
  oa_score: number | null;
  oa_attachments: string[];
  completed_at: string | null;
  block_reason: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; cardBorder: string; badgeBg: string; badgeText: string }> = {
  pending:   { label: '未处理', icon: <Clock className="w-3.5 h-3.5" />, cardBorder: 'border-l-amber-400', badgeBg: 'bg-amber-50', badgeText: 'text-amber-600' },
  done:      { label: '已处理', icon: <CheckCircle2 className="w-3.5 h-3.5" />, cardBorder: 'border-l-emerald-400', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-600' },
  cancelled: { label: '已取消', icon: <Ban className="w-3.5 h-3.5" />, cardBorder: 'border-l-slate-300', badgeBg: 'bg-slate-100', badgeText: 'text-slate-500' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  high:   { label: '紧急', color: 'bg-red-100 text-red-600' },
  medium: { label: '正常', color: 'bg-slate-100 text-slate-500' },
  low:    { label: '宽松', color: 'bg-green-100 text-green-600' },
};

function formatDate(d: string | null) {
  if (!d) return '';
  return d.slice(0, 10).replace(/-/g, '/');
}

function isOverdue(due: string | null, status: string) {
  if (!due || getActionDisplayStatus(status) !== 'pending') return false;
  return new Date(due) < new Date(new Date().toDateString());
}

const TABS = ['全部', '未处理', '已处理', '已取消'] as const;
type Tab = typeof TABS[number];

const TAB_STATUS: Record<Tab, string | null> = {
  '全部': null, '未处理': 'pending', '已处理': 'done', '已取消': 'cancelled',
};

export default function MyTasksPage() {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('全部');
  const [resultItem, setResultItem] = useState<MyTask | null>(null);
  const [resultForm, setResultForm] = useState({ text: '', status: 'done' });
  const [resultImages, setResultImages] = useState<File[]>([]);
  const [resultSubmitting, setResultSubmitting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/actions/mine').then(r => r.json());
      if (r.success) setTasks(r.data || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 弹窗打开时：document 级粘贴监听，任意位置 Ctrl+V 截图都能捕获
  useEffect(() => {
    if (!resultItem) return;
    const handlePaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items || []).filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => f !== null);
      if (files.length > 0) {
        e.preventDefault();
        setResultImages(prev => [...prev, ...files.filter(f => f.type.startsWith('image/'))]);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [resultItem]);

  const openResult = (task: MyTask) => {
    setResultItem(task);
    // 预填过滤导入元数据（{"y":..,"w":..,"d":..}），避免混入新一轮汇报
    setResultForm({ text: getDisplayOaResult(task.oa_result), status: task.status === 'done' ? 'done' : task.status === 'blocked' ? 'blocked' : 'in_progress' });
    setResultImages([]);
  };

  const filtered = tasks.filter(t => {
    if (TAB_STATUS[tab] === null) return true;
    if (TAB_STATUS[tab] === 'pending') return getActionDisplayStatus(t.status) === 'pending' && (t as any).oa_score == null;
    return getActionDisplayStatus(t.status) === TAB_STATUS[tab];
  });

  const countByStatus = (s: string) => tasks.filter(t => getActionDisplayStatus(t.status) === s).length;
  const pendingCount = countByStatus('pending');

  return (
    <DashboardLayout>
      {/* 顶部欢迎横幅 */}
      <div className="mb-6 p-5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold mb-0.5">我的任务</h2>
            <p className="text-blue-100 text-sm">
              {pendingCount > 0 ? `你有 ${pendingCount} 项待处理任务` : '暂无待处理任务 🎉'}
            </p>
          </div>
          <button onClick={load} className="w-9 h-9 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {/* 统计小卡片 */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: '未处理', count: countByStatus('pending'), color: 'bg-amber-400/30' },
            { label: '已处理', count: countByStatus('done'), color: 'bg-emerald-400/30' },
            { label: '已取消', count: countByStatus('cancelled'), color: 'bg-slate-400/30' },
          ].map(s => (
            <div key={s.label} className={`${s.color} rounded-xl p-2.5 text-center`}>
              <div className="text-xl font-bold">{s.count}</div>
              <div className="text-xs text-blue-100 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1.5 mb-4 bg-slate-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >{t}</button>
        ))}
      </div>

      {/* 任务卡片列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" /> 加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
          <CheckCircle2 className="w-12 h-12 opacity-20" />
          <p className="text-sm">暂无{tab === '全部' ? '' : tab}任务</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(task => {
            const displayStatus = getActionDisplayStatus(task.status);
            const sc = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.pending;
            const pc = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
            const overdue = isOverdue(task.due_date, task.status);
            const isDone = displayStatus === 'done';
            const isCancelled = displayStatus === 'cancelled';
            const dueType = task.due_date_type || 'date';
            const dueTypeBadge =
              dueType === 'continuous' ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
                  🔄 持续项
                </span>
              ) : dueType === 'tbd' ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  ❓ 待定
                </span>
              ) : null;
            return (
              <div
                key={task.id}
                className={`bg-white rounded-2xl border border-slate-100 border-l-4 ${sc.cardBorder} shadow-sm hover:shadow-md transition-all flex flex-col ${isDone || isCancelled ? 'bg-slate-50/50' : ''}`}
              >
                {/* 卡片头部 */}
                <div className="p-4 pb-3 flex-1">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${sc.badgeBg} ${sc.badgeText}`}>
                        {sc.icon}{sc.label}
                      </span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${pc.color}`}>{pc.label}</span>
                      {dueTypeBadge}
                      {overdue && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                          <AlertTriangle className="w-3 h-3" />已逾期
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 任务描述 */}
                  <p className={`text-sm text-slate-700 leading-relaxed mb-3 ${isDone ? 'opacity-50' : ''}`}>
                    {task.description}
                  </p>

                  {/* 元信息 */}
                  <div className="space-y-1">
                     {task.meeting_id ? (
                     <Link href={`/meeting/${task.meeting_id}`} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-500 transition-colors group">
                       <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                       <span className="truncate group-hover:underline">{task.meeting_title}</span>
                       <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-100" />
                     </Link>
                     ) : task.meeting_title ? (
                       <span className="flex items-center gap-1.5 text-xs text-slate-400">
                         <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                         <span className="truncate">{task.meeting_title}</span>
                       </span>
                     ) : null}
                    {task.due_date && dueType === 'date' && (
                      <div className={`flex items-center gap-1.5 text-xs ${overdue ? 'text-red-500' : 'text-slate-400'}`}>
                        <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>截止 {formatDate(task.due_date)}</span>
                      </div>
                    )}
                    {dueType === 'continuous' && (
                      <div className="flex items-center gap-1.5 text-xs text-violet-600">
                        <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
                        {task.cycle_date ? <span>周期 {task.cycle_date}</span> : <span>持续执行，无截止日期</span>}
                      </div>
                    )}
                    {dueType === 'tbd' && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>截止日期待定</span>
                      </div>
                    )}
                  </div>

                  {/* 已有结果预览（过滤导入元数据） */}
                  {getDisplayOaResult(task.oa_result) && (
                    <div className="mt-3 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="text-[10px] text-slate-400 mb-0.5">上次汇报</div>
                      <div className="text-xs text-slate-600 line-clamp-2">{getDisplayOaResult(task.oa_result)}</div>
                      {task.oa_attachments?.length > 0 && (
                        <div className="flex gap-1 mt-1.5">
                          {task.oa_attachments.slice(0, 3).map((url, i) => (
                            <img key={i} src={url} alt="" className="w-10 h-10 rounded object-cover border border-slate-200 cursor-pointer hover:ring-2 hover:ring-blue-300" onClick={() => setPreviewUrl(url)} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 卡片底部按钮 */}
                <div className="flex justify-end px-4 pb-4 pt-0">
                  {!isCancelled && (
                    <button
                      onClick={() => openResult(task)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all ${
                        isDone
                          ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                          : 'border-blue-200 bg-white text-blue-600 hover:bg-blue-50'
                      }`}
                    >
                      {isDone ? '查看 / 修改汇报' : '汇报进展'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 汇报进展弹窗 */}
      {resultItem && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setResultItem(null); }}
        >
          <div className="bg-white w-full sm:w-[540px] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            <div className={`h-1.5 w-full ${resultItem.due_date_type === 'continuous' ? 'bg-gradient-to-r from-blue-400 to-indigo-500' : resultForm.status === 'done' ? 'bg-gradient-to-r from-emerald-400 to-green-500' : resultForm.status === 'blocked' ? 'bg-gradient-to-r from-red-400 to-rose-500' : 'bg-gradient-to-r from-blue-400 to-indigo-500'}`} />

            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">汇报进展</h2>
                <p className="text-xs text-slate-400 mt-0.5">填写后自动同步到台账评分</p>
              </div>
              <button onClick={() => setResultItem(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mx-6 mb-4 p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">任务内容</div>
                <div className="text-xs text-slate-700 leading-relaxed line-clamp-3">{resultItem.description}</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-2">
              {resultItem.due_date_type !== 'continuous' && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-2.5">处理结果</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'done',        label: '已完成', emoji: '✅', activeBg: 'bg-emerald-500', border: 'border-emerald-300', bg: 'bg-emerald-50', text: 'text-emerald-700' },
                      { value: 'in_progress', label: '进行中', emoji: '🔄', activeBg: 'bg-blue-500',    border: 'border-blue-300',    bg: 'bg-blue-50',    text: 'text-blue-700' },
                      { value: 'blocked',     label: '阻塞',   emoji: '🚫', activeBg: 'bg-red-500',     border: 'border-red-300',     bg: 'bg-red-50',     text: 'text-red-700' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setResultForm(f => ({ ...f, status: opt.value }))}
                        className={`py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                          resultForm.status === opt.value
                            ? `${opt.activeBg} border-transparent text-white shadow-md scale-[1.02]`
                            : `${opt.bg} ${opt.border} ${opt.text} hover:scale-[1.01]`
                        }`}
                      >
                        <span className="text-lg">{opt.emoji}</span>
                        <span className="text-xs font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-slate-500">{resultItem.due_date_type === 'continuous' ? '进展说明' : '处理说明'} <span className="text-red-400">*</span></div>
                  <div className="text-[10px] text-slate-300">{resultForm.text.length}/500</div>
                </div>
                <textarea
                  rows={4}
                  autoFocus
                  value={resultForm.text}
                  onChange={e => setResultForm(f => ({ ...f, text: e.target.value.slice(0, 500) }))}
                  className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 resize-none placeholder:text-slate-300 transition-all"
                  placeholder={resultItem.due_date_type === 'continuous' ? '描述本周/本期进展、完成情况...' : resultForm.status === 'done' ? '描述完成情况、成果...' : resultForm.status === 'blocked' ? '说明阻塞原因、需要的支持...' : '描述当前进展、下一步计划...'}
                />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">
                  图片附件 <span className="text-red-400">*</span> <span className="text-slate-300 font-normal">（截图、证明材料等，至少上传 1 张）</span>
                </div>
                <div
                  className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer group"
                  onClick={() => document.getElementById('mytask-img-upload')?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                    setResultImages(prev => [...prev, ...files]);
                  }}
                >
                  <input id="mytask-img-upload" type="file" accept="image/*" multiple className="hidden"
                    onChange={e => setResultImages(prev => [...prev, ...Array.from(e.target.files || [])])} />
                  <div className="text-2xl mb-1">🖼️</div>
                  <div className="text-xs text-slate-400 group-hover:text-blue-500 transition-colors">点击上传 或 拖拽图片至此</div>
                  <div className="text-[10px] text-slate-300 mt-0.5">支持 JPG · PNG · GIF · WebP</div>
                </div>
                {resultImages.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {resultImages.map((f, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group">
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                        <button
                          onClick={() => setResultImages(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        ><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                    <div
                      className="aspect-square rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all"
                      onClick={() => document.getElementById('mytask-img-upload')?.click()}
                    >
                      <span className="text-slate-300 text-xl">+</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 mt-2">
              <button
                onClick={() => setResultItem(null)}
                className="px-5 h-10 border border-slate-200 text-slate-500 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
              >取消</button>
              <button
                onClick={async () => {
                  // 处理说明必填
                  if (!resultForm.text.trim()) {
                    alert('请填写处理说明');
                    return;
                  }
                  // 图片附件必填（至少 1 张）
                  if (resultImages.length === 0) {
                    alert('请至少上传 1 张图片附件（截图、证明材料等）');
                    return;
                  }
                  setResultSubmitting(true);
                  try {
                    const imageUrls: string[] = [];
                    for (const file of resultImages) {
                      const fd = new FormData();
                      fd.append('file', file);
                      fd.append('type', 'image');
                      const r = await fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
                      if (r.success) imageUrls.push(r.url);
                    }
                    const res = await fetch(`/api/actions/${resultItem.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        oa_result: resultForm.text,
                        oa_result_at: new Date().toISOString(),
                        // 持续项：不设处理结果，状态保持进行中，不写 oa_score
                        ...(resultItem.due_date_type !== 'continuous'
                          ? { ...(resultForm.status !== 'in_progress' ? { oa_score: resultForm.status === 'done' ? 1 : -1 } : {}), status: resultForm.status }
                          : { status: 'in_progress' }),
                        oa_auto_detected: false,
                        oa_attachments: imageUrls.length > 0 ? imageUrls : (resultItem.oa_attachments || []),
                      }),
                    });
                    if (res.ok) { setResultItem(null); load(); }
                  } finally { setResultSubmitting(false); }
                }}
                disabled={resultSubmitting}
                className={`flex-1 h-10 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  resultItem.due_date_type === 'continuous' ? 'bg-blue-600 hover:bg-blue-700' :
                  resultForm.status === 'done'    ? 'bg-emerald-500 hover:bg-emerald-600' :
                  resultForm.status === 'blocked' ? 'bg-red-500 hover:bg-red-600' :
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {resultSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> 提交中...
                  </span>
                ) : (
                  resultItem.due_date_type === 'continuous' ? '🔄 更新进展' :
                  resultForm.status === 'done'    ? '✅ 标记完成' :
                  resultForm.status === 'blocked' ? '🚫 报告阻塞' : '🔄 更新进展'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setPreviewUrl(null)}>
          <button onClick={() => setPreviewUrl(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-colors z-10"><X className="w-5 h-5" /></button>
          <img src={previewUrl} alt="预览" className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </DashboardLayout>
  );
}
