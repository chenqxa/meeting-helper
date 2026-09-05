'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { RefreshCw, Search, FileText, ArrowUpDown, Download, Upload, Pencil, Filter, ChevronDown, ExternalLink } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { WeaverPagination } from '@/components/ui/weaver-pagination';
import { DeptSelect } from '@/components/ui/dept-select';
import { autoFetchSourceName, autoFetchSourceDesc, firstAutoFetchSourceKey } from '@/lib/auto-fetch-sources-meta';

interface Item {
  id: string; description: string; owner: string | null; dept: string | null;
  due_date: string | null; due_date_type?: string | null; priority: string; status: string;
  meeting_id: string; meeting_title: string; meeting_type: string;
  meeting_date: string; meeting_organizer: string;
  proposer?: string | null;
  proposer_dept?: string | null;
  initial_result?: string | null;
  oa_result: string | null; oa_score: number | null;
  auto_fetch?: number | null; // 1=自动取数（每周定时自动写本期进展，不再催人填报）
  auto_fetch_source?: string | null; // 绑定的取数源 key
}

function getISOWeek(dateStr: string): { year: number; week: number } {
  if (!dateStr) return { year: new Date().getFullYear(), week: 0 };
  const d = new Date(dateStr);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const start = new Date(jan4);
  start.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d.getTime() - start.getTime();
  return { year: d.getFullYear(), week: Math.floor(diff / (7 * 86400000)) + 1 };
}

function formatDate(d: string | null) {
  if (!d) return '';
  return d.slice(0, 10).replace(/-/g, '/');
}

// ISO(UTC) → 本地时间显示（YYYY-MM-DD HH:mm）
function fmtLocal(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// OA create_date + create_time（UTC）→ 本地时间显示（YYYY-MM-DD HH:mm）
function fmtPushTime(pushDate: string | null | undefined, pushTime: string | null | undefined): string {
  if (!pushDate) return '—';
  if (pushTime) {
    const d = new Date(`${pushDate}T${pushTime.slice(0, 8)}Z`);
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  return pushDate;
}

function formatMonthDay(d: string | null) {
  if (!d) return '';
  const m = d.slice(5, 10).replace(/-/g, '/');
  return m || d.slice(0, 10);
}

function getSortDate(item: Item): string {
  try {
    const j = JSON.parse(item.oa_result || '{}');
    if (j.d) return String(j.d).slice(0, 10);
  } catch { /* ignore */ }
  return (item.meeting_date || '').slice(0, 10);
}

function parseYearWeek(item: Item): { year: number; week: number } {
  let y = '', w = '';
  // 优先从 initial_result（导入元数据）读年份/周，其次 oa_result（兼容旧数据）
  for (const src of [item.initial_result, item.oa_result]) {
    try {
      const j = JSON.parse(src || '{}');
      if (j.y) { y = String(j.y); w = String(j.w || ''); }
      if (y) break;
    } catch { /* ignore */ }
  }
  if (y || w) {
    const yn = parseInt(y);
    const wn = parseInt(w);
    if (!isNaN(yn) || !isNaN(wn)) {
      return { year: isNaN(yn) ? 0 : yn, week: isNaN(wn) ? 0 : wn };
    }
  }
  return getISOWeek(item.meeting_date || '');
}

export default function ContinuousPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'week' | 'owner'>('week');
  const [sortAsc, setSortAsc] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ description: '', proposer: '' });
  const [editingDeptId, setEditingDeptId] = useState<string | null>(null);
  const [deptDraft, setDeptDraft] = useState('');
  const [editingProposerDeptId, setEditingProposerDeptId] = useState<string | null>(null);
  const [proposerDeptDraft, setProposerDeptDraft] = useState('');
  const [editingOwnerId, setEditingOwnerId] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState('');
  const [ownerQuery, setOwnerQuery] = useState<string | undefined>(undefined);
  const [ownerPos, setOwnerPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const [departments, setDepartments] = useState<string[]>([]);
  const [userRole, setUserRole] = useState('');
  const [currentUserName, setCurrentUserName] = useState('');
  const [currentUserLoginId, setCurrentUserLoginId] = useState('');
  const [employees, setEmployees] = useState<string[]>([]);
  const [proposerQuery, setProposerQuery] = useState<string | undefined>(undefined);
  const [proposerPos, setProposerPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const [filters, setFilters] = useState<{ owner: string; dept: string; meeting_type: string; audit: string }>({ owner: '', dept: '', meeting_type: '', audit: 'unaudited' });
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [filterPos, setFilterPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const [view, setView] = useState<'list' | 'stats'>('list');
  const [cycles, setCycles] = useState<any[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsFilter, setStatsFilter] = useState('all'); // all | filled | unfilled
  const [statsTypeFilter, setStatsTypeFilter] = useState('all'); // all | 会议类型
  const [preview, setPreview] = useState<{ url: string; filename: string; kind: string; loading: boolean; error: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [autoBusy, setAutoBusy] = useState<string | null>(null); // 正在切换「自动取数」的项

  const openFilterMenu = (key: string, e: React.MouseEvent) => {
    if (openFilter === key) { setOpenFilter(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setFilterPos({ top: rect.bottom + 4, left: rect.left, width: 160 });
    setOpenFilter(key);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-filter-dropdown]') && !target.closest('[data-filter-trigger]')) setOpenFilter(null);
      if (!target.closest('[data-proposer-input]')) setProposerQuery(undefined);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.success) {
        setUserRole(d.data.role || '');
        setCurrentUserName(d.data.name || '');
        setCurrentUserLoginId(d.data.loginid || '');
      }
    }).catch(() => {});
    fetch('/api/org/employees').then(r => r.json()).then(d => {
      if (d.success) setEmployees((d.data || []).map((e: any) => e.name).filter(Boolean));
    }).catch(() => {});
    fetch('/api/org/departments').then(r => r.json()).then(d => {
      if (d.success) setDepartments((d.data || []).filter((x: any) => x.status !== 'inactive').map((x: any) => x.name));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/actions').then(r => r.json());
      if (r.success) {
        const all = (r.data || []) as Item[];
        // 只显示 Excel 里标注「持续」的持续项（due_date_type=continuous）及携带年/周/日期的持续项
        // 保险：排除推送周期任务（source_type=cycle），避免与源持续项重复
        setItems(all.filter(i => {
          if ((i as any).source_type === 'cycle') return false;
          if (i.due_date_type === 'continuous') return true;
          try { const j = JSON.parse(i.oa_result || '{}'); if (j.y || j.w || j.d) return true; } catch {}
          return false;
        }));
      }
    } catch { }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await fetch('/api/continuous/push-log').then(r => r.json());
      if (r.success) setCycles(r.data || []);
    } catch { }
    setStatsLoading(false);
  }, []);

  useEffect(() => { if (view === 'stats') loadStats(); }, [view, loadStats]);

  const syncFromOA = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/oa/pull-results', { method: 'POST' }).then(r => r.json());
      if (r.success) {
        const d = r.data || {};
        alert(`同步完成：行动项 ${d.synced || 0} 条，持续项进展 ${d.contSynced || 0} 条`);
        await loadStats();
      } else {
        alert('同步失败：' + (r.error || '未知错误'));
      }
    } catch {
      alert('同步失败：网络错误');
    }
    setSyncing(false);
  }, [loadStats]);

  const fetchAttachment = useCallback(async (fileId: string) => {
    setPreview({ url: '', filename: `附件${fileId}`, kind: '', loading: true, error: '' });
    try {
      const r = await fetch('/api/continuous/attachment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileid: fileId }),
      }).then(r => r.json());
      if (r.success) {
        setPreview({ url: r.data.url, filename: r.data.filename, kind: r.data.kind || 'other', loading: false, error: '' });
      } else {
        setPreview({ url: '', filename: `附件${fileId}`, kind: '', loading: false, error: r.error || '抓取失败' });
      }
    } catch {
      setPreview({ url: '', filename: `附件${fileId}`, kind: '', loading: false, error: '抓取失败' });
    }
  }, []);

  // 本地附件（系统填报上传，/api/files/xxx）直接预览/打开
  const openLocalFile = useCallback((url: string) => {
    const name = decodeURIComponent(url.split('/').filter(Boolean).pop() || '附件');
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    const kind = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext) ? 'image'
      : ext === 'pdf' ? 'pdf'
        : ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext) ? 'office' : 'other';
    setPreview({ url, filename: name, kind, loading: false, error: '' });
  }, []);

  // 开启/关闭「自动取数」：自动取数的持续项每周由系统定时自动写入本期进展，不再催人填报；
  // 开启时绑定取数源（目前默认首个可用源「呆滞出库」）
  const toggleAutoFetch = useCallback(async (item: Item, on: boolean) => {
    setAutoBusy(item.id);
    try {
      const body: any = { auto_fetch: on };
      if (on) body.auto_fetch_source = firstAutoFetchSourceKey();
      const res = await fetch(`/api/actions/${item.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) { alert((j as any).error || '设置失败'); return; }
      setItems(prev => prev.map(x => x.id === item.id
        ? { ...x, auto_fetch: on ? 1 : 0, auto_fetch_source: on ? firstAutoFetchSourceKey() : null }
        : x));
    } catch {
      alert('设置失败：网络错误');
    } finally {
      setAutoBusy(null);
    }
  }, []);

  const filterOptions = useMemo(() => {
    const owners = [...new Set(items.map(i => i.owner).filter(Boolean))].sort() as string[];
    const depts = [...new Set(items.map(i => i.dept).filter(Boolean))].sort() as string[];
    const types = [...new Set(items.map(i => i.meeting_type).filter(Boolean))].sort() as string[];
    return { owners, depts, types };
  }, [items]);

  const filtered = items.filter(i => {
    // 普通角色（employee/secretary）仅看自己相关的持续项（责任人=我 或 提出人=我）
    if (userRole === 'employee' || userRole === 'secretary') {
      const isOwner = i.owner === currentUserName || i.owner === currentUserLoginId;
      const isProposer = i.proposer === currentUserName || i.proposer === currentUserLoginId;
      if (!isOwner && !isProposer) return false;
    }
    if (search && !i.description.toLowerCase().includes(search.toLowerCase())
      && !i.owner?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filters.owner && i.owner !== filters.owner) return false;
    if (filters.dept && i.dept !== filters.dept) return false;
    if (filters.meeting_type && i.meeting_type !== filters.meeting_type) return false;
    if (filters.audit === 'audited' && (i as any).oa_score == null) return false;
    if (filters.audit === 'unaudited' && (i as any).oa_score != null) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let d = 0;
    if (sortKey === 'week') {
      const wa = parseYearWeek(a);
      const wb = parseYearWeek(b);
      d = wa.year !== wb.year ? wa.year - wb.year : wa.week - wb.week;
    } else if (sortKey === 'owner') {
      d = (a.owner || '').localeCompare(b.owner || '');
    }
    return sortAsc ? d : -d;
  });

  const paginated = sorted.slice(
    (pagination.page - 1) * pagination.pageSize,
    pagination.page * pagination.pageSize
  );

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const exportCSV = () => {
    const header = ['年份', '周', '部门', '类别', '日期', '提出人', '提议内容', '稽核', '评分', '责任人', '责任部门'];
    const rows = sorted.map(i => {
      const { year, week } = getISOWeek(i.meeting_date || '');
      const scoreLabel = i.oa_score === 1 ? 'V' : i.oa_score === -1 ? 'X' : i.oa_score === 0 ? '0' : '';
      const proposer = i.proposer || '';
      return [
        year, week, i.dept || '', i.meeting_type || '手动任务', formatDate(i.meeting_date),
        proposer, `"${(i.description || '').replace(/"/g, '""')}"`,
        scoreLabel, i.oa_score ?? '', i.owner || '', i.dept || '',
      ].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `持续项跟进_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importFile = async (file: File) => {
    let rows: { description: string; owner: string; dept: string; proposer: string; category: string; year: string; week: string; date: string }[] = [];
    let headerRow: string[] = [];

    // 根据列名找索引（模糊匹配）
    const findCol = (names: string[]): number => {
      for (const name of names) {
        const idx = headerRow.findIndex(h => h.includes(name) || name.includes(h));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    // Excel 日期序列号转 YYYY-MM-DD
    const fmtExcelDate = (v: any): string => {
      if (typeof v === 'number' && v > 10000) {
        const d = new Date((v - 25569) * 86400 * 1000);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
      return String(v || '').trim();
    };

    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      const lines = text.split('\n').filter(Boolean);
      if (lines.length < 2) { alert('CSV 文件为空或格式不正确'); return; }
      headerRow = lines[0].split(',').map(s => s.replace(/^"|"$/g, '').trim());
      const descIdx = findCol(['提议内容', '任务描述', '内容']);
      const ownerIdx = findCol(['责任人', '负责人', 'owner']);
      const deptIdx = findCol(['责任部门', '部门']);
      const proposerIdx = findCol(['提出人', '提议人']);
      const categoryIdx = findCol(['类别', '分类']);
      const yearIdx = findCol(['年份']);
      const weekIdx = findCol(['周序', '周次', '周']);
      const dateIdx = findCol(['日期', '时间']);
      if (descIdx === -1) { alert('未找到"提议内容"列'); return; }
      rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
        return {
          description: cols[descIdx] || '', owner: ownerIdx >= 0 ? (cols[ownerIdx] || '') : '',
          dept: deptIdx >= 0 ? (cols[deptIdx] || '') : '', proposer: proposerIdx >= 0 ? (cols[proposerIdx] || '') : '',
          category: categoryIdx >= 0 ? (cols[categoryIdx] || '') : '',
          year: yearIdx >= 0 ? (cols[yearIdx] || '') : '', week: weekIdx >= 0 ? (cols[weekIdx] || '') : '',
          date: dateIdx >= 0 ? (cols[dateIdx] || '') : '',
        };
      }).filter(r => r.description);
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (json.length < 2) { alert('Excel 文件为空或格式不正确'); return; }
      headerRow = (json[0] || []).map((h: any) => String(h || '').trim());
      const descIdx = findCol(['提议内容', '任务描述', '内容']);
      const ownerIdx = findCol(['责任人', '负责人', 'owner']);
      const deptIdx = findCol(['责任部门', '部门']);
      const proposerIdx = findCol(['提出人', '提议人']);
      const categoryIdx = findCol(['类别', '分类']);
      const yearIdx = findCol(['年份']);
      const weekIdx = findCol(['周序', '周次', '周']);
      const dateIdx = findCol(['日期', '时间']);
      if (descIdx === -1) { alert('未找到"提议内容"列'); return; }
      rows = json.slice(1).map((row: any[]) => ({
        description: String(row[descIdx] || '').trim(),
        owner: ownerIdx >= 0 ? String(row[ownerIdx] || '').trim() : '',
        dept: deptIdx >= 0 ? String(row[deptIdx] || '').trim() : '',
        proposer: proposerIdx >= 0 ? String(row[proposerIdx] || '').trim() : '',
        category: categoryIdx >= 0 ? String(row[categoryIdx] || '').trim() : '',
        year: yearIdx >= 0 ? String(row[yearIdx] || '').trim() : '',
        week: weekIdx >= 0 ? String(row[weekIdx] || '').trim() : '',
        date: dateIdx >= 0 ? fmtExcelDate(row[dateIdx]) : '',
      })).filter(r => r.description);
    } else {
      alert('仅支持 .csv / .xlsx / .xls 格式');
      return;
    }

    if (rows.length === 0) { alert('未读取到有效数据'); return; }

    const batchTitle = `导入_持续项_${new Date().toISOString().slice(0, 10)}`;
    const res = await fetch('/api/actions/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: batchTitle, sourceChannel: 'other',
        items: rows.map(r => ({
          description: r.description, owner: r.owner, dueDate: '', dueDateType: 'continuous', priority: 'medium',
          proposer: r.proposer, category: r.category,
          year: r.year, week: r.week, date: r.date,
        })),
      }),
    }).then(r => r.json());

    if (res.success) {
      alert(`导入成功：${rows.length} 条持续项`);
      load();
    } else {
      alert(res.error || '导入失败');
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">持续项跟进</h1>
            <div className="flex items-center gap-1 mt-2 bg-slate-100 rounded-xl p-0.5 w-fit">
              {[
                { key: 'list' as const, label: '持续项列表' },
                { key: 'stats' as const, label: '填报统计' },
              ].map(t => (
                <button key={t.key} onClick={() => setView(t.key)}
                  className={`px-3 h-7 rounded-lg text-xs font-medium transition-all ${view === t.key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {view === 'list' && (<>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); }} />
            <button onClick={() => fileInputRef.current?.click()} className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> 导入Excel/CSV
            </button>
            <button onClick={exportCSV} className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> 导出CSV
            </button>
            <button onClick={load} className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            </>)}
            {view === 'stats' && (
            <>
            <button onClick={syncFromOA} disabled={syncing}
              className="h-9 px-3 rounded-xl border border-blue-200 bg-blue-50 text-xs font-medium text-blue-600 hover:bg-blue-100 flex items-center gap-1.5 disabled:opacity-50 transition-all">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? '同步中...' : '立即同步OA'}
            </button>
            <button onClick={loadStats} className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all">
              <RefreshCw className={`w-4 h-4 ${statsLoading ? 'animate-spin' : ''}`} />
            </button>
            </>
            )}
          </div>
        </div>

        {/* 搜索 */}
        {view === 'list' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="搜索内容/负责人..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 pl-9 text-sm rounded-2xl border-slate-200" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Switch
              checked={filters.audit === 'unaudited'}
              onCheckedChange={on => {
                setFilters(f => ({ ...f, audit: on ? 'unaudited' : '' }));
                setPagination(p => ({ ...p, page: 1 }));
              }}
              className={filters.audit === 'unaudited' ? 'data-[state=checked]:bg-amber-500' : ''}
            />
            <span className={`text-xs font-medium ${filters.audit === 'unaudited' ? 'text-amber-600' : 'text-slate-400'}`}>
              仅看未稽核
            </span>
          </label>
        </div>
        )}

        {/* 表格 */}
        {view === 'list' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div style={{ overflow: 'visible' }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('week')}>
                    <span className="flex items-center gap-1">年份/周 {sortKey === 'week' && <ArrowUpDown className="w-3 h-3" />}</span>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                    <div className="flex items-center gap-1 cursor-pointer select-none" onClick={e => openFilterMenu('dept', e)} data-filter-trigger>
                      <span>部门</span>
                      <Filter className={`w-3 h-3 ${filters.dept ? 'text-blue-600 fill-blue-600' : 'text-slate-300 hover:text-slate-500'}`} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                    <div className="flex items-center gap-1 cursor-pointer select-none" onClick={e => openFilterMenu('meeting_type', e)} data-filter-trigger>
                      <span>类别</span>
                      <Filter className={`w-3 h-3 ${filters.meeting_type ? 'text-blue-600 fill-blue-600' : 'text-slate-300 hover:text-slate-500'}`} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">日期</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">提出人</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[200px]">提议内容</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                    <div className="flex items-center gap-1 cursor-pointer select-none" onClick={e => openFilterMenu('owner', e)} data-filter-trigger>
                      <span>责任人</span>
                      <Filter className={`w-3 h-3 ${filters.owner ? 'text-blue-600 fill-blue-600' : 'text-slate-300 hover:text-slate-500'}`} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                    <div className="flex items-center gap-1 cursor-pointer select-none" onClick={e => openFilterMenu('dept2', e)} data-filter-trigger>
                      <span>责任部门</span>
                      <Filter className={`w-3 h-3 ${filters.dept ? 'text-blue-600 fill-blue-600' : 'text-slate-300 hover:text-slate-500'}`} />
                    </div>
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap" title="开启后每周定时自动取数写入本期进展，系统不再催人填报">
                    自动取数
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1 cursor-pointer select-none" onClick={e => openFilterMenu('audit', e)} data-filter-trigger>
                      <span>稽核</span>
                      <Filter className={`w-3 h-3 ${filters.audit ? 'text-blue-600 fill-blue-600' : 'text-slate-300 hover:text-slate-500'}`} />
                    </div>
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">评分</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('week')}>
                    <span className="flex items-center gap-1">排序</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr><td colSpan={12} className="text-center py-16 text-slate-400">加载中...</td></tr>
                ) : paginated.length === 0 ? (
                  <tr><td colSpan={12} className="text-center py-16 text-slate-400">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>暂无持续项</p>
                  </td></tr>
                ) : paginated.map(item => {
                  // 优先使用导入时存的值（initial_result 优先，其次 oa_result 兼容旧数据）
                  let impYear = '', impWeek = '', impDate = '';
                  for (const src of [item.initial_result, item.oa_result]) {
                    try { const j = JSON.parse(src || '{}'); if (j.y) impYear = j.y; if (j.w) impWeek = j.w; if (j.d) impDate = j.d; } catch {}
                    if (impYear) break;
                  }
                  const { year, week } = impYear ? { year: parseInt(impYear), week: parseInt(impWeek) || 0 } : getISOWeek(item.meeting_date || '');
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-slate-500 text-[10px]">{year || '—'}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-[11px]">{week || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {editingProposerDeptId === item.id ? (
                          <DeptSelect
                            value={proposerDeptDraft}
                            onChange={setProposerDeptDraft}
                            options={departments}
                            onBlur={async (val) => {
                              await fetch(`/api/actions/${item.id}`, {
                                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ proposer_dept: val || null }),
                              });
                              setEditingProposerDeptId(null); load();
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingProposerDeptId(item.id); setProposerDeptDraft(item.proposer_dept || ''); }}
                            className="text-slate-600 hover:text-blue-600 hover:underline"
                            title="点击修改部门"
                          >{item.proposer_dept || '—'}</button>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded">{item.meeting_type || '手动任务'}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatMonthDay(impDate || item.meeting_date) || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {editingId === item.id ? (
                          <input value={editForm.proposer}
                            onChange={e => { setEditForm(f => ({ ...f, proposer: e.target.value })); setProposerQuery(e.target.value); }}
                            onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); setProposerPos({ top: r.bottom + 4, left: r.left, width: 160 }); setProposerQuery(editForm.proposer); }}
                            className="w-28 h-7 text-sm border border-slate-200 rounded-lg px-1.5 outline-none focus:ring-1 focus:ring-blue-300"
                            placeholder="提出人" data-proposer-input />
                        ) : (item.proposer || <span className="text-slate-300">待补充</span>)}
                      </td>
                      <td className="px-4 py-3 text-slate-800 max-w-[300px]">
                        {editingId === item.id ? (
                          <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                            className="w-full h-7 text-sm border border-slate-200 rounded-lg px-2 outline-none focus:ring-1 focus:ring-blue-300" autoFocus />
                        ) : (
                        <div className="line-clamp-2" title={item.description}>{item.description}</div>
                        )}
                        {editingId !== item.id && (
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          {item.meeting_id ? (
                            // 来源于会议：显示会议名 + 跳转链接（与行动项台账一致）
                            <>
                              <span className="text-[10px] text-slate-400 truncate max-w-[140px]" title={item.meeting_title}>📋 {item.meeting_title}</span>
                              <Link href={`/meeting/${item.meeting_id}`} target="_blank"
                                className="text-[10px] text-blue-400 hover:text-blue-600 flex items-center gap-0.5 shrink-0">
                                <ExternalLink className="w-2.5 h-2.5" /> 查看
                              </Link>
                            </>
                          ) : item.meeting_title?.startsWith('导入_') ? (
                            // 导入批次
                            <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded" title={`导入批次：${item.meeting_title}`}>📥 {item.meeting_title}</span>
                          ) : item.meeting_title ? (
                            <span className="text-[10px] text-slate-400 truncate max-w-[120px]">{item.meeting_title}</span>
                          ) : (
                            <span className="text-[10px] text-slate-300">手动创建</span>
                          )}
                        </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {editingOwnerId === item.id ? (
                          <div className="relative" data-owner-input>
                            <input
                              autoFocus
                              value={ownerDraft}
                              onChange={e => { setOwnerDraft(e.target.value); setOwnerQuery(e.target.value); }}
                              onFocus={e => { const r = e.currentTarget.getBoundingClientRect(); setOwnerPos({ top: r.bottom + 4, left: r.left, width: 160 }); setOwnerQuery(ownerDraft); }}
                              onBlur={async () => {
                                await fetch(`/api/actions/${item.id}`, {
                                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ owner: ownerDraft || null }),
                                });
                                setEditingOwnerId(null); setOwnerQuery(undefined); load();
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                                if (e.key === 'Escape') { setEditingOwnerId(null); setOwnerQuery(undefined); }
                              }}
                              placeholder="输入或选择责任人"
                              data-owner-input
                              className="w-28 h-7 text-sm border border-slate-200 rounded-lg px-1.5 outline-none focus:ring-1 focus:ring-blue-300"
                            />
                            {ownerQuery !== undefined && employees.length > 0 && (
                              <div className="fixed z-50 bg-white rounded-xl border border-slate-200 shadow-xl py-1 max-h-52 overflow-y-auto"
                                style={{ top: ownerPos.top, left: ownerPos.left, minWidth: ownerPos.width }}
                              >
                                {employees.filter(e => e.includes(ownerQuery)).slice(0, 10).map(emp => (
                                  <button key={emp} type="button"
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={async () => {
                                      await fetch(`/api/actions/${item.id}`, {
                                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ owner: emp || null }),
                                      });
                                      setEditingOwnerId(null); setOwnerQuery(undefined); load();
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 text-slate-700">
                                    {emp}
                                  </button>
                                ))}
                                {employees.filter(e => e.includes(ownerQuery)).length === 0 && (
                                  <div className="px-3 py-2 text-xs text-slate-300">无匹配</div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingOwnerId(item.id); setOwnerDraft(item.owner || ''); }}
                            className="text-slate-700 font-medium hover:text-blue-600 hover:underline"
                            title="点击修改责任人"
                          >{item.owner || '—'}</button>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {editingDeptId === item.id ? (
                          <DeptSelect
                            value={deptDraft}
                            onChange={setDeptDraft}
                            options={departments}
                            onBlur={async (val) => {
                              await fetch(`/api/actions/${item.id}`, {
                                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ dept: val || null }),
                              });
                              setEditingDeptId(null); load();
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingDeptId(item.id); setDeptDraft(item.dept || ''); }}
                            className="text-slate-500 hover:text-blue-600 hover:underline"
                            title="点击修改责任部门"
                          >{item.dept || '—'}</button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {userRole === 'admin' ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <Switch
                              checked={!!(item as any).auto_fetch}
                              onCheckedChange={(on: boolean) => toggleAutoFetch(item, on)}
                              disabled={autoBusy === item.id}
                              aria-label="自动取数"
                              title={((item as any).auto_fetch ? '已开启自动取数：每周定时自动写本期进展，不再催人填报' : '开启自动取数：每周定时自动写本期进展，不再催人填报')}
                            />
                            <span className="text-[10px] text-slate-400 leading-none"
                              title={((item as any).auto_fetch ? (autoFetchSourceDesc((item as any).auto_fetch_source) || '') : '')}>
                              {((item as any).auto_fetch ? (autoFetchSourceName((item as any).auto_fetch_source) || '—') : '—')}
                            </span>
                          </div>
                        ) : ((item as any).auto_fetch ? (
                          <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full"
                            title={autoFetchSourceDesc((item as any).auto_fetch_source) || undefined}>
                            自动·{autoFetchSourceName((item as any).auto_fetch_source) || ''}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        ))}
                      </td>
                      {editingId === item.id ? (
                        <React.Fragment>
                          <td className="px-4 py-3 text-center" colSpan={2}>
                            <div className="flex items-center justify-center gap-1.5">
                              <button onClick={async () => {
                                await fetch(`/api/actions/${item.id}`, {
                                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ description: editForm.description, proposer: editForm.proposer || null }),
                                });
                                setEditingId(null); load();
                              }} className="h-7 px-3 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700">保存</button>
                              <button onClick={() => setEditingId(null)} className="h-7 px-3 text-slate-400 text-xs hover:text-slate-600">取消</button>
                            </div>
                          </td>
                          <td className="px-2 py-3" />
                        </React.Fragment>
                      ) : (
                        <React.Fragment>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            {userRole === 'admin' ? (
                            <div className="flex items-center justify-center gap-1">
                              {[
                                { val: 1, label: 'V', activeCls: 'bg-emerald-100 text-emerald-700 border-emerald-300', inactiveCls: 'bg-white text-slate-300 border-slate-200 hover:border-emerald-300 hover:text-emerald-500' },
                                { val: 0, label: '0', activeCls: 'bg-slate-100 text-slate-500 border-slate-300', inactiveCls: 'bg-white text-slate-300 border-slate-200 hover:border-slate-300' },
                                { val: -1, label: 'X', activeCls: 'bg-red-100 text-red-700 border-red-300', inactiveCls: 'bg-white text-slate-300 border-slate-200 hover:border-red-300 hover:text-red-500' },
                              ].map(opt => {
                                const mark = (item as any).oa_score;
                                const isLocked = mark !== null && mark !== undefined;
                                return (
                                <button key={opt.label}
                                  disabled={isLocked && mark !== opt.val}
                                  onClick={async () => {
                                    const next = mark === opt.val ? null : opt.val;
                                    const body: any = { oa_score: next, oa_auto_detected: false };
                                    if (next !== null) body.status = next === -1 ? 'blocked' : 'done';
                                    await fetch(`/api/actions/${item.id}`, {
                                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(body),
                                    });
                                    load();
                                  }}
                                  className={`w-7 h-7 rounded-full text-sm font-bold border flex items-center justify-center transition-all disabled:cursor-not-allowed disabled:opacity-30 ${mark === opt.val ? opt.activeCls : opt.inactiveCls}`}
                                >{opt.label}</button>
                                );
                              })}
                            </div>
                            ) : ((item as any).oa_score != null ? (
                              <span className={`text-sm font-bold ${(item as any).oa_score > 0 ? 'text-emerald-600' : (item as any).oa_score === 0 ? 'text-slate-500' : 'text-red-600'}`}>
                                {(item as any).oa_score > 0 ? 'V' : (item as any).oa_score === 0 ? '0' : 'X'}
                              </span>
                            ) : <span className="text-slate-300 text-xs" title="仅管理员可稽核">—</span>)}
                          </td>
                          <td className="px-4 py-3 text-center text-sm font-medium">
                            {(item as any).oa_score != null ? (
                              <span className={`text-sm font-bold ${(item as any).oa_score > 0 ? 'text-emerald-600' : (item as any).oa_score === 0 ? 'text-slate-500' : 'text-red-600'}`}>
                                {(item as any).oa_score > 0 ? '+1' : (item as any).oa_score}
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          {userRole === 'admin' && (
                          <td className="px-2 py-3 text-center">
                            <button onClick={() => { setEditingId(item.id); setEditForm({ description: item.description, proposer: item.proposer || '' }); }}
                              className="w-6 h-6 rounded hover:bg-slate-100 flex items-center justify-center text-slate-300 hover:text-blue-500 transition-colors"
                              title="编辑"><Pencil className="w-3.5 h-3.5" /></button>
                          </td>
                          )}
                        </React.Fragment>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sorted.length > pagination.pageSize && (
            <div className="px-4 py-3 border-t border-slate-100">
              <WeaverPagination
                current={pagination.page} pageSize={pagination.pageSize} total={sorted.length}
                onPageChange={(p: number) => setPagination(prev => ({ ...prev, page: p }))}
              />
            </div>
          )}
        </div>
        )}

        {/* 填报统计 */}
        {view === 'stats' && (
        <div className="space-y-4">
          {/* 会议类型筛选 */}
          {(() => {
            const allTypes = [...new Set(
              (cycles as any[]).flatMap(c => (c.items || []).map((it: any) => it.meetingType).filter(Boolean))
            )].sort();
            return allTypes.length > 0 ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400">会议类型：</span>
                <button
                  onClick={() => setStatsTypeFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${statsTypeFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >全部</button>
                {allTypes.map(t => (
                  <button
                    key={t}
                    onClick={() => setStatsTypeFilter(t)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${statsTypeFilter === t ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >{t}</button>
                ))}
              </div>
            ) : null;
          })()}

          {statsLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center text-slate-400 text-sm">加载中...</div>
          ) : cycles.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 py-16 text-center text-slate-400">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>暂无推送记录</p>
            </div>
          ) : (
            cycles.map(cycle => {
              const items = cycle.items.filter((it: any) => {
                if (statsTypeFilter !== 'all' && it.meetingType !== statsTypeFilter) return false;
                return statsFilter === 'all' ? true : statsFilter === 'filled' ? it.filled : !it.filled;
              });
              return (
                <div key={cycle.date} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-slate-800">周期 {cycle.date}</span>
                      <span className="text-xs text-slate-500">共 {items.length} 条</span>
                      <span className="text-xs text-emerald-600">已填 {items.filter((i: any) => i.filled).length}</span>
                      <span className="text-xs text-amber-600">未填 {items.filter((i: any) => !i.filled).length}</span>
                      <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-0.5 ml-2">
                        {[
                          { key: 'all', label: '全部' },
                          { key: 'filled', label: '已填' },
                          { key: 'unfilled', label: '未填' },
                        ].map(opt => (
                          <button key={opt.key} onClick={() => setStatsFilter(opt.key)}
                            className={`px-2.5 h-6 rounded-md text-[11px] font-medium transition-all ${statsFilter === opt.key ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <table className="w-full text-xs table-fixed">
                    <colgroup>
                      <col className="w-[120px]" />
                      <col />
                      <col />
                      <col className="w-[150px]" />
                      <col className="w-[76px]" />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-100">
                        <th className="text-left px-4 py-2.5 font-semibold text-slate-600">责任人</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-slate-600">内容</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-slate-600">完成情况</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-slate-600">推送 / 填报</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-slate-600">状态</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {items.map((it: any) => (
                        <tr key={it.taskId} className="hover:bg-slate-50/50 transition-colors align-top">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="text-slate-700 font-medium">{it.ownerName || '—'}</div>
                            {it.meetingType && (
                              <span className="inline-flex items-center text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full mt-1">{it.meetingType}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">
                            <div className="line-clamp-2" title={it.description}>{it.description}</div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded ${it.source === '会议助手' ? 'text-blue-600 bg-blue-50' : 'text-purple-600 bg-purple-50'}`}>
                                {it.source || 'OA'}
                              </span>
                              {(it.meetingTitle || it.itemDate) && (
                                <span className="text-[10px] text-slate-400 truncate max-w-[220px]" title={`对应持续项：${it.meetingTitle || '无来源会议'}${it.itemDate ? `（${it.itemDate}）` : ''}`}>
                                  📋 {it.meetingTitle || '无来源会议'}{it.itemDate ? ` · ${it.itemDate}` : ''}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {it.content ? (
                              <div className="line-clamp-2 text-slate-700" title={it.content}>{it.content}</div>
                            ) : <span className="text-slate-300">—</span>}
                            {it.attachments.length > 0 && (
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {it.attachments.map((a: any) => (
                                  <button key={a.fileId} onClick={() => fetchAttachment(a.fileId)}
                                    className="inline-flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded-lg transition-colors">
                                    <Download className="w-3 h-3" /> 附件{a.fileId}
                                  </button>
                                ))}
                              </div>
                            )}
                            {Array.isArray(it.localAttachments) && it.localAttachments.length > 0 && (
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                {it.localAttachments.map((u: string, i: number) => (
                                  <button key={u} onClick={() => openLocalFile(u)} title={u.split('/').pop()}
                                    className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:border-blue-300 transition-colors">
                                    <img src={u} alt={`附件${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-500 text-[11px]">
                            <div title={`推送时间 ${fmtPushTime(it.pushDate, it.pushTime)}`}>推送 {fmtPushTime(it.pushDate, it.pushTime)}</div>
                            <div className="mt-0.5">
                              {it.filled
                                ? (it.syncedAt
                                  ? <span className="text-emerald-600" title={it.syncedAt}>填报 {fmtLocal(it.syncedAt)}</span>
                                  : <span className="text-slate-300">填报 —</span>)
                                : <span className="text-slate-300">未填报</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {it.filled ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 已填
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> 未填
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr><td colSpan={5} className="text-center py-8 text-slate-400">无数据</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
        )}

        {/* 附件预览弹窗 */}
        {preview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={() => setPreview(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <span className="text-sm font-semibold text-slate-800 truncate">{preview.filename}</span>
                <button onClick={() => setPreview(null)} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
                  <FileText className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 max-h-[70vh] overflow-auto">
                {preview.loading ? (
                  <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 正在从 OA 抓取附件...
                  </div>
                ) : preview.error ? (
                  <div className="py-16 text-center">
                    <p className="text-sm text-red-500 mb-3">{preview.error}</p>
                    <p className="text-xs text-slate-400">OA 附件抓取受限，可尝试在 OA 中直接查看</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {preview.kind === 'image' && (
                      <img src={preview.url} alt={preview.filename} className="max-w-full h-auto rounded-xl mx-auto" />
                    )}
                    {preview.kind === 'pdf' && (
                      <iframe src={preview.url} className="w-full h-[60vh] rounded-xl border border-slate-200" title={preview.filename} />
                    )}
                    {preview.kind === 'office' && (
                      <div className="py-12 text-center">
                        <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                        <p className="text-sm text-slate-500 mb-1">该文件为 {preview.filename}</p>
                        <p className="text-xs text-slate-400 mb-4">Office 文档暂不支持在线预览，请下载后查看</p>
                      </div>
                    )}
                    {preview.kind === 'other' && (
                      <div className="py-12 text-center">
                        <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                        <p className="text-sm text-slate-500 mb-4">该文件类型暂不支持在线预览，请下载后查看</p>
                      </div>
                    )}
                    <a href={preview.url} download={preview.filename}
                      className="inline-flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg">
                      <Download className="w-3.5 h-3.5" /> 下载到本地
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 提出人搜索下拉 */}
        {proposerQuery !== undefined && employees.length > 0 && (
          <div data-filter-dropdown
            className="fixed z-50 bg-white rounded-xl border border-slate-200 shadow-xl py-1 max-h-52 overflow-y-auto"
            style={{ top: proposerPos.top, left: proposerPos.left, minWidth: proposerPos.width }}
          >
            {employees.filter(e => e.includes(proposerQuery)).slice(0, 10).map(emp => (
              <button key={emp} type="button"
                onClick={() => { setEditForm(f => ({ ...f, proposer: emp })); setProposerQuery(undefined); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 text-slate-700">
                {emp}
              </button>
            ))}
            {employees.filter(e => e.includes(proposerQuery)).length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-300">无匹配</div>
            )}
          </div>
        )}

        {/* 筛选下拉浮层 */}
        {openFilter && (() => {
          const col = openFilter;
          let label = '', options: string[] = [], value = '', setValue = (v: string) => {};
          if (col === 'dept' || col === 'dept2') { label = '部门'; options = filterOptions.depts; value = filters.dept; setValue = (v) => setFilters(f => ({ ...f, dept: v })); }
          else if (col === 'meeting_type') { label = '类别'; options = filterOptions.types; value = filters.meeting_type; setValue = (v) => setFilters(f => ({ ...f, meeting_type: v })); }
          else if (col === 'owner') { label = '责任人'; options = filterOptions.owners; value = filters.owner; setValue = (v) => setFilters(f => ({ ...f, owner: v })); }
          else if (col === 'audit') { label = '稽核'; options = []; value = filters.audit; setValue = (v) => setFilters(f => ({ ...f, audit: v })); }
          return (
            <div data-filter-dropdown
              className="fixed z-50 bg-white rounded-xl border border-slate-200 shadow-xl py-1 max-h-72 overflow-y-auto"
              style={{ top: filterPos.top, left: filterPos.left, minWidth: filterPos.width }}
              onClick={e => e.stopPropagation()}
            >
              <button onClick={() => { setValue(''); setOpenFilter(null); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${!value ? 'font-bold text-blue-600' : 'text-slate-500'}`}>全部</button>
              {col === 'audit' ? (
                <>
                  <button onClick={() => { setFilters(f => ({ ...f, audit: 'audited' })); setOpenFilter(null); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${filters.audit === 'audited' ? 'font-bold text-blue-600 bg-blue-50' : 'text-slate-700'}`}>已稽核</button>
                  <button onClick={() => { setFilters(f => ({ ...f, audit: 'unaudited' })); setOpenFilter(null); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${filters.audit === 'unaudited' ? 'font-bold text-blue-600 bg-blue-50' : 'text-slate-700'}`}>未稽核</button>
                </>
              ) : options.map(opt => (
                <button key={opt} onClick={() => { setValue(opt); setOpenFilter(null); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 ${value === opt ? 'font-bold text-blue-600 bg-blue-50' : 'text-slate-700'}`}>
                  {opt}
                </button>
              ))}
            </div>
          );
        })()}
      </div>
    </DashboardLayout>
  );
}
