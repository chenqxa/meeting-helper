'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Plus, Search, FileText, ChevronRight, Trash2, Send, User, Calendar, X, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import * as XLSX from 'xlsx';

const SOURCE_LABELS: Record<string, string> = {
  wechat: '企业微信', face_to_face: '面对面', phone: '电话', other: '其他',
};

interface BatchItem {
  id: string;
  title: string;
  sourceChannel?: string | null;
  status: 'draft' | 'pushed';
  createdBy?: string | null;
  oaPushedAt?: string | null;
  createdAt: string;
}

interface BatchRow {
  description: string;
  owner: string;
  proposer: string;
  dueDate: string;
  dueDateType: string;
  priority: string;
}

const newBatchRow = (): BatchRow => ({
  description: '',
  owner: '',
  proposer: '',
  dueDate: new Date().toISOString().slice(0, 10),
  dueDateType: 'date',
  priority: 'medium',
});

export default function BatchListPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'pushed'>('all');
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchChannel, setBatchChannel] = useState('wechat');
  const [batchRows, setBatchRows] = useState<BatchRow[]>([newBatchRow()]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [orgEmployees, setOrgEmployees] = useState<{ id: string; name: string; department: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/actions/batch/list').then(r => r.json());
      if (r.success) {
        setBatches(r.data);
        // 加载每个批次的行动项数量
        const counts: Record<string, number> = {};
        await Promise.all(r.data.map(async (b: BatchItem) => {
          try {
            const detail = await fetch(`/api/actions/batch/${b.id}`).then(r => r.json());
            if (detail.success) counts[b.id] = detail.data.items.length;
          } catch { counts[b.id] = 0; }
        }));
        setItemCounts(counts);
      }
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/org/employees');
        const r = await res.json();
        if (r.success) {
          const deptRes = await fetch('/api/org/departments');
          const deptR = await deptRes.json();
          const deptMap = new Map((deptR.data || []).map((d: any) => [d.id, d.name]));
          setOrgEmployees((r.data || []).map((e: any) => ({
            id: e.id,
            name: e.name,
            department: deptMap.get(e.departmentId) || '',
          })));
        }
      } catch { /* silent */ }
    })();
  }, []);

  const filtered = batches.filter(b => {
    if (search && !b.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    return true;
  });

  const draftCount = batches.filter(b => b.status === 'draft').length;
  const pushedCount = batches.filter(b => b.status === 'pushed').length;

  const handleDelete = async (id: string, status: 'draft' | 'pushed') => {
    if (status === 'pushed' && !confirm('确认删除此批次？将同步作废 OA 记录，并连带删除该批次下的全部行动项。')) return;
    if (status === 'draft' && !confirm('确认删除此批次？将连带删除该批次下的全部行动项。')) return;
    await fetch(`/api/actions/batch/${id}`, { method: 'DELETE' });
    load();
  };

  const openCreateModal = () => {
    setBatchTitle('');
    setBatchChannel('wechat');
    setBatchRows([newBatchRow()]);
    setShowBatchModal(true);
  };

  const submitBatch = async () => {
    const items = batchRows.filter(r => r.description.trim());
    if (!batchTitle.trim()) { alert('请填写批次标题'); return; }
    if (items.length === 0) { alert('请至少填写一条任务描述'); return; }
    setBatchSubmitting(true);
    try {
      const r = await fetch('/api/actions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: batchTitle, sourceChannel: batchChannel, items }),
      }).then(r => r.json());
      if (r.success) {
        setShowBatchModal(false);
        load();
        router.push(`/batch/${r.data.batch.id}`);
      } else { alert(r.error || '创建失败'); }
    } finally { setBatchSubmitting(false); }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    let headerRow: string[] = [];

    const findCol = (names: string[]): number => {
      for (const name of names) {
        const idx = headerRow.findIndex(h => h.includes(name) || name.includes(h));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const fmtExcelDate = (v: any): string => {
      if (typeof v === 'number' && v > 10000) {
        const d = new Date((v - 25569) * 86400 * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      return String(v || '').trim();
    };

    let rows: { description: string; owner: string; proposer: string; dueDate: string; dueDateType: string; priority: string }[] = [];

    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      const lines = text.split('\n').filter(Boolean);
      if (lines.length < 2) { alert('CSV 文件为空或格式不正确'); return; }
      headerRow = lines[0].split(',').map(s => s.replace(/^"|"$/g, '').trim());
      const descIdx = findCol(['提议内容', '任务描述', '内容']);
      const ownerIdx = findCol(['责任人', '负责人', 'owner']);
      const proposerIdx = findCol(['提出人', '提议人']);
      const dateIdx = findCol(['节点', '日期', '时间', '截止']);
      if (descIdx === -1) { alert('未找到"提议内容"列'); return; }
      rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
        return {
          description: cols[descIdx] || '',
          owner: ownerIdx >= 0 ? (cols[ownerIdx] || '') : '',
          proposer: proposerIdx >= 0 ? (cols[proposerIdx] || '') : '',
          dueDate: dateIdx >= 0 ? fmtExcelDate(cols[dateIdx]) : '',
          dueDateType: dateIdx >= 0 && fmtExcelDate(cols[dateIdx]) ? 'date' : 'tbd',
          priority: 'medium',
        };
      }).filter(r => r.description.trim());
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (json.length < 2) { alert('Excel 文件为空或格式不正确'); return; }
      headerRow = (json[0] || []).map((h: any) => String(h || '').trim());
      const descIdx = findCol(['提议内容', '任务描述', '内容']);
      const ownerIdx = findCol(['责任人', '负责人', 'owner']);
      const proposerIdx = findCol(['提出人', '提议人']);
      const dateIdx = findCol(['节点', '日期', '时间', '截止']);
      if (descIdx === -1) { alert('未找到"提议内容"列'); return; }
      rows = json.slice(1).map((row: any[]) => {
        const d = dateIdx >= 0 ? fmtExcelDate(row[dateIdx]) : '';
        return {
          description: String(row[descIdx] || '').trim(),
          owner: ownerIdx >= 0 ? String(row[ownerIdx] || '').trim() : '',
          proposer: proposerIdx >= 0 ? String(row[proposerIdx] || '').trim() : '',
          dueDate: d,
          dueDateType: d ? 'date' : 'tbd',
          priority: 'medium',
        };
      }).filter(r => r.description.trim());
    } else {
      alert('仅支持 .csv / .xlsx / .xls 格式');
      return;
    }

    if (rows.length === 0) { alert('未读取到有效数据'); return; }

    setBatchRows(rows);
    if (!batchTitle.trim()) {
      setBatchTitle(`导入_${file.name.replace(/\.[^.]+$/, '')}`);
    }
    setShowBatchModal(true);
    alert(`已导入 ${rows.length} 条行动项，可编辑后创建批次`);
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">任务批次管理</h1>
            <p className="text-sm text-slate-500 mt-1">管理非会议产生的行动项批次，创建、编辑、推送到 OA</p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 shadow-sm"
          >
            <Plus className="w-4 h-4" /> 新建批次
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '全部', value: batches.length, color: 'bg-slate-100 text-slate-700' },
            { label: '草稿', value: draftCount, color: 'bg-amber-100 text-amber-700' },
            { label: '已推送', value: pushedCount, color: 'bg-emerald-100 text-emerald-700' },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => setStatusFilter(s.label === '全部' ? 'all' : s.label === '草稿' ? 'draft' : 'pushed')}
              className={`rounded-2xl p-4 text-left transition-all ${
                (s.label === '全部' && statusFilter === 'all') ||
                (s.label === '草稿' && statusFilter === 'draft') ||
                (s.label === '已推送' && statusFilter === 'pushed')
                  ? `${s.color} ring-2 ring-offset-2 ring-blue-400`
                  : 'bg-white border border-slate-200'
              }`}
            >
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs mt-1 opacity-70">{s.label}</div>
            </button>
          ))}
        </div>

        {/* 搜索 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="搜索批次标题..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 rounded-2xl border-slate-200 pl-9 text-sm shadow-sm"
          />
        </div>

        {/* 列表 */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400 text-sm">加载中...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">暂无批次</p>
              <button onClick={openCreateModal} className="mt-3 text-xs text-blue-600 hover:underline">去创建第一个批次</button>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {filtered.map(b => (
                <div
                  key={b.id}
                  className="flex items-center px-5 py-4 hover:bg-slate-50/50 transition-colors cursor-pointer group"
                  onClick={() => router.push(`/batch/${b.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-blue-600 transition-colors">{b.title}</p>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${b.status === 'pushed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {b.status === 'pushed' ? '已推送' : '草稿'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
                      {b.sourceChannel && <span>{SOURCE_LABELS[b.sourceChannel] || b.sourceChannel}</span>}
                      {b.sourceChannel && <span className="text-slate-200">|</span>}
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {(itemCounts[b.id] ?? (b as any).itemCount) || '-'} 项</span>
                      <span className="text-slate-200">|</span>
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(b.createdAt).toLocaleDateString('zh-CN')}</span>
                      {b.createdBy && <><span className="text-slate-200">|</span><span className="flex items-center gap-1"><User className="w-3 h-3" /> {b.createdBy}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-4">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDelete(b.id, b.status);
                      }}
                      className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-slate-300 hover:text-red-500 transition-colors"
                      title="删除"
                    ><Trash2 className="w-4 h-4" /></button>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 新建批次弹窗 */}
        {showBatchModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowBatchModal(false); }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">新建批次</h2>
                  <p className="text-xs text-slate-400 mt-0.5">用于录入非会议产生的行动项</p>
                </div>
                <button onClick={() => setShowBatchModal(false)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
              </div>

              <div className="px-6 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500">批次标题 *</label>
                    <input value={batchTitle} onChange={e => setBatchTitle(e.target.value)} placeholder="例如：7月16日企微交办" className="mt-1 w-full h-9 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" autoFocus />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500">来源</label>
                    <select value={batchChannel} onChange={e => setBatchChannel(e.target.value)} className="mt-1 w-full h-9 text-sm border border-slate-200 rounded-lg px-2.5 outline-none">
                      <option value="wechat">企业微信</option>
                      <option value="face_to_face">面对面</option>
                      <option value="phone">电话</option>
                      <option value="other">其他</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-slate-500">行动项</label>
                    <div className="flex items-center gap-3">
                      <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-slate-500 hover:text-slate-700 font-medium flex items-center gap-1"
                        title="从 Excel/CSV 导入行动项"
                      ><Upload className="w-3 h-3" /> 导入</button>
                      <button
                        onClick={() => setBatchRows(prev => [...prev, newBatchRow()])}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                      ><Plus className="w-3 h-3" /> 添加一行</button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    <datalist id="batch-owner-list">
                      {orgEmployees.map(e => <option key={e.id} value={e.name}>{e.name} ({e.department})</option>)}
                    </datalist>
                    {batchRows.map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={row.description} onChange={e => {
                          const copy = [...batchRows]; copy[i] = { ...copy[i], description: e.target.value }; setBatchRows(copy);
                        }} placeholder="任务描述" className="flex-1 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" />
                        <input value={row.owner} onChange={e => {
                          const copy = [...batchRows]; copy[i] = { ...copy[i], owner: e.target.value }; setBatchRows(copy);
                        }} placeholder="责任人" list="batch-owner-list" className="w-24 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" />
                        <input value={row.proposer} onChange={e => {
                          const copy = [...batchRows]; copy[i] = { ...copy[i], proposer: e.target.value }; setBatchRows(copy);
                        }} placeholder="提出人" list="batch-owner-list" className="w-24 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" />
                        <div className="flex items-center gap-1">
                          {[
                            { key: 'date', label: '📅' },
                            { key: 'continuous', label: '🔄' },
                            { key: 'tbd', label: '❓' },
                          ].map(opt => (
                            <button key={opt.key} title={opt.key === 'date' ? '具体日期' : opt.key === 'continuous' ? '持续执行' : '待定'}
                              onClick={() => {
                                const copy = [...batchRows];
                                copy[i] = { ...copy[i], dueDateType: opt.key, dueDate: opt.key === 'date' ? new Date().toISOString().slice(0, 10) : '' };
                                setBatchRows(copy);
                              }}
                              className={`w-7 h-7 rounded text-xs flex items-center justify-center transition-all ${
                                (row.dueDateType || 'date') === opt.key
                                  ? 'bg-blue-600 text-white shadow-sm scale-110'
                                  : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                              }`}
                            >{opt.label}</button>
                          ))}
                        </div>
                        {(row.dueDateType || 'date') === 'date' && (
                          <input type="date" value={row.dueDate} onChange={e => {
                            const copy = [...batchRows]; copy[i] = { ...copy[i], dueDate: e.target.value }; setBatchRows(copy);
                          }} className="w-32 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none" />
                        )}
                        <select value={row.priority} onChange={e => {
                          const copy = [...batchRows]; copy[i] = { ...copy[i], priority: e.target.value }; setBatchRows(copy);
                        }} className="w-18 h-8 text-sm border border-slate-200 rounded-lg px-1.5 outline-none">
                          <option value="high">高</option>
                          <option value="medium">中</option>
                          <option value="low">低</option>
                        </select>
                        {batchRows.length > 1 && (
                          <button onClick={() => setBatchRows(prev => prev.filter((_, idx) => idx !== i))} className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-slate-300 hover:text-red-500 shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setShowBatchModal(false)} className="px-5 h-10 border border-slate-200 text-slate-500 rounded-xl text-sm font-medium hover:bg-slate-50">取消</button>
                <button
                  onClick={submitBatch}
                  disabled={batchSubmitting}
                  className="px-5 h-10 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {batchSubmitting ? <>··· 创建中</> : <>创建</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
