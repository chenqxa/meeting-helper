'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { RefreshCw, Search, Download, CheckCircle2, XCircle, Clock, AlertTriangle, ChevronDown, ChevronUp, ExternalLink, Calculator, FileText, X, ShieldAlert, User, Sparkles, Presentation, Upload, Filter, ArrowUpRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { getActionDisplayLabel, getActionDisplayStatus } from '@/lib/action-status';
import { getDisplayOaResult } from '@/lib/oa-result-display';
import { DeptSelect } from '@/components/ui/dept-select';

interface TrackItem {
  id: string;
  description: string;
  owner: string | null;
  dept: string | null;
  due_date: string | null;
  due_date_type?: string | null;
  priority: string;
  status: string;
  meeting_id: string;
  meeting_title: string;
  meeting_type: string;
  meeting_date: string;
  meeting_organizer: string;
  proposer?: string | null;
  proposer_dept?: string | null;
  reassigned_from?: string | null;
  reassigned_to?: string | null;
  oa_result: string | null;
  oa_result_at: string | null;
  oa_score: number | null;
  oa_auto_detected: boolean;
  oa_attachments?: string[];
  completed_at: string | null;
  block_reason: string | null;
}

// ISO 周数
function getISOWeek(dateStr: string): { year: number; week: number } {
  if (!dateStr) return { year: new Date().getFullYear(), week: 0 };
  const d = new Date(dateStr);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d.getTime() - startOfWeek1.getTime();
  const week = Math.floor(diff / (7 * 86400000)) + 1;
  return { year: d.getFullYear(), week: Math.max(1, week) };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '';
  return dateStr.slice(0, 10).replace(/-/g, '/');
}

function formatMonthDay(dateStr: string | null) {
  if (!dateStr) return '';
  return dateStr.slice(5, 10).replace(/-/g, '/') || dateStr.slice(0, 10);
}

function effectiveScore(item: TrackItem): number | null {
  if (item.oa_score !== null && item.oa_score !== undefined) return item.oa_score;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (item.due_date && (item.due_date_type || 'date') === 'date' && new Date(item.due_date) < today && !item.oa_result
    && item.status !== 'done' && item.status !== 'verified') {
    return -1;
  }
  return null;
}

function ScoreBadge({ score, auto }: { score: number | null; auto?: boolean }) {
  if (score === null) return <span className="text-slate-300 text-sm">—</span>;
  if (score === 1) return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 font-bold text-sm border border-emerald-300">V</span>
  );
  if (score === -1) return (
    <span className="inline-flex flex-col items-center justify-center w-7 h-7 rounded-full bg-red-100 text-red-700 font-bold text-sm border border-red-300" title={auto ? '到期无回传，自动判定未完成' : undefined}>
      ❌{auto && <span className="text-[7px] leading-none font-normal text-red-400 -mt-1">自动</span>}
    </span>
  );
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-500 font-bold text-sm border border-slate-300">0</span>
  );
}

function displayStatus(item: TrackItem): string {
  // 稽核标记优先：V/0 → 已处理，X → 阻塞
  if (item.oa_score === 1) return 'done';
  if (item.oa_score === -1) return 'blocked';
  if (item.oa_score === 0) return 'done';
  const s = item.status;
  if (s === 'done' || s === 'verified' || s === 'in_progress' || s === 'blocked' || s === 'cancelled') return s;
  return 'pending';
}

function StatusTag({ status, score }: { status: string; score?: number | null }) {
  const map: Record<string, { label: string; cls: string }> = {
    done:       { label: '已处理', cls: 'bg-emerald-100 text-emerald-700' },
    verified:   { label: '已勾稽', cls: 'bg-blue-100 text-blue-700' },
    in_progress:{ label: '进行中', cls: 'bg-blue-100 text-blue-700' },
    blocked:    { label: '未完成',   cls: 'bg-red-100 text-red-700' },
    pending:    { label: '未处理', cls: 'bg-amber-100 text-amber-700' },
    candidate:  { label: '未处理', cls: 'bg-amber-100 text-amber-700' },
    confirmed:  { label: '未处理', cls: 'bg-amber-100 text-amber-700' },
    cancelled:  { label: '已取消', cls: 'bg-slate-200 text-slate-500' },
  };
  let key = displayStatus({ ...({ status } as any), oa_score: score ?? null } as TrackItem);
  const { label, cls } = map[key] || { label: status, cls: 'bg-slate-100 text-slate-500' };
  return <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${cls}`}>{label}</span>;
}

// Excel 式列筛选：表头点漏斗图标弹出多选面板
function FilterMenu({
  title,
  values,
  selected,
  onChange,
  suffix,
  render,
}: {
  title: string;
  values: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  suffix?: React.ReactNode;
  render?: (v: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const active = selected.length > 0;
  const list = values.filter(v => !kw || String(v).toLowerCase().includes(kw.toLowerCase()));
  const allSelected = values.length > 0 && selected.length === values.length;

  return (
    <div className="relative inline-flex items-center" ref={ref}>
      <span className="inline-flex items-center gap-1 select-none">{title}{suffix}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className={`inline-flex items-center justify-center w-4 h-4 rounded hover:bg-slate-200 transition-colors ${active ? 'text-blue-600' : 'text-slate-300 hover:text-slate-500'}`}
          title={`筛选${title}`}
        >
          <Filter className="w-3 h-3" />
        </button>
      </span>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg p-2">
          <input
            autoFocus
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索..."
            className="w-full h-6 text-xs border border-slate-200 rounded px-1.5 mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
          <div className="max-h-44 overflow-y-auto">
            <label className="flex items-center gap-1.5 py-1 text-xs cursor-pointer hover:bg-slate-50 rounded">
              <input type="checkbox" checked={allSelected}
                onChange={() => onChange(allSelected ? [] : [...values])} />
              <span className="text-slate-600 font-medium">全选</span>
            </label>
            <div className="border-t border-slate-100 my-1" />
            {list.map(v => (
              <label key={v} className="flex items-center gap-1.5 py-1 text-xs cursor-pointer hover:bg-slate-50 rounded">
                <input type="checkbox" checked={selected.includes(v)}
                  onChange={() => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])} />
                <span className="truncate">{render ? render(v) : v}</span>
              </label>
            ))}
            {list.length === 0 && <div className="text-xs text-slate-400 py-1">无匹配项</div>}
          </div>
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100">
            <button type="button" onClick={() => onChange([])} className="text-[11px] text-slate-400 hover:text-slate-600">清除</button>
            <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-blue-600 font-medium hover:text-blue-700">确定</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 内联可搜索的责任人选择器
function InlineOwnerPicker({ employees, initial, onSave, onCancel }: {
  employees: string[];
  initial: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  const list = employees
    .filter(n => !q || n.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 15);

  return (
    <div className="relative inline-block" ref={ref}>
      <input autoFocus value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onSave(q.trim()); }
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="搜索姓名..."
        className="h-6 w-32 text-xs border border-blue-300 rounded px-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
      />
      {list.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 w-40 bg-white border border-slate-200 rounded shadow-lg max-h-48 overflow-y-auto">
          {list.map(n => (
            <button key={n} onMouseDown={() => onSave(n)}
              className="block w-full text-left px-2 py-1 text-xs hover:bg-blue-50 truncate">{n}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrackingPage() {
  const [items, setItems] = useState<TrackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterYear, setFilterYear] = useState<string[]>([]);
  const [filterDept, setFilterDept] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [filterProposer, setFilterProposer] = useState<string[]>([]);
  const [filterOwner, setFilterOwner] = useState<string[]>([]);
  const [filterDue, setFilterDue] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterScore, setFilterScore] = useState<string[]>([]);
  const [filterResult, setFilterResult] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | 'this_month' | 'last_month' | 'this_quarter'>('all');
  const [customDateStart, setCustomDateStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [customDateEnd, setCustomDateEnd] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [expandedResult, setExpandedResult] = useState<string | null>(null);

  // 分页状态（已改为全量显示，不再分页）
  const [sortKey, setSortKey] = useState<'week' | 'due_date' | 'score'>('week');
  const [sortAsc, setSortAsc] = useState(false);
  const [redelegateItem, setRedelegateItem] = useState<TrackItem | null>(null);
  const [rdForm, setRdForm] = useState({ description: '', owner: '', proposer: '', due_date: '' });
  // 内联编辑：责任人与节点
  const [employees, setEmployees] = useState<string[]>([]);
  const [ownerDeptMap, setOwnerDeptMap] = useState<Record<string, string>>({});
  const [proposerDeptMap, setProposerDeptMap] = useState<Record<string, string>>({});
  const [departments, setDepartments] = useState<string[]>([]);
  const [editingOwner, setEditingOwner] = useState<string | null>(null);
  const [editingDue, setEditingDue] = useState<string | null>(null);
  const [editingDept, setEditingDept] = useState<string | null>(null);
  const [ownerDraft, setOwnerDraft] = useState('');
  const [dueDraft, setDueDraft] = useState('');
  const [deptDraft, setDeptDraft] = useState('');
  const [rdSubmitting, setRdSubmitting] = useState(false);
  const [wecomUsers, setWecomUsers] = useState<{ userid: string; name: string }[]>([]);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [resultItem, setResultItem] = useState<TrackItem | null>(null);
  const [resultForm, setResultForm] = useState({ text: '', status: 'done' });
  const [nextDueDate, setNextDueDate] = useState('');
  const [resultSubmitting, setResultSubmitting] = useState(false);
  const [resultImages, setResultImages] = useState<File[]>([]);
  const [settleMsg, setSettleMsg] = useState('');
  const [oaSyncing, setOaSyncing] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState('');
  const [currentUserLoginId, setCurrentUserLoginId] = useState('');
  const [currentUserDept, setCurrentUserDept] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.success) {
        const role = d.data.role || 'employee';
        setUserRole(role);
        setCurrentUserName(d.data.name || '');
        setCurrentUserLoginId(d.data.loginid || '');
        setCurrentUserDept(d.data.dept || '');
        if ((role === 'manager' || role === 'secretary') && d.data.dept) setFilterDept(d.data.dept);
      }
    }).catch(() => {});
    fetch('/api/org/employees').then(r => r.json()).then(d => {
      if (d.success) {
        setEmployees((d.data || []).map((e: any) => e.name).filter(Boolean));
        // 责任人 → 责任部门 映射
        fetch('/api/org/departments').then(r => r.json()).then(dd => {
          const deptMap = new Map<string, string>((dd.data || []).map((x: any) => [String(x.id), String(x.name || '')]));
          const om: Record<string, string> = {};
          const pm: Record<string, string> = {};
          (d.data || []).forEach((e: any) => {
            const deptName = deptMap.get(String(e.departmentId || '')) || '';
            if (e.name) {
              om[e.name] = deptName;
              pm[e.name] = deptName;
            }
          });
          setOwnerDeptMap(om);
          setProposerDeptMap(pm);
          setDepartments((dd.data || []).filter((x: any) => x.status !== 'inactive').map((x: any) => x.name));
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const openResult = (item: TrackItem) => {
    setResultItem(item);
    setResultForm({
      // 预填过滤导入元数据（{"y":..,"w":..,"d":..}），避免混入新一轮汇报
      text: getDisplayOaResult(item.oa_result),
      status: item.status === 'done' ? 'done' : 'blocked',
    });
    setNextDueDate('');
    setResultImages([]);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/actions');
      const d = await r.json();
      if (d.success) setItems(d.data || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  // 内联修改责任人 / 节点
  const saveOwner = async (id: string, owner: string) => {
    await fetch(`/api/actions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: owner || null }),
    }).catch(() => {});
    load();
  };
  const saveDue = async (id: string, due: string) => {
    await fetch(`/api/actions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date: due || null, due_date_type: 'date' }),
    }).catch(() => {});
    load();
  };
  const saveDept = async (id: string, dept: string) => {
    await fetch(`/api/actions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dept: dept || null }),
    }).catch(() => {});
    load();
  };

  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const importExcel = async (file: File) => {
    let headerRow: string[] = [];
    const findCol = (names: string[]): number => {
      for (const name of names) {
        const idx = headerRow.findIndex(h => h.includes(name) || name.includes(h));
        if (idx !== -1) return idx;
      }
      return -1;
    };
    const fmtDate = (v: any): string => {
      if (typeof v === 'number' && v > 10000) {
        const d = new Date((v - 25569) * 86400 * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      return String(v || '').trim();
    };
    // 节点列分类：仅「持续」→ 持续项；标准日期 → date；其余文本（每天/待沟通/XX回复等）→ tbd
    const classifyNode = (v: string): 'continuous' | 'date' | 'tbd' => {
      const s = (v || '').trim();
      if (!s) return 'tbd';
      if (s === '持续') return 'continuous';
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
      return 'tbd';
    };
    const toScore = (v: any): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const s = String(v).trim().toUpperCase();
      if (s === 'V') return 1;
      if (s === 'X') return -1;
      if (s === '0' || s === 'O') return 0;
      return null;
    };

    let rows: any[] = [];
    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      const lines = text.split('\n').filter(Boolean);
      if (lines.length < 2) { alert('CSV 文件为空或格式不正确'); return; }
      headerRow = lines[0].split(',').map(s => s.replace(/^"|"$/g, '').trim());
      const descIdx = findCol(['提议内容', '任务描述', '内容']);
      const ownerIdx = findCol(['责任人', '负责人', 'owner']);
      const proposerIdx = findCol(['提出人', '提议人']);
      const auditIdx = findCol(['稽核']);
      const meetingDateIdx = findCol(['日期', '时间']);
      const dueDateIdx = findCol(['节点']);
      const yearIdx = findCol(['年份']);
      const weekIdx = findCol(['周序', '周次', '周']);
      const categoryIdx = findCol(['类别', '分类']);
      if (descIdx === -1) { alert('未找到"提议内容"列'); return; }
      rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
        return {
          description: cols[descIdx] || '', owner: ownerIdx >= 0 ? cols[ownerIdx] : '',
          proposer: proposerIdx >= 0 ? cols[proposerIdx] : '', score: auditIdx >= 0 ? toScore(cols[auditIdx]) : null,
          meetingDate: meetingDateIdx >= 0 ? fmtDate(cols[meetingDateIdx]) : '',
          dueDate: dueDateIdx >= 0 ? fmtDate(cols[dueDateIdx]) : '',
          year: yearIdx >= 0 ? cols[yearIdx] : '', week: weekIdx >= 0 ? cols[weekIdx] : '',
          category: categoryIdx >= 0 ? cols[categoryIdx] : '',
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
      const auditIdx = findCol(['稽核']);
      const meetingDateIdx = findCol(['日期', '时间']);
      const dueDateIdx = findCol(['节点']);
      const yearIdx = findCol(['年份']);
      const weekIdx = findCol(['周序', '周次', '周']);
      const categoryIdx = findCol(['类别', '分类']);
      if (descIdx === -1) { alert('未找到"提议内容"列'); return; }
      rows = json.slice(1).map((row: any[]) => ({
        description: String(row[descIdx] || '').trim(),
        owner: ownerIdx >= 0 ? String(row[ownerIdx] || '').trim() : '',
        proposer: proposerIdx >= 0 ? String(row[proposerIdx] || '').trim() : '',
        score: auditIdx >= 0 ? toScore(row[auditIdx]) : null,
        meetingDate: meetingDateIdx >= 0 ? fmtDate(row[meetingDateIdx]) : '',
        dueDate: dueDateIdx >= 0 ? fmtDate(row[dueDateIdx]) : '',
        year: yearIdx >= 0 ? String(row[yearIdx] || '').trim() : '',
        week: weekIdx >= 0 ? String(row[weekIdx] || '').trim() : '',
        category: categoryIdx >= 0 ? String(row[categoryIdx] || '').trim() : '',
      })).filter(r => r.description.trim());
    } else {
      alert('仅支持 .csv / .xlsx / .xls 格式');
      return;
    }

    if (rows.length === 0) { alert('未读取到有效数据'); return; }
    if (!confirm(`确认导入 ${rows.length} 条行动项到台账？`)) return;

    setImporting(true);
    try {
      const res = await fetch('/api/actions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `导入_周例会_${new Date().toISOString().slice(0, 10)}`,
          sourceChannel: 'other',
          items: rows.map(r => ({
            description: r.description,
            owner: r.owner,
            proposer: r.proposer,
            oaScore: r.score,
            category: r.category,
            dueDate: classifyNode(r.dueDate) === 'date' ? r.dueDate : null,
            dueDateType: classifyNode(r.dueDate),
            priority: 'medium',
            meetingDate: r.meetingDate,
            year: r.year, week: r.week,
          })),
        }),
      }).then(r => r.json());
      if (res.success) {
        alert(`导入成功：${rows.length} 条行动项`);
        load();
      } else {
        alert(res.error || '导入失败');
      }
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (userRole === null) return; // 等待角色加载完成
    // 先立即加载台账，不等待 OA 同步
    load();
    if (userRole === 'admin' || userRole === 'manager') {
      // 后台并行拉取 OA 完成结果，同步有更新时再刷新
      fetch('/api/oa/pull-results', { method: 'POST' })
        .then(r => r.json())
        .then(r => { if (r.success && r.data?.synced > 0) load(); })
        .catch(() => { /* OA未连接时静默忽略 */ });
    }
  }, [userRole, load]);

  const allYears = [...new Set(items.map(i => i.meeting_date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const allDepts = [...new Set(items.map(i => i.dept).filter(Boolean))].sort() as string[];
  const allTypes = [...new Set(items.map(i => i.meeting_type).filter(Boolean))].sort() as string[];
  const allProposers = [...new Set(items.map(i => i.proposer).filter(Boolean))].sort() as string[];
  const allOwners = [...new Set(items.map(i => i.owner).filter(Boolean))].sort() as string[];

  const filtered = items.filter(i => {
    // 持续项不显示在行动项台账（另有「持续项跟进」页面）
    if (i.due_date_type === 'continuous') return false;
    // 员工仅看自己负责的行动项
    if (userRole === 'employee') {
      if (i.owner !== currentUserName && i.owner !== currentUserLoginId) return false;
    }
    if (search && !i.description.toLowerCase().includes(search.toLowerCase()) &&
        !i.owner?.toLowerCase().includes(search.toLowerCase()) &&
        !i.meeting_title?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterYear.length && !filterYear.includes(i.meeting_date?.slice(0, 4) ?? '')) return false;
    if (filterDept.length && !filterDept.includes(i.dept ?? '')) return false;
    if (filterType.length && !filterType.includes(i.meeting_type ?? '')) return false;
    if (filterProposer.length && !filterProposer.includes(i.proposer ?? '')) return false;
    if (filterOwner.length && !filterOwner.includes(i.owner ?? '')) return false;
    if (filterDue.length) {
      const d = i.due_date_type;
      const hasDue = !!i.due_date && d !== 'tbd' && d !== 'continuous';
      const isOverdue = !!i.due_date && (d === 'date' || !d) && i.status !== 'done' && i.status !== 'blocked'
        && i.oa_score === null && new Date(i.due_date) < new Date(new Date().toDateString());
      const ok = filterDue.some(x => {
        if (x === 'dated') return hasDue;
        if (x === 'overdue') return isOverdue;
        if (x === 'tbd') return d === 'tbd';
        if (x === 'none') return !i.due_date && d !== 'tbd' && d !== 'continuous';
        return false;
      });
      if (!ok) return false;
    }
    if (filterStatus.length) {
      const ok = filterStatus.some(st => displayStatus(i) === st);
      if (!ok) return false;
    }
    if (filterResult && !i.oa_result) return false;
    if (filterScore.length) {
      const es = effectiveScore(i);
      const ok = filterScore.some(s => {
        if (s === 'V') return es === 1;
        if (s === 'X') return es === -1;
        if (s === '0') return es === 0;
        if (s === 'pending') return es === null;
        return false;
      });
      if (!ok) return false;
    }

    // 日期范围筛选
    if (dateRange !== 'all' && i.meeting_date) {
      const itemDate = new Date(i.meeting_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let startDate: Date;
      let endDate: Date;

      if (dateRange === 'this_month') {
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      } else if (dateRange === 'last_month') {
        startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        endDate = new Date(today.getFullYear(), today.getMonth(), 0);
      } else if (dateRange === 'this_quarter') {
        const quarter = Math.floor(today.getMonth() / 3);
        startDate = new Date(today.getFullYear(), quarter * 3, 1);
        endDate = new Date(today.getFullYear(), quarter * 3 + 3, 0);
      } else {
        return true;
      }

      if (itemDate < startDate || itemDate > endDate) return false;
    }

    // 自定义日期范围
    if (customDateStart && i.meeting_date && new Date(i.meeting_date) < new Date(customDateStart)) return false;
    if (customDateEnd && i.meeting_date && new Date(i.meeting_date) > new Date(customDateEnd)) return false;

    return true;
  });

  // 搜索/筛选条件变化（全量显示，无需重置分页）

  const sorted = [...filtered].sort((a, b) => {
    let diff = 0;
    if (sortKey === 'week') {
      const wa = getISOWeek(a.meeting_date);
      const wb = getISOWeek(b.meeting_date);
      diff = wa.year !== wb.year ? wa.year - wb.year : wa.week - wb.week;
    } else if (sortKey === 'due_date') {
      diff = (a.due_date || '').localeCompare(b.due_date || '');
    } else if (sortKey === 'score') {
      diff = (a.oa_score ?? -99) - (b.oa_score ?? -99);
    }
    return sortAsc ? diff : -diff;
  });

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  // 统计（基于过滤后数据，员工只看自己的）
  const totalScore = filtered.reduce((s, i) => s + (i.oa_score ?? 0), 0);
  const pendingCount = filtered.filter(i => displayStatus(i) === 'pending').length;
  const inProgressCount = filtered.filter(i => displayStatus(i) === 'in_progress').length;
  const blockedCount = filtered.filter(i => displayStatus(i) === 'blocked').length;
  const doneCount = filtered.filter(i => displayStatus(i) === 'done').length;
  const cancelledCount = filtered.filter(i => displayStatus(i) === 'cancelled').length;
  const withResult = filtered.filter(i => i.oa_result).length;

  const SortIcon = ({ k }: { k: typeof sortKey }) => (
    sortKey === k
      ? (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
      : <ChevronDown className="w-3 h-3 text-slate-300" />
  );

  // CSV 导出
  const exportCSV = () => {
    const header = ['年份', '周', '部门', '类别', '日期', '提出人', '提议内容', '节点(截止日)', '责任人', '稽核', '评分', 'OA回传内容', '状态'];
    const rows = sorted.map(i => {
      const { year, week } = getISOWeek(i.meeting_date);
      const scoreLabel = i.oa_score === 1 ? 'V' : i.oa_score === -1 ? 'X' : i.oa_score === 0 ? '0' : '';
      const proposer = i.proposer || '';
      return [
        year, week, i.dept || '', i.meeting_type || '', formatDate(i.meeting_date),
        proposer, `"${(i.description || '').replace(/"/g, '""')}"`,
        formatDate(i.due_date), i.owner || '', scoreLabel, i.oa_score ?? '',
        `"${(i.oa_result || '').replace(/"/g, '""')}"`, getActionDisplayLabel(i.status),
      ].join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `行动项台账_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (userRole === null) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* 视角提示 */}
      {userRole === 'employee' && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
          <User className="w-3.5 h-3.5 flex-shrink-0" />
          仅显示您（{currentUserName}）负责的行动项
        </div>
      )}
      {userRole === 'manager' && currentUserDept && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
          已默认筛选「{currentUserDept}」部门，可在下方更改
        </div>
      )}
      {/* 统计摘要 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: '总行动项', value: filtered.length, color: 'text-slate-800', key: 'all' },
          { label: '已处理', value: doneCount, color: 'text-emerald-600', icon: <CheckCircle2 className="w-4 h-4" />, key: 'done' },
          { label: '进行中', value: inProgressCount, color: 'text-blue-600', icon: <RefreshCw className="w-4 h-4" />, key: 'in_progress' },
          { label: '未完成', value: blockedCount, color: 'text-red-600', icon: <ShieldAlert className="w-4 h-4" />, key: 'blocked' },
          { label: '未处理', value: pendingCount, color: 'text-amber-600', icon: <Clock className="w-4 h-4" />, key: 'pending' },
          { label: '已回传', value: withResult, color: 'text-indigo-600', icon: <FileText className="w-4 h-4" />, key: 'result' },
          { label: '稽核积分', value: totalScore > 0 ? `+${totalScore}` : totalScore, color: totalScore > 0 ? 'text-emerald-600' : totalScore < 0 ? 'text-red-500' : 'text-slate-600', key: 'score' },
        ].map(s => {
          const clickable = s.key === 'pending' || s.key === 'in_progress' || s.key === 'blocked' || s.key === 'done' || s.key === 'result';
          const active = s.key === 'result'
            ? filterResult
            : (s.key === 'pending' || s.key === 'in_progress' || s.key === 'blocked' || s.key === 'done') && filterStatus.includes(s.key);
          return (
          <button
            key={s.label}
            disabled={!clickable}
            onClick={() => {
              if (s.key === 'result') {
                setFilterResult(prev => !prev);
                setFilterStatus([]);
              } else if (s.key === 'all') {
                setFilterStatus([]); setFilterScore([]); setFilterResult(false);
              } else {
                setFilterStatus(prev => prev.includes(s.key) ? prev.filter(x => x !== s.key) : [...prev, s.key]);
                setFilterScore([]);
                setFilterResult(false);
              }
            }}
            className={`bg-white rounded-xl border p-3 flex items-center gap-3 text-left transition-all ${clickable ? 'cursor-pointer hover:shadow-md hover:border-slate-300' : 'cursor-default'} ${
              active ? 'ring-2 ring-offset-1 ring-blue-400 border-blue-300' : 'border-slate-200'
            }`}
          >
            {s.icon && <span className={s.color}>{s.icon}</span>}
            <div>
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-[11px] text-slate-400">{s.label}</div>
            </div>
          </button>
          );
        })}
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input placeholder="搜索内容/负责人/会议..." value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className="pl-8 h-8 w-48 text-xs" />
        </div>
        <select value={dateRange} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDateRange(e.target.value as any)}
          className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600">
          <option value="all">全部时间</option>
          <option value="this_month">本月</option>
          <option value="last_month">上月</option>
          <option value="this_quarter">本季度</option>
        </select>
        <input
          type="date"
          value={customDateStart}
          onChange={(e) => setCustomDateStart(e.target.value)}
          className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600"
          placeholder="开始日期"
        />
        <input
          type="date"
          value={customDateEnd}
          onChange={(e) => setCustomDateEnd(e.target.value)}
          className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600"
          placeholder="结束日期"
        />
        <button
          onClick={() => {
            setFilterYear([]); setFilterDept([]); setFilterType([]); setFilterProposer([]);
            setFilterOwner([]); setFilterDue([]); setFilterStatus([]); setFilterScore([]); setFilterResult(false);
            setDateRange('all'); setCustomDateStart(''); setCustomDateEnd(''); setSearch('');
          }}
          className="h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-500 flex items-center gap-1.5"
          title="清除所有列筛选"
        >
          <X className="w-3.5 h-3.5" /> 清除筛选
        </button>
        <div className="flex-1" />
        <input ref={importFileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) importExcel(f); e.target.value = ''; }} />
        <button
          onClick={() => importFileRef.current?.click()}
          disabled={importing}
          className="h-8 px-3 text-xs border border-blue-200 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center gap-1.5 disabled:opacity-50"
          title="从 Excel/CSV 导入行动项（含稽核评分 V/X/0）"
        >
          <Upload className={`w-3.5 h-3.5 ${importing ? 'animate-pulse' : ''}`} /> {importing ? '导入中...' : '导入Excel/CSV'}
        </button>
        <button onClick={load} className="h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-600 flex items-center gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
        <Link href="/weekly-board" title="进入周例会看板演示" className="h-8 px-3 text-xs border border-indigo-200 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1.5 font-medium">
          <Presentation className="w-3.5 h-3.5" /> 演示
        </Link>
        {userRole === 'admin' && (
          <button
            disabled={oaSyncing}
            onClick={async () => {
              setOaSyncing(true);
              try {
                const r = await fetch('/api/oa/pull-results', { method: 'POST' }).then(r => r.json());
                if (r.success) { setSettleMsg(r.data.message || '同步完成'); load(); setTimeout(() => setSettleMsg(''), 4000); }
                else setSettleMsg(`同步失败: ${r.error}`);
              } catch { setSettleMsg('同步失败，请检查OA连接'); }
              finally { setOaSyncing(false); }
            }}
            className="h-8 px-3 text-xs border border-blue-200 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center gap-1.5 disabled:opacity-50"
            title="从泛微OA拉取完成结果说明（wcjgsm/wcqkfj）同步回台账"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${oaSyncing ? 'animate-spin' : ''}`} /> 同步OA结果
          </button>
        )}
        {userRole === 'admin' && (
          <button
            onClick={async () => {
              const r = await fetch('/api/actions/settle', { method: 'POST' }).then(r => r.json());
              if (r.success) { setSettleMsg(`已结算 ${r.data.settled} 条超期未回传项`); load(); setTimeout(() => setSettleMsg(''), 4000); }
            }}
            className="h-8 px-3 text-xs border border-amber-200 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 flex items-center gap-1.5"
            title="将超期且无OA回传的行动项自动写入 -1 分"
          >
            <Calculator className="w-3.5 h-3.5" /> 结算超期
          </button>
        )}
        <button onClick={exportCSV} className="h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-600 flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> 导出CSV
        </button>
        <button
          onClick={async () => {
            if (!currentUserLoginId) {
              alert('未获取到您的 OA 账号，无法推送。');
              return;
            }
            setSettleMsg('正在尝试推送待办到 IM...');
            try {
              const res = await fetch('/api/chat/send-todo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  oaUserId: currentUserLoginId,
                  owner: currentUserName,
                  ownerLoginId: currentUserLoginId,
                  format: 'card'
                })
              });
              const d = await res.json();
              if (d.success) {
                setSettleMsg('✅ 待办已推送到您的 IM');
              } else {
                setSettleMsg(`❌ 推送失败: ${d.error || '接口异常'}`);
              }
            } catch (e) {
              setSettleMsg('❌ 推送请求发生错误');
            }
            setTimeout(() => setSettleMsg(''), 4000);
          }}
          className="h-8 px-3 text-xs border border-indigo-200 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 flex items-center gap-1.5"
          title="将您个人的待办清单推送到 IM 自研对话系统进行验证"
        >
          <Sparkles className="w-3.5 h-3.5" /> 测试 IM 推送
        </button>
        {settleMsg && (
          <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />{settleMsg}
          </span>
        )}
      </div>

      {/* 台账表格 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap cursor-pointer select-none"
                  onClick={() => toggleSort('week')}>
                  <FilterMenu title="年份/周" values={allYears} selected={filterYear} onChange={setFilterYear}
                    suffix={<SortIcon k="week" />} render={(v) => `${v}年`} />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                  <FilterMenu title="提出部门" values={allDepts} selected={filterDept} onChange={setFilterDept} />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                  <FilterMenu title="类别" values={allTypes} selected={filterType} onChange={setFilterType} />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap cursor-pointer select-none"
                  onClick={() => toggleSort('due_date')}>
                  <span className="flex items-center gap-1">日期 <SortIcon k="due_date" /></span>
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                  <FilterMenu title="提出人" values={allProposers} selected={filterProposer} onChange={setFilterProposer} />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[200px]">提议内容</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                  <FilterMenu title="节点" values={['dated', 'overdue', 'tbd', 'none']} selected={filterDue} onChange={setFilterDue}
                    render={(v) => (({ dated: '有节点（已排期）', overdue: '已逾期', tbd: '待定', none: '无节点' } as Record<string, string>)[v])} />
                </th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">责任部门</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                  <FilterMenu title="责任人" values={allOwners} selected={filterOwner} onChange={setFilterOwner} />
                </th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">
                  <FilterMenu title="状态" values={['pending', 'in_progress', 'blocked', 'done', 'cancelled']}
                    selected={filterStatus} onChange={setFilterStatus}
                    render={(v) => (({ pending: '未处理', in_progress: '进行中', blocked: '未完成', done: '已处理', cancelled: '已取消' } as Record<string, string>)[v])} />
                </th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap cursor-pointer select-none"
                  onClick={() => toggleSort('score')}>
                  <FilterMenu title="稽核" values={['V', 'X', '0', 'pending']} selected={filterScore} onChange={setFilterScore}
                    suffix={<SortIcon k="score" />}
                    render={(v) => (({ V: 'V（+1）', X: 'X（-1）', '0': '0（待定）', pending: '未回传' } as Record<string, string>)[v])} />
                </th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">评分</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600 min-w-[160px]">OA回传内容</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={14} className="text-center py-12 text-slate-400">加载中...</td></tr>
              )}
              {!loading && sorted.length === 0 && (
                <tr><td colSpan={14} className="text-center py-12 text-slate-400">暂无数据</td></tr>
              )}
              {sorted.map((item, i) => {
                const { year, week } = getISOWeek(item.meeting_date);
                const isOverdue = item.due_date && (item.due_date_type || 'date') === 'date' && item.status !== 'done' && item.status !== 'blocked'
                  && item.oa_score === null
                  && new Date(item.due_date) < new Date(new Date().toDateString());
                const isExpanded = expandedResult === item.id;

                return (
                  <tr key={item.id} className={`border-b border-slate-100 transition-colors ${
                    i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'
                  } hover:bg-blue-50/30`}>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-medium"
                      title={`W${String(week).padStart(2,'0')} = 第${week}周，按会议日期（${formatDate(item.meeting_date)}）计算`}>
                      {year}年 W{String(week).padStart(2, '0')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{item.proposer_dept || proposerDeptMap[item.proposer || ''] || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {item.meeting_type ? (
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[11px]">{item.meeting_type}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDate(item.meeting_date)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{item.proposer || <span className="text-slate-300">待补充</span>}</td>
                    <td className="px-4 py-3 text-slate-800 max-w-[280px]">
                      <div className="line-clamp-2" title={item.description}>{item.description}</div>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-slate-400 truncate">📋 {item.meeting_title || '独立任务'}</span>
                        {item.meeting_id ? (
                        <Link href={`/meeting/${item.meeting_id}`} target="_blank"
                          className="text-[10px] text-blue-400 hover:text-blue-600 flex items-center gap-0.5 shrink-0">
                          <ExternalLink className="w-2.5 h-2.5" /> 查看
                        </Link>
                        ) : null}
                        {item.reassigned_from && (
                          <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                            title={`转派自原 X 项：${items.find(i => i.id === item.reassigned_from)?.description || ''}`}>
                            <ArrowUpRight className="w-2.5 h-2.5" /> 转派自原X项
                          </span>
                        )}
                        {item.reassigned_to && (
                          <span className="text-[10px] text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                            title="该 X 项已重新派发为新任务">
                            <ArrowUpRight className="w-2.5 h-2.5" /> 已重新派发
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`px-4 py-3 whitespace-nowrap font-medium ${isOverdue ? 'text-red-600' : 'text-slate-600'}`}>
                      {editingDue === item.id ? (
                        <input type="date" autoFocus value={dueDraft}
                          onChange={(e) => setDueDraft(e.target.value)}
                          onBlur={() => { saveDue(item.id, dueDraft); setEditingDue(null); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { saveDue(item.id, dueDraft); setEditingDue(null); }
                            if (e.key === 'Escape') setEditingDue(null);
                          }}
                          className="h-6 text-xs border border-blue-300 rounded px-1" />
                      ) : (
                        <button
                          onClick={() => { setEditingDue(item.id); setDueDraft(item.due_date || ''); }}
                          className="hover:text-blue-600 hover:underline"
                          title="点击修改节点（截止日期）"
                        >
                          {item.due_date_type === 'continuous' ? <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[11px]">持续</span>
                           : item.due_date_type === 'tbd' ? <span className="text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded text-[11px]">待定</span>
                           : formatMonthDay(item.due_date) || '—'}
                          {isOverdue && (item.due_date_type || 'date') === 'date' && <AlertTriangle className="w-3 h-3 inline ml-1 text-red-500" />}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      {editingDept === item.id ? (
                        <DeptSelect
                          value={deptDraft}
                          onChange={setDeptDraft}
                          options={departments}
                          onBlur={(val) => { saveDept(item.id, val); setEditingDept(null); }}
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingDept(item.id); setDeptDraft(item.dept || ownerDeptMap[item.owner || ''] || ''); }}
                          className="text-slate-500 hover:text-blue-600 hover:underline"
                          title="点击修改责任部门"
                        >{item.dept || ownerDeptMap[item.owner || ''] || '—'}</button>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                      {editingOwner === item.id ? (
                        <InlineOwnerPicker
                          employees={employees}
                          initial={item.owner || ''}
                          onSave={(name) => { saveOwner(item.id, name); setEditingOwner(null); }}
                          onCancel={() => setEditingOwner(null)}
                        />
                      ) : (
                        <button
                          onClick={() => { setEditingOwner(item.id); setOwnerDraft(item.owner || ''); }}
                          className="hover:text-blue-600 hover:underline"
                          title="点击修改责任人"
                        >{item.owner || <span className="text-slate-300">—</span>}</button>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center whitespace-nowrap"><StatusTag status={item.status} score={effectiveScore(item)} /></td>
                    <td className="px-4 py-3 text-center">
                      <ScoreBadge score={effectiveScore(item)} auto={item.oa_score === null && effectiveScore(item) === -1} />
                    </td>
                    <td className="px-4 py-3 text-center text-sm font-bold">
                      {effectiveScore(item) === 1 ? (
                        <span className="text-emerald-600">+1</span>
                      ) : effectiveScore(item) === -1 ? (
                        <span className="text-red-500">-1{item.oa_score === null && <span className="text-[9px] ml-0.5 font-normal text-red-400">自动</span>}</span>
                      ) : effectiveScore(item) === 0 ? (
                        <span className="text-slate-400">0</span>
                      ) : (
                        <span className="text-slate-200">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {(() => {
                        const displayResult = getDisplayOaResult(item.oa_result);
                        return displayResult ? (
                          <div>
                            <div className={`text-[11px] ${isExpanded ? '' : 'line-clamp-2'}`}>
                              {displayResult}
                            </div>
                            {displayResult.length > 40 && (
                              <button onClick={() => setExpandedResult(isExpanded ? null : item.id)}
                                className="text-[10px] text-blue-500 hover:underline mt-0.5">
                                {isExpanded ? '收起' : '展开'}
                              </button>
                            )}
                            {item.oa_auto_detected && (
                              <span className="text-[10px] text-amber-500 ml-1">🤖自动判定</span>
                          )}
                          {item.oa_attachments && item.oa_attachments.length > 0 && (
                            <div className="mt-1.5 flex gap-1 flex-wrap">
                              {item.oa_attachments.map((url, i) => (
                                <button key={i} onClick={() => url && url !== 'null' && setPreviewUrl(url)}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors">
                                  <FileText className="w-3 h-3" /> 附件{i + 1}
                                </button>
                              ))}
                            </div>
                          )}
                          {item.oa_result_at && (
                            <div className="text-[10px] text-slate-300 mt-0.5">{formatDate(item.oa_result_at)}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300 text-[11px]">待回传</span>
                      );
                      })()}
                    </td>
                    {/* 操作列 */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {/* 人工稽核 V/X/0 — 仅 admin；打上标记后锁定，防误点 */}
                        {/* 已重派且原项打X的：完全锁定，不显示稽核按钮（防止误改回V/0） */}
                        {userRole === 'admin' && !(item.reassigned_to && item.oa_score === -1) && (() => {
                          const mark = item.oa_score;
                          const isLocked = mark !== null && mark !== undefined;
                          const audit = (val: number | null) => async () => {
                            const next = mark === val ? null : val; // 点当前选中=清除，点其他被禁用
                            const body: any = { oa_score: next, oa_auto_detected: false };
                            if (next !== null) body.status = next === -1 ? 'blocked' : 'done'; // V/0→done，X→blocked
                            setItems(prev => prev.map(p => p.id === item.id ? { ...p, oa_score: next, oa_auto_detected: false, status: next === null ? p.status : (next === -1 ? 'blocked' : 'done') } : p));
                            await fetch(`/api/actions/${item.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                          };
                          const btnCls = (active: boolean, color: string, activeBg: string) =>
                            `w-6 h-6 rounded-full border text-[11px] font-bold flex items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-current disabled:hover:border-current ${
                              active ? activeBg : `bg-white ${color} ${isLocked ? '' : 'hover:bg-opacity-10'}`
                            }`;
                          return (<>
                          <button
                            title={mark === 1 ? '已标记完成（+1），点击清除' : (isLocked ? '已稽核锁定，先清除当前标记' : '人工稽核：标记完成（+1）')}
                            disabled={isLocked && mark !== 1}
                            onClick={audit(1)}
                            className={btnCls(mark === 1, 'text-emerald-600 border-emerald-300 hover:bg-emerald-50', 'bg-emerald-500 text-white border-emerald-500')}
                          >V</button>
                          <button
                            title={mark === -1 ? '已标记未完成（-1），点击清除' : (isLocked ? '已稽核锁定，先清除当前标记' : '人工稽核：标记未完成（-1）')}
                            disabled={isLocked && mark !== -1}
                            onClick={audit(-1)}
                            className={btnCls(mark === -1, 'text-red-500 border-red-300 hover:bg-red-50', 'bg-red-500 text-white border-red-500')}
                          >✕</button>
                          <button
                            title={mark === 0 ? '已标记待定（0），点击清除' : (isLocked ? '已稽核锁定，先清除当前标记' : '人工稽核：标记待定（0）')}
                            disabled={isLocked && mark !== 0}
                            onClick={audit(0)}
                            className={btnCls(mark === 0, 'text-slate-500 border-slate-300 hover:bg-slate-50', 'bg-slate-500 text-white border-slate-500')}
                          >0</button>
                          </>);
                        })()}
                        {/* 填写结果 — 仅 admin */}
                        {userRole === 'admin' && (
                        <button
                          title="填写 / 修改处理结果"
                          onClick={() => openResult(item)}
                          className="ml-1 px-1.5 py-0.5 text-[10px] border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                        >汇报</button>
                        )}
                        {/* 重新派发（X 时可用，仅 admin；已重派过的不再显示） */}
                        {userRole === 'admin' && effectiveScore(item) === -1 && !item.reassigned_to && (
                          <button
                            title="复制并重新派发任务"
                            onClick={() => {
                              setRedelegateItem(item);
                              setRdForm({ description: item.description, owner: item.owner || '', proposer: item.proposer || '', due_date: '' });
                              setOwnerSearch('');
                              if (wecomUsers.length === 0) {
                                fetch('/api/wecom/users').then(r => r.json()).then(d => {
                                  if (d.success) setWecomUsers(d.data || []);
                                }).catch(() => {});
                              }
                            }}
                            className="ml-1 px-1.5 py-0.5 text-[10px] border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded transition-colors"
                          >重新派发</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="bg-slate-50 border-t-2 border-slate-200">
                  <td colSpan={9} className="px-3 py-2 text-xs font-semibold text-slate-600">
                    共 {sorted.length} 条 &nbsp;
                    <span className="text-emerald-600">V: {sorted.filter(i => effectiveScore(i) === 1).length}</span>
                    &nbsp;&nbsp;
                    <span className="text-red-500">X: {sorted.filter(i => effectiveScore(i) === -1).length}
                      {sorted.filter(i => effectiveScore(i) === -1 && i.oa_score === null).length > 0 &&
                        <span className="text-red-400 font-normal">（含自动{sorted.filter(i => effectiveScore(i) === -1 && i.oa_score === null).length}条）</span>
                      }
                    </span>
                    &nbsp;&nbsp;
                    <span className="text-slate-400">待判定: {sorted.filter(i => effectiveScore(i) === null).length}</span>
                  </td>
                  <td className="px-3 py-2 text-center text-xs font-bold">
                    {(() => {
                      const s = sorted.reduce((acc, i) => acc + (effectiveScore(i) ?? 0), 0);
                      return <span className={s > 0 ? 'text-emerald-600' : s < 0 ? 'text-red-500' : 'text-slate-500'}>{s > 0 ? `+${s}` : s}</span>;
                    })()}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 重新派发弹窗 */}
      {redelegateItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] p-6 border border-slate-200">
            <h3 className="text-base font-semibold text-slate-800 mb-1">重新派发任务</h3>
            <p className="text-xs text-slate-400 mb-4">原任务已标记为 ❌，复制一条新任务重新指派并设置截止日</p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">任务内容</label>
                <textarea
                  rows={3}
                  value={rdForm.description}
                  onChange={e => setRdForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">提出人</label>
                <input
                  type="text"
                  value={rdForm.proposer}
                  onChange={e => setRdForm(f => ({ ...f, proposer: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="提出人姓名"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">责任人</label>
                {wecomUsers.length > 0 ? (
                  <div className="relative">
                    <input
                      type="text"
                      value={ownerSearch || rdForm.owner}
                      onChange={e => { setOwnerSearch(e.target.value); setRdForm(f => ({ ...f, owner: e.target.value })); }}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                      placeholder="搜索姓名..."
                    />
                    {ownerSearch && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {wecomUsers
                          .filter(u => u.name.includes(ownerSearch))
                          .slice(0, 15)
                          .map(u => (
                            <button key={u.userid} type="button"
                              onClick={() => { setRdForm(f => ({ ...f, owner: u.name })); setOwnerSearch(''); }}
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 text-slate-700">
                              {u.name}
                            </button>
                          ))}
                        {wecomUsers.filter(u => u.name.includes(ownerSearch)).length === 0 && (
                          <div className="px-3 py-2 text-xs text-slate-400">未找到匹配人员</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={rdForm.owner}
                    onChange={e => setRdForm(f => ({ ...f, owner: e.target.value }))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    placeholder="输入责任人姓名"
                  />
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">新截止日期</label>
                <input
                  type="date"
                  value={rdForm.due_date}
                  onChange={e => setRdForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <div className="flex gap-2 mt-1.5">
                  {[7, 14, 30].map(d => {
                    const dt = new Date(); dt.setDate(dt.getDate() + d);
                    const val = dt.toISOString().slice(0, 10);
                    return (
                      <button key={d} onClick={() => setRdForm(f => ({ ...f, due_date: val }))}
                        className="text-[11px] px-2 py-0.5 border border-slate-200 rounded bg-slate-50 hover:bg-slate-100 text-slate-600">
                        +{d}天
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setRedelegateItem(null)}
                className="flex-1 h-9 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                取消
              </button>
              <button
                disabled={rdSubmitting || !rdForm.description.trim() || !rdForm.due_date}
                onClick={async () => {
                  setRdSubmitting(true);
                  try {
                    let oa: any = null;
                    if (redelegateItem?.meeting_id) {
                      // 会议行动项：走会议 PATCH addActionItem
                      const res = await fetch(`/api/meetings/${redelegateItem.meeting_id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          addActionItem: {
                            description: rdForm.description,
                            owner: rdForm.owner,
                            proposer: rdForm.proposer || null,
                            due_date: rdForm.due_date,
                            due_date_type: 'date',
                            status: 'pending',
                            priority: redelegateItem.priority || 'medium',
                            confidence_owner: 1,
                            confidence_date: 1,
                            reassigned_from: redelegateItem.id,
                            source_sentence: `[重新派发自 ${redelegateItem.id}] ${redelegateItem.description}`,
                          }
                        }),
                      });
                      if (res.ok) {
                        const r = await res.json();
                        oa = r.oaPush;
                      }
                    } else {
                      // 独立任务（无会议）：创建新的独立行动项，保留原类别
                      const res = await fetch('/api/actions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          description: rdForm.description,
                          owner: rdForm.owner,
                          proposer: rdForm.proposer || null,
                          due_date: rdForm.due_date,
                          due_date_type: 'date',
                          priority: redelegateItem.priority || 'medium',
                          sourceText: redelegateItem.meeting_type || '手动任务',
                          reassigned_from: redelegateItem.id,
                          from_reassign: true,
                        }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        alert(err.error || '派发失败');
                        return;
                      }
                      const r = await res.json();
                      oa = r.oaPush || null;
                    }
                    if (oa?.failed > 0) {
                      alert(`任务已派发，但OA同步失败：${oa.errors[0] || '未知错误'}`);
                    }
                    setRedelegateItem(null);
                    load();
                  } finally { setRdSubmitting(false); }
                }}
                className="flex-1 h-9 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rdSubmitting ? '派发中...' : '确认派发'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 填写结果弹窗 */}
      {resultItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setResultItem(null); }}>
          <div className="bg-white w-full sm:w-[540px] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">

            {/* 顶部渐变横条 */}
            <div className={`h-1.5 w-full ${resultForm.status === 'done' ? 'bg-gradient-to-r from-emerald-400 to-green-500' : resultForm.status === 'blocked' ? 'bg-gradient-to-r from-red-400 to-rose-500' : 'bg-gradient-to-r from-blue-400 to-indigo-500'}`} />

            {/* 标题栏 */}
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">汇报进展</h2>
                <p className="text-xs text-slate-400 mt-0.5">填写后自动同步到台账评分</p>
              </div>
              <button onClick={() => setResultItem(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 任务卡片 */}
            <div className="mx-6 mb-4 p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">待处理任务</div>
                <div className="text-xs text-slate-700 leading-relaxed line-clamp-2">{resultItem.description}</div>
                {resultItem.owner && <div className="text-[10px] text-slate-400 mt-1">负责人：{resultItem.owner}</div>}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-2">
              {/* 状态卡片选择 */}
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2.5">处理结果</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'done', label: '已完成', emoji: '✅', bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', activeBg: 'bg-emerald-500', activeText: 'text-white' },
                    { value: 'blocked', label: '未完成', emoji: '🚫', bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', activeBg: 'bg-red-500', activeText: 'text-white' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setResultForm(f => ({ ...f, status: opt.value }))}
                      className={`py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                        resultForm.status === opt.value
                          ? `${opt.activeBg} border-transparent ${opt.activeText} shadow-md scale-[1.02]`
                          : `${opt.bg} ${opt.border} ${opt.text} hover:scale-[1.01]`
                      }`}
                    >
                      <span className="text-lg">{opt.emoji}</span>
                      <span className="text-xs font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 下次完成时间（未完成时） */}
              {resultForm.status === 'blocked' && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-2.5">下次完成时间 <span className="text-red-400">*</span></div>
                  <input
                    type="date"
                    value={nextDueDate}
                    onChange={e => setNextDueDate(e.target.value)}
                    className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">选择后系统将自动生成一条带新截止时间的新任务</p>
                </div>
              )}

              {/* 处理说明 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-slate-500">处理说明 <span className="text-red-400">*</span></div>
                  <div className="text-[10px] text-slate-300">{resultForm.text.length}/500</div>
                </div>
                <textarea
                  rows={4}
                  value={resultForm.text}
                  onChange={e => setResultForm(f => ({ ...f, text: e.target.value.slice(0, 500) }))}
                  autoFocus
                  className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 resize-none placeholder:text-slate-300 transition-all"
                  placeholder={resultForm.status === 'done' ? '描述完成情况、成果...' : resultForm.status === 'blocked' ? '说明未完成原因、需要的支持...' : '描述当前进展、下一步计划...'}
                />
              </div>

              {/* 图片上传 */}
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">图片附件 <span className="text-red-400">*</span> <span className="text-slate-300 font-normal">（截图、证明材料等，至少上传 1 张）</span></div>
                <div
                  className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer group"
                  onClick={() => document.getElementById('result-img-upload')?.click()}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={e => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                    setResultImages(prev => [...prev, ...files]);
                  }}
                >
                  <input id="result-img-upload" type="file" accept="image/*" multiple className="hidden"
                    onChange={e => { setResultImages(prev => [...prev, ...Array.from(e.target.files || [])]); }} />
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
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex"
                        ><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                    <div
                      className="aspect-square rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all"
                      onClick={() => document.getElementById('result-img-upload')?.click()}
                    >
                      <span className="text-slate-300 text-xl">+</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 mt-2">
              <button
                onClick={() => setResultItem(null)}
                className="px-5 h-10 border border-slate-200 text-slate-500 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
              >取消</button>
              <button
                onClick={async () => {
                  // 未完成必须填下次完成时间
                  if (resultForm.status === 'blocked' && !nextDueDate) {
                    alert('请选择下次完成时间');
                    return;
                  }
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
                      const formData = new FormData();
                      formData.append('file', file);
                      formData.append('type', 'image');
                      const r = await fetch('/api/upload', { method: 'POST', body: formData }).then(res => res.json());
                      if (r.success) imageUrls.push(r.url);
                    }
                    const res = await fetch(`/api/actions/${resultItem.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        oa_result: resultForm.text,
                        oa_result_at: new Date().toISOString(),
                        oa_score: resultForm.status === 'done' ? 1 : resultForm.status === 'blocked' ? -1 : undefined,
                        oa_auto_detected: false,
                        status: resultForm.status,
                        next_due_date: resultForm.status === 'blocked' ? nextDueDate : undefined,
                        oa_attachments: imageUrls,
                      }),
                    });
                    if (res.ok) { setResultItem(null); load(); }
                  } finally { setResultSubmitting(false); }
                }}
                disabled={resultSubmitting}
                className={`flex-1 h-10 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  resultForm.status === 'done' ? 'bg-emerald-500 hover:bg-emerald-600' :
                  resultForm.status === 'blocked' ? 'bg-red-500 hover:bg-red-600' :
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {resultSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> 提交中...
                  </span>
                ) : (
                  resultForm.status === 'done' ? '✅ 标记完成' :
                  resultForm.status === 'blocked' ? '🚫 标记未完成' : '🔄 更新进展'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 附件预览弹窗 */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setPreviewUrl(null)}>
          <button onClick={() => setPreviewUrl(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-colors z-10">
            <X className="w-5 h-5" />
          </button>
          <img src={previewUrl} alt="预览" className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}

    </DashboardLayout>
  );
}
