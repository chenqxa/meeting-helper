'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  RefreshCw, Search, Download, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronUp, Bug, Lightbulb, HelpCircle, MessageSquare,
  RotateCcw, Trash2, Plus, ImagePlus, Loader2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { WeaverPagination } from '@/components/ui/weaver-pagination';

interface FeedbackImage {
  url: string;
  name?: string;
}

interface FeedbackItem {
  id: string;
  title: string;
  content: string;
  images?: FeedbackImage[];
  category: 'bug' | 'feature' | 'question' | 'other';
  status: 'open' | 'resolved';
  createdBy: string;
  createdByLoginId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolveNote?: string;
}

const CATEGORY_MAP: Record<string, { label: string; icon: typeof Bug; color: string; bg: string }> = {
  bug: { label: '问题反馈', icon: Bug, color: 'text-red-600', bg: 'bg-red-50' },
  feature: { label: '功能建议', icon: Lightbulb, color: 'text-amber-600', bg: 'bg-amber-50' },
  question: { label: '使用疑问', icon: HelpCircle, color: 'text-blue-600', bg: 'bg-blue-50' },
  other: { label: '其他', icon: MessageSquare, color: 'text-slate-600', bg: 'bg-slate-50' },
};

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateTime(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortKey, setSortKey] = useState<'createdAt' | 'resolvedAt'>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 });
  const [userRole, setUserRole] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState({ title: '', content: '', category: 'bug' as FeedbackItem['category'] });
  const [newImages, setNewImages] = useState<FeedbackImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const newFileInputRef = useRef<HTMLInputElement>(null);
  const [resolveModal, setResolveModal] = useState<FeedbackItem | null>(null);
  const [resolveNote, setResolveNote] = useState('');
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.success) setUserRole(d.data.role || 'employee');
    }).catch(() => setUserRole('employee'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/feedback');
      const d = await r.json();
      if (d.success) setItems(d.data || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (userRole === null) return;
    load();
  }, [userRole, load]);

  const filtered = items.filter(i => {
    if (search && !i.title.toLowerCase().includes(search.toLowerCase()) &&
        !i.content.toLowerCase().includes(search.toLowerCase()) &&
        !i.createdBy?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCategory && i.category !== filterCategory) return false;
    if (filterStatus && i.status !== filterStatus) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let diff = 0;
    if (sortKey === 'createdAt') {
      diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    } else if (sortKey === 'resolvedAt') {
      diff = new Date(a.resolvedAt || '').getTime() - new Date(b.resolvedAt || '').getTime();
    }
    return sortAsc ? diff : -diff;
  });

  const paginated = sorted.slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const openCount = filtered.filter(i => i.status === 'open').length;
  const resolvedCount = filtered.filter(i => i.status === 'resolved').length;

  const uploadImage = async (file: File): Promise<FeedbackImage | null> => {
    if (!file.type.startsWith('image/')) return null;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', 'image');
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success && data.url) return { url: data.url, name: file.name };
    } catch { /* ignore */ }
    return null;
  };

  const handleFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    setUploading(true);
    try {
      const results = await Promise.all(arr.map(uploadImage));
      const ok = results.filter((r): r is FeedbackImage => r !== null);
      if (ok.length > 0) setNewImages(prev => [...prev, ...ok]);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!newForm.title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newForm, images: newImages.length > 0 ? newImages : undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setNewForm({ title: '', content: '', category: 'bug' });
        setNewImages([]);
        setShowNewForm(false);
        load();
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  const handleResolve = async () => {
    if (!resolveModal) return;
    setResolveSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: resolveModal.id, action: 'resolve', resolveNote: resolveNote || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setResolveModal(null);
        setResolveNote('');
        load();
      }
    } catch { /* ignore */ }
    setResolveSubmitting(false);
  };

  const handleReopen = async (id: string) => {
    try {
      const res = await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'reopen' }),
      });
      const data = await res.json();
      if (data.success) load();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条反馈吗？')) return;
    try {
      const res = await fetch(`/api/feedback?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) load();
    } catch { /* ignore */ }
  };

  const exportCSV = () => {
    const header = ['编号', '类型', '标题', '详细描述', '提交人', '提交时间', '状态', '处理人', '处理时间', '处理说明'];
    const rows = sorted.map(i => [
      i.id,
      CATEGORY_MAP[i.category]?.label || i.category,
      `"${i.title.replace(/"/g, '""')}"`,
      `"${i.content.replace(/"/g, '""')}"`,
      i.createdBy,
      formatDateTime(i.createdAt),
      i.status === 'resolved' ? '已处理' : '待处理',
      i.resolvedBy || '',
      i.resolvedAt ? formatDateTime(i.resolvedAt) : '',
      `"${(i.resolveNote || '').replace(/"/g, '""')}"`,
    ].join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `反馈台账_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ k }: { k: typeof sortKey }) => (
    sortKey === k
      ? (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
      : <ChevronDown className="w-3 h-3 text-slate-300" />
  );

  if (userRole === null) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="w-1.5 h-6 bg-emerald-500 rounded-full" />
            反馈台账
          </h2>
          <p className="text-sm text-slate-500 mt-1">收集问题与建议，追踪处理进度，保留完整历史记录</p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-all shadow-md shadow-emerald-500/20 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          提交反馈
        </button>
      </div>

      {/* 统计摘要 */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: '总反馈', value: items.length, color: 'text-slate-800' },
          { label: '待处理', value: openCount, color: 'text-amber-600', icon: <Clock className="w-4 h-4" /> },
          { label: '已处理', value: resolvedCount, color: 'text-emerald-600', icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: '处理率', value: items.length > 0 ? `${Math.round((resolvedCount / items.length) * 100)}%` : '—', color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
            {s.icon && <span className={s.color}>{s.icon}</span>}
            <div>
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-[11px] text-slate-400">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input placeholder="搜索标题/内容/提交人..." value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="pl-8 h-8 w-56 text-xs" />
        </div>
        <select value={filterCategory} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterCategory(e.target.value)}
          className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600">
          <option value="">全部类型</option>
          <option value="bug">问题反馈</option>
          <option value="feature">功能建议</option>
          <option value="question">使用疑问</option>
          <option value="other">其他</option>
        </select>
        <select value={filterStatus} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value)}
          className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600">
          <option value="">全部状态</option>
          <option value="open">待处理</option>
          <option value="resolved">已处理</option>
        </select>
        <div className="flex-1" />
        <button onClick={load} className="h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-600 flex items-center gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
        <button onClick={exportCSV} className="h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-600 flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> 导出CSV
        </button>
      </div>

      {/* 台账表格 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">编号</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">类型</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[200px]">标题</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">提交人</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap cursor-pointer select-none"
                  onClick={() => toggleSort('createdAt')}>
                  <span className="flex items-center gap-1">提交时间 <SortIcon k="createdAt" /></span>
                </th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">状态</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">处理人</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap cursor-pointer select-none"
                  onClick={() => toggleSort('resolvedAt')}>
                  <span className="flex items-center gap-1">处理时间 <SortIcon k="resolvedAt" /></span>
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[160px]">处理说明</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
                    加载中...
                  </div>
                </td></tr>
              )}
              {!loading && sorted.length === 0 && (
                <tr><td colSpan={10} className="text-center py-12 text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <MessageSquare className="w-8 h-8 opacity-30" />
                    <p>暂无反馈记录</p>
                    <button onClick={() => setShowNewForm(true)} className="text-emerald-600 hover:text-emerald-700 text-xs font-medium">提交第一条反馈 →</button>
                  </div>
                </td></tr>
              )}
              {paginated.map((item, i) => {
                const cat = CATEGORY_MAP[item.category] || CATEGORY_MAP.other;
                const CatIcon = cat.icon;
                const isExpanded = expandedId === item.id;

                return (
                  <React.Fragment key={item.id}>
                    <tr className={`border-b border-slate-100 transition-colors ${
                      i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                    } hover:bg-emerald-50/20 ${item.status === 'resolved' ? 'opacity-80' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500 font-mono text-[11px]">{item.id}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${cat.bg} ${cat.color}`}>
                          <CatIcon className="w-3 h-3" />
                          {cat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        <div className="font-medium break-all" title={item.title}>{item.title}</div>
                        {!isExpanded && (
                          <div className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{item.content}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{item.createdBy}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDateTime(item.createdAt)}</td>
                      <td className="px-4 py-3 text-center">
                        {item.status === 'resolved' ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            已处理
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3 h-3" />
                            待处理
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{item.resolvedBy || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{item.resolvedAt ? formatDateTime(item.resolvedAt) : '—'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {item.resolveNote ? (
                          <div className={`text-[11px] ${isExpanded ? '' : 'line-clamp-2'}`}>{item.resolveNote}</div>
                        ) : (
                          <span className="text-slate-300 text-[11px]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {userRole === 'admin' && item.status === 'open' && (
                            <button
                              onClick={() => { setResolveModal(item); setResolveNote(''); }}
                              className="px-2 py-1 text-[10px] font-medium border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                              title="标记已处理"
                            >
                              ✓ 处理
                            </button>
                          )}
                          {userRole === 'admin' && item.status === 'resolved' && (
                            <button
                              onClick={() => handleReopen(item.id)}
                              className="px-2 py-1 text-[10px] font-medium border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                              title="重新打开"
                            >
                              <RotateCcw className="w-3 h-3 inline" /> 重开
                            </button>
                          )}
                          {userRole === 'admin' && (
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="px-1.5 py-1 text-[10px] border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 rounded-lg transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : item.id)}
                            className="px-1.5 py-1 text-[10px] border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
                          >
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={10} className="px-6 py-4">
                          <div className="space-y-3">
                            <div>
                              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">详细描述</span>
                              <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap leading-relaxed">{item.content}</p>
                            </div>
                            {item.images && item.images.length > 0 && (
                              <div>
                                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">附图 ({item.images.length})</span>
                                <div className="flex flex-wrap gap-2 mt-1">
                                  {item.images.map((img, idx) => (
                                    <img
                                      key={idx}
                                      src={img.url}
                                      alt={img.name || `图片${idx + 1}`}
                                      title={img.name || `点击查看大图 ${idx + 1}`}
                                      onClick={() => setPreviewImage(img.url)}
                                      className="w-24 h-24 object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-80 hover:border-emerald-300 transition-all"
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                            {item.status === 'resolved' && item.resolvedBy && (
                              <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-100">
                                <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium mb-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  由 {item.resolvedBy} 于 {item.resolvedAt ? formatDateTime(item.resolvedAt) : ''} 处理
                                </div>
                                {item.resolveNote && (
                                  <p className="text-xs text-emerald-600 ml-5 whitespace-pre-wrap">{item.resolveNote}</p>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td colSpan={6} className="px-4 py-2 text-xs font-semibold text-slate-600">
                    共 {sorted.length} 条 &nbsp;
                    <span className="text-amber-600">待处理: {openCount}</span>
                    &nbsp;&nbsp;
                    <span className="text-emerald-600">已处理: {resolvedCount}</span>
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {!loading && sorted.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100 flex justify-end">
            <WeaverPagination
              total={sorted.length}
              current={pagination.page}
              pageSize={pagination.pageSize}
              onPageChange={(page) => setPagination({ ...pagination, page })}
              onPageSizeChange={(pageSize) => setPagination({ page: 1, pageSize })}
            />
          </div>
        )}
      </div>

      {/* 提交反馈弹窗 */}
      {showNewForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !submitting && (setShowNewForm(false), setNewImages([]))}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-8 pt-8 pb-4">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-emerald-500 rounded-full" />
                  提交反馈
                </h3>
                <button onClick={() => !submitting && (setShowNewForm(false), setNewImages([]))} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-50 rounded-xl transition-all">
                  ✕
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
                          onClick={() => setNewForm(prev => ({ ...prev, category: key as FeedbackItem['category'] }))}
                          className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-xs font-medium transition-all ${
                            newForm.category === key
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
                    value={newForm.title}
                    onChange={e => setNewForm(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">详细描述</label>
                  <textarea
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 transition-all outline-none text-sm min-h-[120px] resize-none"
                    placeholder="请详细描述问题现象、复现步骤或你的建议...（支持粘贴/拖拽截图）"
                    value={newForm.content}
                    onChange={e => setNewForm(prev => ({ ...prev, content: e.target.value }))}
                    onPaste={e => {
                      const files = Array.from(e.clipboardData.items).filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => f !== null);
                      if (files.length > 0) { e.preventDefault(); handleFiles(files); }
                    }}
                    onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files); }}
                    onDragOver={e => e.preventDefault()}
                  />
                  {newImages.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {newImages.map((img, idx) => (
                        <div key={idx} className="relative group">
                          <img src={img.url} alt={img.name || ''} className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                          <button onClick={() => setNewImages(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <button type="button" onClick={() => newFileInputRef.current?.click()} disabled={uploading} className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-50">
                      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                      {uploading ? '上传中...' : '添加图片'}
                    </button>
                    <span className="text-[11px] text-slate-400">支持粘贴/拖拽截图</span>
                    <input ref={newFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-50/50 flex gap-3 border-t border-slate-100">
              <button
                onClick={() => !submitting && setShowNewForm(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!newForm.title.trim() || submitting}
                className="flex-[2] py-3 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-50"
              >
                {submitting ? '提交中...' : '提交反馈'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 处理反馈弹窗 */}
      {resolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !resolveSubmitting && setResolveModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-8 pt-8 pb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                <span className="w-1.5 h-5 bg-emerald-500 rounded-full" />
                标记为已处理
              </h3>
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <p className="text-sm font-medium text-slate-700">{resolveModal.title}</p>
                  <p className="text-xs text-slate-400 mt-1">提交人：{resolveModal.createdBy} · {formatDateTime(resolveModal.createdAt)}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">处理说明（可选）</label>
                  <textarea
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 transition-all outline-none text-sm min-h-[80px] resize-none"
                    placeholder="描述处理方式或结果..."
                    value={resolveNote}
                    onChange={e => setResolveNote(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-50/50 flex gap-3 border-t border-slate-100">
              <button
                onClick={() => !resolveSubmitting && setResolveModal(null)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleResolve}
                disabled={resolveSubmitting}
                className="flex-[2] py-3 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/25 disabled:opacity-50"
              >
                {resolveSubmitting ? '处理中...' : '确认已处理'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 图片大图预览 */}
      {previewImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-8" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} alt="预览" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
          <button onClick={() => setPreviewImage(null)} className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/30 text-white rounded-full flex items-center justify-center text-xl">✕</button>
        </div>
      )}
    </DashboardLayout>
  );
}
