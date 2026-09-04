'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  AlertTriangle, User, Users, Calendar, Clock, CheckCircle2,
  Plus, GripVertical, ArrowRight, Search, Target, RefreshCw,
  FileText, Eye, Pencil, Ban, Paperclip, X, Save, ShieldAlert, LayoutGrid, ChevronDown, Sparkles, Trash2
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { ScreenshotCapture } from '@/components/ui/screenshot-capture';
import { getDisplayOaResult } from '@/lib/oa-result-display';
import { isGroupOwner } from '@/lib/group-owners';
import { useRouter, useSearchParams } from 'next/navigation';

interface KanbanCard {
  id: string;
  description: string;
  owner?: string | null;
  ownerLoginId?: string | null;
  due_date?: string | null;
  due_date_type?: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'candidate' | 'pending' | 'confirmed' | 'in_progress' | 'done' | 'blocked';
  confidence_owner: number;
  confidence_date: number;
  source_sentence?: string;
  initial_result?: string | null;
  meeting_title?: string;
  meeting_id?: string;
  meeting_type?: string;
  meeting_date?: string;
  meeting_created_at?: string | null;
  dept?: string | null;
  confirmed_by?: string;
  confirmed_at?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  completion_note?: string | null;
  evidence_files?: string[];
  block_reason?: string | null;
  blocked_by?: string | null;
  blocked_at?: string | null;
}

type ColumnKey = 'overdue' | 'unprocessed' | 'done' | 'verified';
type ViewMode = 'all' | 'my' | 'group';
type ViewType = 'board' | 'calendar';
type QuickDateFilter = 'all' | 'overdue' | 'today' | 'this_week' | 'high_priority';
type DatePreset = 'all' | 'this_month' | 'this_week' | 'today' | 'custom';

const COLUMNS: { key: ColumnKey; label: string; color: string; dot: string; bg: string }[] = [
  { key: 'overdue',     label: '逾期警告', color: 'text-red-600',    dot: 'bg-red-500',    bg: 'bg-red-50/60' },
  { key: 'unprocessed', label: '未处理', color: 'text-slate-600',   dot: 'bg-slate-400',   bg: 'bg-slate-50' },
  { key: 'done',        label: '已处理', color: 'text-emerald-600', dot: 'bg-emerald-500', bg: 'bg-emerald-50/60' },
];

const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};
const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_WEIGHT: Record<KanbanCard['priority'], number> = { high: 3, medium: 2, low: 1 };
const DEFAULT_COLLAPSED_CARD_COUNT = 5;

function ConfidenceDot({ value }: { value: number }) {
  const color = value >= 0.7 ? 'bg-emerald-500' : value >= 0.4 ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} title={`置信度 ${Math.round(value * 100)}%`} />;
}

function ConfidenceBadge({ value, label }: { value: number; label: string }) {
  const cls = value >= 0.7
    ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
    : value >= 0.4
      ? 'bg-amber-50 text-amber-600 border-amber-200'
      : 'bg-red-50 text-red-600 border-red-200';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border font-medium ${cls}`}>
      {value < 0.7 && <AlertTriangle className="w-2.5 h-2.5" />}
      {label} {Math.round(value * 100)}%
    </span>
  );
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentMonthPreset() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: formatDateInput(start), end: formatDateInput(end) };
}

function getTodayPreset() {
  const today = formatDateInput(new Date());
  return { start: today, end: today };
}

function getCurrentWeekPreset() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: formatDateInput(start), end: formatDateInput(end) };
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function CalendarView({ cards }: { cards: KanbanCard[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<string | null>(null); // 'YYYY-MM-DD'

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  // 构建当月日历格子
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // 按日期分组行动项
  const byDate = new Map<string, KanbanCard[]>();
  for (const c of cards) {
    if (!c.due_date) continue;
    const key = c.due_date.slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(c);
  }

  const toKey = (d: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const selectedItems = selected ? (byDate.get(selected) || []) : [];

  return (
    <div className="flex gap-4 flex-1 min-h-[320px]">
      {/* 日历主体 */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* 月份导航 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <button onClick={prevMonth} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">‹</button>
          <span className="text-sm font-semibold text-slate-800">{year} 年 {month + 1} 月</span>
          <button onClick={nextMonth} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">›</button>
        </div>

        {/* 星期头 */}
        <div className="grid grid-cols-7 border-b border-slate-100">
          {WEEKDAYS.map(w => (
            <div key={w} className="text-center text-[11px] font-medium text-slate-400 py-2">{w}</div>
          ))}
        </div>

        {/* 日期格子 */}
        <div className="grid grid-cols-7 flex-1">
          {cells.map((day, i) => {
            if (!day) return <div key={`e-${i}`} className="border-r border-b border-slate-50" />;
            const key = toKey(day);
            const items = byDate.get(key) || [];
            const isToday = key === todayKey;
            const isSelected = key === selected;

            // 统计超期/正常
            const overdueItems = items.filter(c => c.status !== 'done' && c.status !== 'blocked' && new Date(key) < today);
            const normalItems = items.filter(c => !overdueItems.includes(c) && c.status !== 'done');
            const doneItems = items.filter(c => c.status === 'done');

            return (
              <div
                key={key}
                onClick={() => setSelected(isSelected ? null : key)}
                className={`border-r border-b border-slate-100 p-1.5 cursor-pointer transition-colors min-h-[80px] ${
                  isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                  isToday ? 'bg-blue-600 text-white' : 'text-slate-600'
                }`}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {overdueItems.slice(0, 2).map(c => (
                    <div key={c.id} className="text-[10px] leading-tight px-1 py-0.5 rounded bg-red-100 text-red-700 truncate">
                      {c.description.slice(0, 10)}
                    </div>
                  ))}
                  {normalItems.slice(0, 2).map(c => (
                    <div key={c.id} className="text-[10px] leading-tight px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 truncate">
                      {c.description.slice(0, 10)}
                    </div>
                  ))}
                  {doneItems.slice(0, 1).map(c => (
                    <div key={c.id} className="text-[10px] leading-tight px-1 py-0.5 rounded bg-slate-100 text-slate-400 truncate">
                      {c.description.slice(0, 10)}
                    </div>
                  ))}
                  {items.length > 3 && (
                    <div className="text-[10px] text-slate-400 pl-1">+{items.length - 3} 项</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 图例 */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50">
          <span className="flex items-center gap-1 text-[11px] text-red-600"><span className="w-2.5 h-2.5 rounded bg-red-200 inline-block" /> 已超期</span>
          <span className="flex items-center gap-1 text-[11px] text-emerald-600"><span className="w-2.5 h-2.5 rounded bg-emerald-200 inline-block" /> 进行中</span>
          <span className="flex items-center gap-1 text-[11px] text-slate-400"><span className="w-2.5 h-2.5 rounded bg-slate-200 inline-block" /> 已完成</span>
        </div>
      </div>

      {/* 右侧：选中日的行动项 */}
      <div className="w-72 bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="text-sm font-semibold text-slate-800">
            {selected ? `${selected} 的任务` : '点击日期查看任务'}
          </div>
          {selected && <div className="text-xs text-slate-400 mt-0.5">{selectedItems.length} 条行动项</div>}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {!selected && (
            <div className="text-center text-slate-400 text-xs mt-8">选择一个日期</div>
          )}
          {selectedItems.length === 0 && selected && (
            <div className="text-center text-slate-400 text-xs mt-8">该日无行动项</div>
          )}
          {selectedItems.map(c => {
            const key = c.due_date?.slice(0, 10) || '';
            const isOverdue = c.status !== 'done' && c.status !== 'blocked' && new Date(key) < today;
            const isDone = c.status === 'done';
            return (
              <div key={c.id} className={`p-2.5 rounded-xl border text-xs ${
                isDone ? 'border-slate-200 bg-slate-50 opacity-60' :
                isOverdue ? 'border-red-200 bg-red-50' :
                'border-emerald-200 bg-emerald-50'
              }`}>
                <div className={`font-medium mb-1 ${isDone ? 'text-slate-400' : isOverdue ? 'text-red-800' : 'text-emerald-800'}`}>
                  {c.description}
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className={`${isOverdue ? 'text-red-500' : isDone ? 'text-slate-400' : 'text-emerald-600'}`}>
                    {c.owner || '未分配'}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded font-medium ${
                    c.status === 'done' ? 'bg-slate-200 text-slate-500' :
                    c.status === 'in_progress' ? 'bg-blue-100 text-blue-600' :
                    c.status === 'blocked' ? 'bg-red-100 text-red-600' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {c.status === 'done' ? '已完成' : c.status === 'in_progress' ? '进行中' : c.status === 'blocked' ? '未完成' : '待确认'}
                  </span>
                </div>
                {isOverdue && (
                  <div className="text-[10px] text-red-500 mt-1 font-medium">
                    ⚠ 已超期 {Math.floor((today.getTime() - new Date(key).getTime()) / 86400000)} 天
                  </div>
                )}
                {c.meeting_title && (
                  <div className="text-[10px] text-slate-400 mt-1 truncate">📋 {c.meeting_title}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 可搜索会议筛选下拉 ──
function MeetingFilterDropdown({ value, onChange, meetings }: {
  value: string;
  onChange: (id: string) => void;
  meetings: { id: string; title: string; date: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q ? meetings.filter(m => m.title.toLowerCase().includes(q)) : meetings;
    const byYear = new Map<string, typeof filtered>();
    for (const m of filtered) {
      const year = m.date.slice(0, 4) || '未知';
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year)!.push(m);
    }
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [meetings, search]);

  const selectedTitle = value ? meetings.find(m => m.id === value)?.title : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`h-9 text-xs border rounded-lg px-2.5 bg-white flex items-center gap-1.5 max-w-[160px] ${
          value ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-slate-200 text-slate-600'
        }`}
      >
        <FileText className="w-3 h-3 flex-shrink-0" />
        <span className="truncate max-w-[100px]">{selectedTitle || '全部会议'}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                className="w-full text-xs border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                placeholder="搜索会议名称…" />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              className={`w-full text-left text-xs px-3 py-2 hover:bg-slate-50 ${!value ? 'text-blue-600 font-medium bg-blue-50/60' : 'text-slate-600'}`}>
              全部会议
            </button>
            {grouped.map(([year, items]) => (
              <div key={year}>
                <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 bg-slate-50 border-y border-slate-100 tracking-wide">
                  {year}年 · {items.length} 场
                </div>
                {items.map(m => (
                  <button key={m.id} onClick={() => { onChange(m.id); setOpen(false); setSearch(''); }}
                    className={`w-full text-left text-xs px-3 py-2 hover:bg-blue-50 ${value === m.id ? 'text-blue-600 font-medium bg-blue-50/60' : 'text-slate-700'}`}
                    title={m.title}
                  >
                    <span className="block truncate">{m.title || m.id}</span>
                    {m.date && <span className="text-[10px] text-slate-400">{m.date.slice(0, 10)}</span>}
                  </button>
                ))}
              </div>
            ))}
            {grouped.length === 0 && (
              <div className="text-xs text-slate-400 text-center py-4">无匹配会议</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 负责人模糊搜索选择器 ──
function OwnerSearchPicker({ value, orgEmployees, onChange }: {
  value: string;
  orgEmployees: { id: string; name: string; department: string }[];
  onChange: (name: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return orgEmployees.slice(0, 20);
    const q = query.toLowerCase();
    return orgEmployees.filter(e =>
      e.name.toLowerCase().includes(q) || e.department.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [query, orgEmployees]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input
          ref={ref}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur(); } }}
          placeholder="搜索姓名或部门..."
          className="w-full h-8 text-sm border border-slate-200 rounded-lg pl-7 pr-2 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        {query && (
          <button type="button" onMouseDown={() => { setQuery(''); onChange(''); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto mt-0.5">
          {filtered.map(emp => (
            <button key={emp.id} type="button"
              onMouseDown={() => { setQuery(emp.name); setOpen(false); onChange(emp.name); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{emp.name}</span>
              {emp.department && <span className="text-slate-400 truncate">{emp.department}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KanbanPage() {
  const router = useRouter();
  const currentMonthPreset = useMemo(() => getCurrentMonthPreset(), []);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterMeeting, setFilterMeeting] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [quickDateFilter, setQuickDateFilter] = useState<QuickDateFilter>('all');
  // 默认显示近 30 天
  const [datePreset, setDatePreset] = useState<DatePreset>('custom');
  const [dateStart, setDateStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return formatDateInput(d);
  });
  const [dateEnd, setDateEnd] = useState(() => formatDateInput(new Date()));
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [myTypeFilter, setMyTypeFilter] = useState(''); // 我的任务视图：会议类型筛选
  const [viewType, setViewType] = useState<ViewType>('board');
  const [typeFilter, setTypeFilter] = useState<'all' | 'normal' | 'continuous'>('all');
  const [currentUser, setCurrentUser] = useState<{ loginid: string; name: string; role?: string; dept?: string } | null>(null);
  const [aiInsight, setAiInsight] = useState('');
  const [generatingInsight, setGeneratingInsight] = useState(false);
  const [pushingMyTodos, setPushingMyTodos] = useState(false);
  const [pushResultMsg, setPushResultMsg] = useState('');
  const [userLoaded, setUserLoaded] = useState(false);
  const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overdueDialogOpen, setOverdueDialogOpen] = useState(false);
  const searchParams = useSearchParams();
  const [dragOverCol, setDragOverCol] = useState<ColumnKey | null>(null);

  // 组织架构数据
  const [orgEmployees, setOrgEmployees] = useState<{ id: string; name: string; department: string }[]>([]);

  // 编辑对话框
  const [editCard, setEditCard] = useState<KanbanCard | null>(null);
  const [editForm, setEditForm] = useState({ description: '', owner: '', proposer: '', due_date: '', priority: 'medium' as KanbanCard['priority'] });

  // 完成对话框
  const [doneCard, setDoneCard] = useState<KanbanCard | null>(null);
  const [doneNote, setDoneNote] = useState('');
  const [doneFiles, setDoneFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteHint, setPasteHint] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // 阻塞对话框
  const [blockCard, setBlockCard] = useState<KanbanCard | null>(null);
  const [blockReason, setBlockReason] = useState('');
  // 拖拽到 blocked 列时暂存
  const [pendingBlockDragId, setPendingBlockDragId] = useState<string | null>(null);

  // 汇报进展
  const [resultItem, setResultItem] = useState<KanbanCard | null>(null);
  const [resultForm, setResultForm] = useState({ text: '', status: 'in_progress' });
  const [nextDueDate, setNextDueDate] = useState('');
  const [resultImages, setResultImages] = useState<File[]>([]);
  const [resultNone, setResultNone] = useState(false); // 持续项「本期无进展/无完成情况」：true=无（免填说明与附件）
  const [resultSubmitting, setResultSubmitting] = useState(false);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showAiInsight, setShowAiInsight] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // 批次创建
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchChannel, setBatchChannel] = useState('wechat');
  const [batchRows, setBatchRows] = useState<{ description: string; owner: string; proposer: string; dueDate: string; dueDateType: string; priority: string }[]>([{ description: '', owner: '', proposer: '', dueDate: new Date().toISOString().slice(0, 10), dueDateType: 'date', priority: 'medium' }]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/actions');
      const r = await res.json();
      if (r.success) setCards((r.data || []));
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  // 持续项周期填报进度（actionId → 最近一次填报）
  const [progressMap, setProgressMap] = useState<Record<string, { progress: string | null; cycleDate: string; syncedAt: string; dataMonth?: string | null }>>({});
  // 持续项最近推送日期（actionId → pushDate），用于判断"本期待填报"
  const [lastPushMap, setLastPushMap] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch('/api/continuous/progress').then(r => r.json()).then(pr => {
      if (!pr.success) return;
      const map: Record<string, { progress: string | null; cycleDate: string; syncedAt: string; dataMonth?: string | null }> = {};
      for (const [actionId, recs] of Object.entries(pr.data || {})) {
        const list = recs as any[];
        const latest = [...list].sort((a, b) => String(b.cycleDate).localeCompare(String(a.cycleDate)))[0];
        if (latest) map[actionId] = { progress: latest.progress || null, cycleDate: latest.cycleDate, syncedAt: latest.syncedAt, dataMonth: latest.dataMonth || null };
      }
      setProgressMap(map);
    }).catch(() => {});
    fetch('/api/continuous/push-log').then(r => r.json()).then(pl => {
      if (!pl.success) return;
      const pushMap: Record<string, string> = {};
      for (const cycle of pl.data || []) {
        for (const it of cycle.items || []) {
          const d = (it.pushDate || cycle.date || '').slice(0, 10);
          if (it.actionId && d && (!pushMap[it.actionId] || d > pushMap[it.actionId])) pushMap[it.actionId] = d;
        }
      }
      setLastPushMap(pushMap);
    }).catch(() => {});
  }, []);

  // ── 持续项本周期判定 ──
  // 各会议类型的最近一次已开会议（从全量卡片聚合，meeting_date <= 今天），用于周期锚点
  // 注意必须排除未来日期的会议（测试/预录数据）：锚点被推到未来会导致"本周期已填报"永远判定失败
  const latestMeetingByType = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const map: Record<string, { date: string; createdAt?: string | null }> = {};
    for (const c of cards) {
      const mt = c.meeting_type || '';
      const md = (c.meeting_date || '').slice(0, 10);
      if (!mt || !md) continue;
      if (md > todayStr) continue; // 未来会议不作为周期锚点
      if (!map[mt] || md > map[mt].date) map[mt] = { date: md, createdAt: c.meeting_created_at || null };
    }
    return map;
  }, [cards]);

  // 周期分界线（业务口径）：开完会传完纪要（≈会议记录创建时刻）之后 = 新一周。
  // 精确到"日"：ISO 时间转北京日期；无创建时间的历史数据回退为"会议次日"（原口径）
  const cycleBoundaryOf = useCallback((mt: string): Date | null => {
    const latest = latestMeetingByType[mt];
    if (!latest) return null;
    if (latest.createdAt) {
      const iso = new Date(latest.createdAt);
      if (!isNaN(iso.getTime())) {
        const bj = new Date(iso.getTime() + 8 * 3600 * 1000);
        return new Date(bj.toISOString().slice(0, 10) + 'T00:00:00');
      }
    }
    const d = new Date(latest.date + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d;
  }, [latestMeetingByType]);

  // 本周期内已填报 → 待办视作"本周期完成"
  // 月会/产销会（按月、看最近已开会所在月数据）：用 dataMonth == 最近已开会所在月
  // 周例会：填报日 >= 周期分界线（会议记录创建日 ≈ 纪要上传日）→ 本周已填
  const reportedThisCycle = useCallback((card: KanbanCard): boolean => {
    if ((card.due_date_type || '') !== 'continuous') return false;
    const pr = progressMap[card.id];
    if (!pr?.cycleDate) return false;
    const mt = card.meeting_type || '';
    if (mt === '公司月会' || mt === '产销会') {
      const latest = latestMeetingByType[mt];
      if (latest) {
        return pr.dataMonth === latest.date.slice(0, 7);
      }
      return new Date(pr.cycleDate + 'T00:00:00') >= new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    }
    // 周例会：填报日 >= 周期分界线（会议记录创建日 ≈ 纪要上传日）→ 本周已填
    const boundary = cycleBoundaryOf(mt);
    if (boundary) {
      return new Date(pr.cycleDate + 'T00:00:00') >= boundary;
    }
    // 查不到会议记录：回退按本周一起算
    const dow = (new Date().getDay() + 6) % 7;
    const d = new Date(); d.setDate(d.getDate() - dow); d.setHours(0, 0, 0, 0);
    return new Date(pr.cycleDate + 'T00:00:00') >= d;
  }, [progressMap, latestMeetingByType, cycleBoundaryOf]);

  // ── 持续项填报周期判定 ──
  // 分界线（会议记录创建 ≈ 开完会传完纪要）之后 = 新周期开启 → 显示"本期待填报"
  // 分界线之前（会还没开/纪要未传）→ 上一周期尚未汇报，仍按"不在填报周期"处理
  const inReportingCycle = useCallback((card: KanbanCard): boolean => {
    if ((card.due_date_type || '') !== 'continuous') return false;
    const mt = card.meeting_type || '';
    const boundary = cycleBoundaryOf(mt);
    if (!boundary) return false; // 查不到会议日期 → 不显示（保持现状）
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return today >= boundary;
  }, [cycleBoundaryOf]);

  // 持续项卡片在待办的最终判定：在填报周期 && 本周期未填 → 显示；否则消失
  const shouldShowContinuous = useCallback((card: KanbanCard): boolean => {
    if ((card.due_date_type || '') !== 'continuous') return true; // 非持续项照常
    if (reportedThisCycle(card)) return false; // 本周期已填 → 消失
    return inReportingCycle(card); // 在填报周期 → 显示待填报；翻篇 → 消失
  }, [reportedThisCycle, inReportingCycle]);

  // 持续项本期待填报标识：
  // - 有 OA 推送记录（lastPushMap 有该 action）→ 蓝色"<类别> · 本期待填报"
  // - 无推送记录 → 灰色"<类别> · 持续执行"（未纳入推送体系）
  const cycleLabelOf = useCallback((card: KanbanCard): { label: string; hasCycle: boolean } => {
    const mt = card.meeting_type || '';
    const hasCycle = !!lastPushMap[card.id] || !!progressMap[card.id]?.cycleDate;
    const typeLabel = mt || '持续项';
    if (hasCycle) return { label: `${typeLabel} · 本期待填报`, hasCycle: true };
    return { label: `${typeLabel} · 持续执行`, hasCycle: false };
  }, [lastPushMap, progressMap]);

  const loadOrgEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/org/employees');
      const r = await res.json();
      if (r.success) {
        // 获取部门名称映射
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
  }, []);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.success) {
        const user = { loginid: d.data.loginid, name: d.data.name, role: d.data.role || 'employee', dept: d.data.dept || '' };
        setCurrentUser(user);
        const urlView = searchParams.get('view');
        if (urlView === 'my') setViewMode('my');
        else if (urlView === 'all') setViewMode('all');
        else if (user.role === 'employee') setViewMode('my');
        if (user.role === 'manager' && user.dept) setFilterDept(user.dept);
        // secretary 不默认部门过滤，方便查看跨部门会议的任务
      }
    }).catch(() => {}).finally(() => setUserLoaded(true));
  }, []);

  // 企微卡片入口：?meetingId=xx 聚焦到该会议的待办（useEffect 中读取，避免 hydration 不一致）
  const [focusMeetingId, setFocusMeetingId] = useState<string | null>(null);
  // 持续项定时推送卡片入口（?type=continuous）：绕过填报周期判定，推送在催的项必须可见
  const [fromContinuousPush, setFromContinuousPush] = useState(false);
  // 推送批次精确过滤：?pushId=xx → 只显示该批次推送的持续项（不同类型/批次不混）
  const [pushItemIds, setPushItemIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    const mid = searchParams.get('meetingId');
    if (mid) setFocusMeetingId(mid);
    // 持续项定时推送卡片：?type=continuous 预选持续项筛选
    const t = searchParams.get('type');
    if (t === 'continuous' || t === 'normal') setTypeFilter(t);
    if (t === 'continuous') setFromContinuousPush(true);
    // 批次精确过滤：拉取本批推送的 itemIds
    const pid = searchParams.get('pushId');
    if (pid) {
      fetch(`/api/push-batch?pushId=${encodeURIComponent(pid)}`)
        .then(r => r.json())
        .then(d => {
          if (d.success && Array.isArray(d.data?.itemIds) && d.data.itemIds.length > 0) {
            setPushItemIds(new Set(d.data.itemIds));
          }
        })
        .catch(() => {});
    }
  }, [searchParams]);

  useEffect(() => { loadActions(); loadOrgEmployees(); }, [loadActions, loadOrgEmployees]);

  const openResult = (card: KanbanCard) => {
    setResultItem(card);
    // 预填过滤：导入元数据（{"y":..,"w":..,"d":..}）不是真实汇报，不带入输入框
    setResultForm({ text: getDisplayOaResult((card as any).oa_result), status: card.due_date_type === 'continuous' ? 'in_progress' : card.status === 'done' ? 'done' : 'blocked' });
    setNextDueDate('');
    setResultImages([]);
    // 上期填「无」的记录（oa_result 规范为"无"）重开时默认仍选「无」，无需再手点
    setResultNone(card.due_date_type === 'continuous' && getDisplayOaResult((card as any).oa_result) === '无');
  };

  // 汇报弹窗打开时：document 级粘贴监听，任意位置 Ctrl+V 截图都能捕获
  useEffect(() => {
    if (!resultItem) return;
    const onPasteDoc = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;
      e.preventDefault();
      const newFiles: File[] = [];
      imageItems.forEach(item => {
        const blob = item.getAsFile();
        if (blob) {
          const file = new File([blob], `paste-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`, { type: blob.type });
          newFiles.push(file);
        }
      });
      if (newFiles.length > 0) setResultImages(prev => [...prev, ...newFiles]);
    };
    document.addEventListener('paste', onPasteDoc);
    return () => document.removeEventListener('paste', onPasteDoc);
  }, [resultItem]);

  // 筛选逻辑
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);  const weekEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(today.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [today]);

  const filteredCards = cards.filter(c => {
    if (searchText && !c.description.toLowerCase().includes(searchText.toLowerCase()) && !c.owner?.toLowerCase().includes(searchText.toLowerCase())) return false;
    // 推送批次精确过滤：只显示该次推送的持续项
    if (pushItemIds && !pushItemIds.has(c.id)) return false;
    // 企微卡片聚焦模式：只显示该会议的待办（任何视图）
    if (focusMeetingId && c.meeting_id !== focusMeetingId) return false;
    // 持续项：不在填报周期或本周期已填 → 不进待办（历史保留在填报统计）
    // 例外：群体项视图（代填）、持续项推送卡片入口、以及"我的任务"视图（自己名下都该可见，
    // 与侧边栏待办角标口径一致，避免"角标有数点进去没有"）
    if (viewMode === 'all' && !fromContinuousPush && !shouldShowContinuous(c)) return false;
    if (typeFilter === 'continuous' && (c.due_date_type || '') !== 'continuous') return false;
    if (typeFilter === 'normal' && (c.due_date_type || '') === 'continuous') return false;
    if (filterOwner && c.owner !== filterOwner) return false;
    if (filterPriority && c.priority !== filterPriority) return false;
    if (filterMeeting && c.meeting_id !== filterMeeting) return false;
    if (filterDept && c.dept !== filterDept) return false;
    if (viewMode === 'my') {
      const matchName = currentUser?.name && c.owner === currentUser.name;
      const matchLoginId = currentUser?.loginid && c.ownerLoginId === currentUser.loginid;
      if (!matchName && !matchLoginId) return false;
    }
    // 群体项视图：责任人为"所有人/各部门/各部门负责人/品质部"等群体的持续项（管理员代填）
    // 判定与「我的任务」群体开关统一用 isGroupOwner 同一份名单，避免两处口径不一致
    if (viewMode === 'group') {
      if (!isGroupOwner(c.owner)) return false;
      if ((c.due_date_type || '') !== 'continuous') return false;
    }
    const dueDateType = c.due_date_type || 'date';
    const dueDate = c.due_date ? new Date(c.due_date.slice(0, 10)) : null;
    // 日期范围筛选（默认近30天）仅"全部任务"视图与企微聚焦模式外生效：
    // "我的任务"视图跳过——我的待办含未来截止的都必须可见（与侧边栏角标口径一致）
    if (!focusMeetingId && viewMode !== 'my') {
      // 持续项和待定项不参与日期筛选
      if (dueDateType !== 'continuous' && dueDateType !== 'tbd') {
        if (dateStart && (!dueDate || dueDate < new Date(dateStart))) return false;
        if (dateEnd) {
          const end = new Date(dateEnd);
          end.setHours(23, 59, 59, 999);
          if (!dueDate || dueDate > end) return false;
        }
      }
      if (quickDateFilter === 'overdue' && (!dueDate || c.status === 'done' || c.status === 'blocked' || dueDate >= today)) return false;
      if (quickDateFilter === 'today' && (!dueDate || dueDate.getTime() !== today.getTime())) return false;
      if (quickDateFilter === 'this_week' && (!dueDate || dueDate < today || dueDate > weekEnd)) return false;
      if (quickDateFilter === 'high_priority' && c.priority !== 'high') return false;
    }
    return true;
  });

  // 旧状态映射到新列；已打稽核标记(V/X/0)的项不算待办
  const toColKey = (c: KanbanCard): ColumnKey | null => {
    if ((c as any).status === 'verified') return 'done'; // 已勾稽视作已处理
    if (c.status === 'done' || (c as any).oa_score === 1) return 'done';
    if ((c as any).oa_score != null) return null; // X/0 不进看板待办
    if (reportedThisCycle(c)) return 'done'; // 持续项本周期已填报 → 本周期视作已处理
    return 'unprocessed'; // 仅无标记的未处理项
  };

  const getColumnCards = useCallback((col: ColumnKey) => {
    if (col === 'overdue') {
      return filteredCards.filter(c =>
        (c as any).oa_score == null && c.status !== 'done' && c.status !== 'blocked' && c.due_date && (c.due_date_type || 'date') === 'date' && new Date(c.due_date) < today
      );
    }
    if (col === 'unprocessed') {
      // 未处理列排除已逾期任务（已在overdue列显示）
      return filteredCards.filter(c => {
        if (toColKey(c) !== col) return false;
        const isOverdue = c.due_date && (c.due_date_type || 'date') === 'date' && new Date(c.due_date) < today;
        return !isOverdue;
      });
    }
    return filteredCards.filter(c => toColKey(c) === col);
  }, [filteredCards, today]);

  // ── 拖拽 ──
  const handleDragStart = (id: string) => setDragId(id);
  const handleDragEnd = () => { setDragId(null); setDragOverCol(null); };

  const handleDrop = async (targetCol: ColumnKey) => {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    setDragOverCol(null);
    const card = cards.find(c => c.id === id);
    if (!card) return;
    if (targetCol === 'done') {
      setDoneCard(card); setDoneNote(''); setDoneFiles([]);
      return;
    }
    // unprocessed 直接更新
    setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'pending' as KanbanCard['status'] } : c));
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    }).catch(() => {});
  };

  // ── 开始执行 / 确认 ──
  const confirmCard = async (id: string) => {
    const byUser = currentUser?.name || currentUser?.loginid || '用户';
    setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'in_progress', confirmed_by: byUser } : c));
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress', confirmed_by: byUser }),
    }).catch(() => {});
  };

  // ── 完成对话框提交 ──
  const submitDone = async () => {
    if (!doneCard) return;
    const now = new Date().toISOString();
    const byUser = currentUser?.name || currentUser?.loginid || '用户';
    // 提交时将 File[] 转换为文件名数组
    const fileNames = doneFiles.map(f => f.name);
    setCards(prev => prev.map(c => c.id === doneCard.id ? {
      ...c, status: 'done', completed_by: byUser, completed_at: now,
      completion_note: doneNote, evidence_files: fileNames,
    } : c));
    setDoneCard(null);
    await fetch(`/api/actions/${doneCard.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', completed_by: byUser, completion_note: doneNote, evidence_files: fileNames }),
    }).catch(() => {});
  };

  // ── 阻塞对话框提交 ──
  const submitBlock = async () => {
    if (!blockCard || !blockReason.trim()) return;
    const id = blockCard.id;
    const now = new Date().toISOString();
    const byUser = currentUser?.name || currentUser?.loginid || '用户';
    setCards(prev => prev.map(c => c.id === id ? {
      ...c, status: 'blocked', block_reason: blockReason, blocked_by: byUser, blocked_at: now,
    } : c));
    setBlockCard(null);
    setPendingBlockDragId(null);
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'blocked', block_reason: blockReason, blocked_by: byUser }),
    }).catch(() => {});
  };

  // ── 编辑对话框 ──
  const openEdit = (card: KanbanCard) => {
    setEditCard(card);
    setEditForm({ description: card.description, owner: card.owner || '', proposer: (card as any).proposer || '', due_date: card.due_date || '', priority: card.priority });
  };
  const submitEdit = async () => {
    if (!editCard) return;
    setCards(prev => prev.map(c => c.id === editCard.id ? {
      ...c, description: editForm.description, owner: editForm.owner || null,
      proposer: editForm.proposer || null,
      due_date: editForm.due_date || null, priority: editForm.priority,
    } : c));
    setEditCard(null);
    await fetch(`/api/actions/${editCard.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editForm.description, owner: editForm.owner || null, proposer: editForm.proposer || null, due_date: editForm.due_date || null, priority: editForm.priority }),
    }).catch(() => {});
  };

  // ── 文件上传 ──
  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setDoneFiles(prev => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── 剪贴板粘贴 ──
  const handlePaste = useCallback((e: React.ClipboardEvent | ClipboardEvent) => {
    const items = Array.from((e as ClipboardEvent).clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const newFiles: File[] = [];
    imageItems.forEach(item => {
      const blob = item.getAsFile();
      if (blob) {
        const file = new File([blob], `paste-${Date.now()}.png`, { type: blob.type });
        newFiles.push(file);
      }
    });
    if (newFiles.length > 0) {
      setDoneFiles(prev => [...prev, ...newFiles]);
      setPasteHint(true);
      setTimeout(() => setPasteHint(false), 2000);
    }
  }, []);

  // ── 截图处理（完成对话框用）──
  const handleScreenshotCapture = useCallback((imageDataUrl: string) => {
    fetch(imageDataUrl)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], `screenshot-${Date.now()}.png`, { type: 'image/png' });
        setDoneFiles(prev => [...prev, file]);
      });
  }, []);

  // ── 拖拽上传处理 ──
  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleFileDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    setDoneFiles(prev => [...prev, ...files]);
  }, []);

  const allOwners = [...new Set(cards.map(c => c.owner).filter(Boolean))] as string[];
  const allDepts = [...new Set(cards.map(c => c.dept).filter(Boolean))] as string[];
  const allMeetings = useMemo(() => {
    const seen = new Map<string, { title: string; date: string }>();
    for (const c of cards) {
      if (c.meeting_id && !seen.has(c.meeting_id))
        seen.set(c.meeting_id, { title: c.meeting_title || '', date: c.meeting_date || '' });
    }
    return [...seen.entries()].map(([id, v]) => ({ id, ...v }));
  }, [cards]);
const doneCount = filteredCards.filter(c => c.status === 'done' || reportedThisCycle(c)).length;
const inProgressCount = filteredCards.filter(c => c.status === 'in_progress' && !reportedThisCycle(c)).length;
const pendingCount = filteredCards.filter(c => c.status === 'pending' || c.status === 'confirmed').length;
  const blockedCount = filteredCards.filter(c => c.status === 'blocked').length;
  const overdueCount = filteredCards.filter(c =>
    c.status !== 'done' && c.status !== 'blocked' && c.due_date && (c.due_date_type || 'date') === 'date' && new Date(c.due_date) < today
  ).length;
  const isDefaultMonthRange = dateStart === currentMonthPreset.start && dateEnd === currentMonthPreset.end;
  const activeFilterCount = [
    filterOwner,
    filterPriority,
    filterMeeting,
    filterDept,
    !isDefaultMonthRange ? 'custom-date-range' : '',
    quickDateFilter !== 'all' ? quickDateFilter : '',
  ].filter(Boolean).length;

  // 指标卡数据
  const indDoneCount = filteredCards.filter(c => c.status === 'done').length;
  const indOverdueCount = filteredCards.filter(c =>
    c.status !== 'done' && c.status !== 'blocked' && c.due_date && (c.due_date_type || 'date') === 'date' && new Date(c.due_date) < today
  ).length;
  const indBlockedCount = filteredCards.filter(c => c.status === 'blocked').length;
  const indProgressCount = filteredCards.filter(c => c.status === 'in_progress').length;
  const indPendingCount = filteredCards.filter(c => c.status === 'pending' || c.status === 'candidate' || c.status === 'confirmed').length;
  const indTotal = filteredCards.length;
  const indDoneRate = indTotal > 0 ? Math.round(indDoneCount / indTotal * 100) : 0;
  const indScoreV = filteredCards.filter(c => (c as any).oa_score === 1).length;
  const indScoreX = filteredCards.filter(c => (c as any).oa_score === -1).length;
  const indScore0 = filteredCards.filter(c => (c as any).oa_score === 0).length;
  const indByPriority = { high: filteredCards.filter(c => c.priority === 'high').length, medium: filteredCards.filter(c => c.priority === 'medium').length, low: filteredCards.filter(c => c.priority === 'low').length };
  const indByDept: Record<string, number> = {};
  for (const c of filteredCards) { if (c.dept) indByDept[c.dept] = (indByDept[c.dept] || 0) + 1; }
  const indTopDept = Object.entries(indByDept).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const indMine = filteredCards.filter(c => currentUser?.name && (c.owner === currentUser.name || c.ownerLoginId === currentUser.loginid)).length;
  const indMineOverdue = filteredCards.filter(c => (currentUser?.name && (c.owner === currentUser.name || c.ownerLoginId === currentUser.loginid))
    && c.status !== 'done' && c.status !== 'blocked' && c.due_date && (c.due_date_type || 'date') === 'date' && new Date(c.due_date) < today).length;

  const toggleExpandedCol = (key: string) => {
    setExpandedCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applyDatePreset = (preset: Exclude<DatePreset, 'custom'>) => {
    setDatePreset(preset);
    if (preset === 'all') {
      setDateStart('');
      setDateEnd('');
      return;
    }
    if (preset === 'today') {
      const range = getTodayPreset();
      setDateStart(range.start);
      setDateEnd(range.end);
      return;
    }
    if (preset === 'this_week') {
      const range = getCurrentWeekPreset();
      setDateStart(range.start);
      setDateEnd(range.end);
      return;
    }
    setDateStart(currentMonthPreset.start);
    setDateEnd(currentMonthPreset.end);
  };

  const resetFiltersToDefaultMonth = () => {
    setFilterOwner('');
    setFilterPriority('');
    setFilterMeeting('');
    setFilterDept('');
    setQuickDateFilter('all');
    setDatePreset('this_month');
    setDateStart(currentMonthPreset.start);
    setDateEnd(currentMonthPreset.end);
    setSearchText('');
  };

  const getVisibleCards = (cardsInColumn: KanbanCard[], key: string, limit = DEFAULT_COLLAPSED_CARD_COUNT) => {
    if (cardsInColumn.length <= limit || expandedCols.has(key)) return cardsInColumn;
    return cardsInColumn.slice(0, limit);
  };

  const overdueCards = useMemo(() => getColumnCards('overdue'), [getColumnCards]);
  const overdueCardsSorted = useMemo(() => {
    return [...overdueCards].sort((a, b) => {
      const aDays = a.due_date ? Math.max(0, Math.ceil((today.getTime() - new Date(a.due_date.slice(0, 10)).getTime()) / 86400000)) : 0;
      const bDays = b.due_date ? Math.max(0, Math.ceil((today.getTime() - new Date(b.due_date.slice(0, 10)).getTime()) / 86400000)) : 0;
      if (bDays !== aDays) return bDays - aDays;
      if (PRIORITY_WEIGHT[b.priority] !== PRIORITY_WEIGHT[a.priority]) {
        return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      }
      return (a.due_date || '').localeCompare(b.due_date || '');
    });
  }, [overdueCards, today]);
  const overdueSummary = useMemo(() => ({
    high: overdueCards.filter(card => card.priority === 'high').length,
    medium: overdueCards.filter(card => card.priority === 'medium').length,
    low: overdueCards.filter(card => card.priority === 'low').length,
    mine: overdueCards.filter(card =>
      (currentUser?.name && card.owner === currentUser.name) ||
      (currentUser?.loginid && card.ownerLoginId === currentUser.loginid)
    ).length,
  }), [currentUser?.loginid, currentUser?.name, overdueCards]);

  const generateAiInsight = useCallback(async () => {
    setGeneratingInsight(true);
    try {
      const summary = {
        total: filteredCards.length,
        done: doneCount,
        inProgress: inProgressCount,
        blocked: blockedCount,
        overdue: overdueCount,
        byDept: filteredCards.reduce((acc, c) => {
          if (c.dept) acc[c.dept] = (acc[c.dept] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        byPriority: filteredCards.reduce((acc, c) => {
          acc[c.priority] = (acc[c.priority] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      };

      const res = await fetch('/api/ai/insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, isPersonal: viewMode === 'my' }),
      });
      const data = await res.json();
      if (data.success) {
        setAiInsight(data.insight || '暂无洞察');
      } else {
        setAiInsight(`当前有 ${overdueCount} 个逾期任务，${blockedCount} 个未完成任务，建议优先处理高优先级事项。`);
      }
    } catch (e) {
      setAiInsight(`当前有 ${overdueCount} 个逾期任务，${blockedCount} 个未完成任务，建议优先处理高优先级事项。`);
    } finally {
      setGeneratingInsight(false);
    }
  }, [filteredCards, doneCount, inProgressCount, blockedCount, overdueCount, viewMode]);

  const pushMyTodosToIM = useCallback(async () => {
    if (!currentUser?.loginid) {
      setPushResultMsg('未获取到您的 OA 账号，无法推送。');
      setTimeout(() => setPushResultMsg(''), 4000);
      return;
    }

    setPushingMyTodos(true);
    setPushResultMsg('正在推送我的全部待办到 IM...');
    try {
      const res = await fetch('/api/chat/send-todo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oaUserId: currentUser.loginid,
          owner: currentUser.name,
          ownerLoginId: currentUser.loginid,
          format: 'card',
        }),
      });
      const data = await res.json();
      if (data.success) {
        const itemCount = data.data?.actionItemCount;
        setPushResultMsg(
          itemCount ? `已推送 ${itemCount} 条我的待办到 IM` : (data.data?.message || '已推送到 IM')
        );
      } else {
        setPushResultMsg(`推送失败：${data.error || '接口异常'}`);
      }
    } catch {
      setPushResultMsg('推送请求失败，请检查网络或 IM 服务。');
    } finally {
      setPushingMyTodos(false);
      setTimeout(() => setPushResultMsg(''), 5000);
    }
  }, [currentUser]);

  // 自动生成洞察
  useEffect(() => {
    if (filteredCards.length > 0 && !aiInsight) {
      generateAiInsight();
    }
  }, [filteredCards.length, aiInsight, generateAiInsight]);

  if (!userLoaded) {
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
      <div className="flex flex-col gap-4 h-[calc(100vh-104px)]">
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm flex-shrink-0">
          {/* 行1：标题 + 统计 + 报表开关 + AI 洞察 + 刷新（紧凑单行） */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
                <Target className="h-3.5 w-3.5" />
              </div>
              <h1 className="text-base font-bold tracking-tight text-slate-900">待办中心</h1>
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: '全部', value: filteredCards.length, tone: 'text-slate-700', bg: 'bg-slate-50' },
                { label: '进行中', value: inProgressCount, tone: 'text-blue-700', bg: 'bg-blue-50' },
                { label: '待处理', value: pendingCount, tone: 'text-amber-700', bg: 'bg-amber-50' },
                { label: '逾期', value: overdueCount, tone: 'text-red-700', bg: 'bg-red-50' },
              ].map(item => (
                <span key={item.label} className={`inline-flex items-baseline gap-1 rounded-full ${item.bg} px-2 py-0.5 text-[11px] font-medium ${item.tone}`}>
                  {item.label}
                  <strong className="text-xs font-bold">{item.value}</strong>
                </span>
              ))}
            </div>
            <button onClick={() => setShowIndicators(v => !v)}
              className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-all ${
                showIndicators ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700'
              }`}>
              报表
              <ChevronDown className={`w-3 h-3 transition-transform ${showIndicators ? 'rotate-180' : ''}`} />
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="relative">
                <button onClick={() => setShowAiInsight(v => !v)}
                  className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-all ${
                    showAiInsight ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:text-blue-600'
                  }`}>
                  <Sparkles className="w-3 h-3" /> AI 洞察
                </button>
                {showAiInsight && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowAiInsight(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                      <p className="text-xs leading-5 text-slate-600">{aiInsight || '正在分析任务数据...'}</p>
                      <button onClick={generateAiInsight} disabled={generatingInsight}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50">
                        <RefreshCw className={`w-3 h-3 ${generatingInsight ? 'animate-spin' : ''}`} /> 重新生成
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button onClick={loadActions} title="刷新数据"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:text-blue-600">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* 指标卡（可折叠，点行1「报表」展开） */}
          <div className="border-b border-slate-100">
            {showIndicators && (
              <div className="px-4 py-3 space-y-3">
                {/* 第一行：核心指标 */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    { label: '全部任务', value: indTotal, color: 'text-slate-900', bg: 'bg-slate-100' },
                    { label: '待处理', value: indPendingCount, color: 'text-amber-700', bg: 'bg-amber-100' },
                    { label: '进行中', value: indProgressCount, color: 'text-blue-700', bg: 'bg-blue-100' },
                    { label: '已处理', value: indDoneCount, color: 'text-emerald-700', bg: 'bg-emerald-100' },
                    { label: '未完成', value: indBlockedCount, color: 'text-red-700', bg: 'bg-red-100' },
                    { label: '逾期', value: indOverdueCount, color: 'text-red-700', bg: 'bg-red-100' },
                    { label: '我的待办', value: indMine, color: 'text-indigo-700', bg: 'bg-indigo-100' },
                    { label: '我的逾期', value: indMineOverdue, color: 'text-red-700', bg: 'bg-red-100' },
                    { label: '完成率', value: `${indDoneRate}%`, color: 'text-emerald-700', bg: 'bg-emerald-100' },
                    { label: '稽核V', value: indScoreV, color: 'text-emerald-700', bg: 'bg-emerald-100' },
                  ].map(s => (
                    <div key={s.label} className={`${s.bg} rounded-xl px-3 py-2.5`}>
                      <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* 第二行：分布 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {/* 优先级分布 */}
                  <div className="bg-slate-50 rounded-xl px-3 py-2.5">
                    <div className="text-[10px] font-semibold text-slate-500 mb-2">优先级分布</div>
                    <div className="flex gap-2">
                      {[
                        { label: '高', count: indByPriority.high, color: 'bg-red-500' },
                        { label: '中', count: indByPriority.medium, color: 'bg-amber-500' },
                        { label: '低', count: indByPriority.low, color: 'bg-green-500' },
                      ].map(p => {
                        const pct = indTotal > 0 ? Math.round(p.count / indTotal * 100) : 0;
                        return (
                          <div key={p.label} className="flex-1">
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="font-medium text-slate-600">{p.label}</span>
                              <span className="text-slate-400">{p.count}</span>
                            </div>
                            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div className={`h-full ${p.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 稽核评分分布 */}
                  <div className="bg-slate-50 rounded-xl px-3 py-2.5">
                    <div className="text-[10px] font-semibold text-slate-500 mb-2">稽核评分分布</div>
                    <div className="flex gap-2">
                      {[
                        { label: 'V ✓', count: indScoreV, color: 'bg-emerald-500' },
                        { label: '0 —', count: indScore0, color: 'bg-slate-400' },
                        { label: 'X ✗', count: indScoreX, color: 'bg-red-500' },
                      ].map(s => {
                        const pct = indTotal > 0 ? Math.round(s.count / indTotal * 100) : 0;
                        return (
                          <div key={s.label} className="flex-1">
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="font-medium text-slate-600">{s.label}</span>
                              <span className="text-slate-400">{s.count}</span>
                            </div>
                            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div className={`h-full ${s.color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 第三行：部门分布 */}
                {indTopDept.length > 0 && (
                  <div className="bg-slate-50 rounded-xl px-3 py-2.5">
                    <div className="text-[10px] font-semibold text-slate-500 mb-2">部门分布（前 5）</div>
                    <div className="grid grid-cols-5 gap-2">
                      {indTopDept.map(([dept, count]) => {
                        const pct = indTotal > 0 ? Math.round(count / indTotal * 100) : 0;
                        return (
                          <div key={dept}>
                            <div className="text-xs font-medium text-slate-700 truncate" title={dept}>{dept}</div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-400">{count}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white px-4 py-3">
            {/* 企微卡片聚焦模式提示条 */}
            {(focusMeetingId || pushItemIds) && (
              <div className="mb-2 px-4 py-2 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between gap-3">
                <span className="text-xs text-blue-700 truncate">
                  {pushItemIds
                    ? `🔄 本期推送的持续项（${filteredCards.length}条）`
                    : `📋 正在查看该会议的行动项（${filteredCards.length}条）`}
                </span>
                <button
                  onClick={() => { setFocusMeetingId(null); setPushItemIds(null); }}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                >查看全部任务</button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {currentUser?.role !== 'employee' && (
                <div className="flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                  <button onClick={() => setViewMode('all')}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                      viewMode === 'all' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`}>
                    <Eye className="w-3.5 h-3.5" /> 全部任务
                  </button>
                  <button onClick={() => setViewMode('my')}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                      viewMode === 'my' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`}>
                    <User className="w-3.5 h-3.5" /> 我的任务
                  </button>
                  {(currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
                    <button onClick={() => setViewMode('group')}
                      title="责任人为「所有人/各部门」等群体的持续项，由管理员代为填写进展"
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                        viewMode === 'group' ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                      }`}>
                      <Users className="w-3.5 h-3.5" /> 群体项
                    </button>
                  )}
                </div>
              )}

              <div className="flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                <button onClick={() => setTypeFilter('all')}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    typeFilter === 'all' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`}>
                  全部
                </button>
                <button onClick={() => setTypeFilter('normal')}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    typeFilter === 'normal' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`}>
                  普通项
                </button>
                <button onClick={() => setTypeFilter('continuous')}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    typeFilter === 'continuous' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                  }`}>
                  <RefreshCw className="w-3 h-3" /> 持续项
                </button>
              </div>

              <div className="flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                <button onClick={() => setViewType('board')}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    viewType === 'board' ? 'bg-slate-100 text-slate-800' : 'text-slate-400 hover:text-slate-600'
                  }`}>
                  <LayoutGrid className="w-3.5 h-3.5" /> 看板
                </button>
                <button onClick={() => setViewType('calendar')}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    viewType === 'calendar' ? 'bg-slate-100 text-slate-800' : 'text-slate-400 hover:text-slate-600'
                  }`}>
                  <Calendar className="w-3.5 h-3.5" /> 日历
                </button>
              </div>

              <div className="relative min-w-[180px] flex-1 md:max-w-[220px] md:flex-none">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="搜索任务..." value={searchText}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
                  className="h-9 rounded-2xl border-slate-200 bg-white pl-9 text-xs shadow-sm" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {[
                  { key: 'all', label: '全部日期' },
                  { key: 'this_month', label: '本月' },
                  { key: 'this_week', label: '本周' },
                  { key: 'today', label: '今天' },
                ].map(item => (
                  <button
                    key={item.key}
                    onClick={() => applyDatePreset(item.key as Exclude<DatePreset, 'custom'>)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                      datePreset === item.key
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowAdvancedFilters(v => !v)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold transition-all ${
                  showAdvancedFilters || activeFilterCount > 0
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                }`}
              >
                更多筛选
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
              </button>

              <button
                onClick={() => setShowBatchModal(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-2xl border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 transition-all hover:bg-blue-100"
              >
                <Plus className="h-3.5 w-3.5" /> 新建任务
              </button>

              <div className="relative">
                <button
                  onClick={() => setShowMoreMenu(v => !v)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold transition-all ${
                    showMoreMenu
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  更多
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMoreMenu ? 'rotate-180' : ''}`} />
                </button>
                {showMoreMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowMoreMenu(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1.5 w-44 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                      <button
                        onClick={() => { setShowMoreMenu(false); router.push('/batches'); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                      >
                        <FileText className="h-3.5 w-3.5 text-slate-400" /> 批次管理
                      </button>
                      <button
                        onClick={() => { setShowMoreMenu(false); pushMyTodosToIM(); }}
                        disabled={pushingMyTodos || !currentUser?.loginid}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Sparkles className={`h-3.5 w-3.5 text-indigo-400 ${pushingMyTodos ? 'animate-pulse' : ''}`} />
                        {pushingMyTodos ? '推送中...' : '推送我的全部待办'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {pushResultMsg && (
              <div className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700">
                {pushResultMsg}
              </div>
            )}

            {showAdvancedFilters && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                {viewMode === 'all' && (
                  <>
                    <MeetingFilterDropdown value={filterMeeting} onChange={setFilterMeeting} meetings={allMeetings} />
                    <select value={filterOwner} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterOwner(e.target.value)}
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm">
                      <option value="">全部负责人</option>
                      {allOwners.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <select value={filterPriority} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterPriority(e.target.value)}
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm">
                      <option value="">全部优先级</option>
                      <option value="high">高优先</option>
                      <option value="medium">中优先</option>
                      <option value="low">低优先</option>
                    </select>
                    <select value={filterDept} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterDept(e.target.value)}
                      className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm">
                      <option value="">全部部门</option>
                      {allDepts.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </>
                )}

                {viewMode === 'my' && (
                  <MeetingFilterDropdown value={filterMeeting} onChange={setFilterMeeting} meetings={allMeetings} />
                )}

                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-1">
                  {[
                    { key: 'all', label: '全部任务' },
                    { key: 'overdue', label: '仅逾期' },
                    { key: 'high_priority', label: '高优先' },
                  ].map(item => (
                    <button
                      key={item.key}
                      onClick={() => setQuickDateFilter(item.key as QuickDateFilter)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                        quickDateFilter === item.key
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <input
                  type="date"
                  value={dateStart}
                  onChange={e => {
                    setDatePreset('custom');
                    setDateStart(e.target.value);
                  }}
                  className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm"
                  title="开始日期"
                />
                <input
                  type="date"
                  value={dateEnd}
                  onChange={e => {
                    setDatePreset('custom');
                    setDateEnd(e.target.value);
                  }}
                  className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs text-slate-600 shadow-sm"
                  title="结束日期"
                />

                {activeFilterCount > 0 && (
                  <button
                    onClick={resetFiltersToDefaultMonth}
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    恢复默认
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

      {/* 日历视图 */}
      {viewType === 'calendar' && <CalendarView cards={filteredCards} />}

      {/* 我的工作台 - 个人任务视图 */}
      {viewType === 'board' && viewMode === 'my' && (
        <div className="contents">

          {/* 会议类型筛选（我的任务） */}
          {(() => {
            const myTypes = [...new Set(filteredCards
              .filter(c => currentUser?.name && (c.owner === currentUser.name || c.ownerLoginId === currentUser.loginid))
              .map(c => c.meeting_type).filter(Boolean))].sort() as string[];
            if (myTypes.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                <button onClick={() => setMyTypeFilter('')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${myTypeFilter === '' ? 'bg-slate-900 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                  全部类别
                </button>
                {myTypes.map(mt => (
                  <button key={mt} onClick={() => setMyTypeFilter(myTypeFilter === mt ? '' : mt)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${myTypeFilter === mt ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'}`}>
                    {mt}
                  </button>
                ))}
              </div>
            );
          })()}

          <div className="grid gap-6 flex-1 min-h-[320px] grid-rows-1 grid-cols-3">
            {([
              { key: 'overdue',     label: '逾期警告', dot: 'bg-red-500',    bg: 'bg-white', border: 'border-slate-200', lBorder: 'border-l-red-500',    btn: 'bg-red-500 hover:bg-red-600' },
              { key: 'unprocessed', label: '未处理',   dot: 'bg-slate-400',  bg: 'bg-white', border: 'border-slate-200', lBorder: 'border-l-slate-400',  btn: 'bg-slate-900 hover:bg-slate-800' },
              { key: 'done',        label: '已处理',   dot: 'bg-emerald-500', bg: 'bg-white', border: 'border-slate-200', lBorder: 'border-l-emerald-400', btn: 'bg-slate-200 hover:bg-slate-300 !text-slate-600' },
            ] as const).map(col => {
              const colCards = filteredCards.filter(c => {
                if (myTypeFilter && (c.meeting_type || '') !== myTypeFilter) return false;
                // 仅看我的任务
                const isMine = currentUser?.name ? (c.owner === currentUser.name || c.ownerLoginId === currentUser.loginid) : false;
                if (!isMine) return false;
                // 与全部任务口径一致：逾期警告 / 未处理 / 已处理
                if (col.key === 'overdue') {
                  return (c as any).oa_score == null && c.status !== 'done' && c.status !== 'blocked'
                    && c.due_date && (c.due_date_type || 'date') === 'date' && new Date(c.due_date) < today;
                }
                if (col.key === 'unprocessed') {
                  const k = toColKey(c);
                  if (k !== 'unprocessed') return false;
                  const isOverdue = c.due_date && (c.due_date_type || 'date') === 'date' && new Date(c.due_date) < today;
                  return !isOverdue;
                }
                return toColKey(c) === 'done';
              });
              const expandKey = `my-${col.key}`;
              const visibleCards = col.key === 'unprocessed' ? getVisibleCards(colCards, expandKey, DEFAULT_COLLAPSED_CARD_COUNT) : colCards;
              return (
                <div key={col.key} className={`flex flex-col rounded-[24px] border ${col.border} ${col.bg} overflow-hidden shadow-sm`}>
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/70">
                    <span className={`w-2.5 h-2.5 rounded-full ${col.dot}`} />
                    <span className="text-sm font-semibold text-slate-700">{col.label}</span>
                    <span className="ml-auto text-xs text-slate-400 bg-white/90 px-2 py-0.5 rounded-full border border-slate-200/60">{colCards.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {visibleCards.map(card => {
                      const today0 = new Date(); today0.setHours(0,0,0,0);
                      const dueD = card.due_date ? new Date(card.due_date.slice(0,10)) : null;
                      const daysLeft = dueD ? Math.ceil((dueD.getTime() - today0.getTime()) / 86400000) : null;
                      const isOD = daysLeft !== null && daysLeft < 0 && col.key !== 'done' && (card.due_date_type || 'date') === 'date';
                      return (
                        <div key={card.id} className={`${card.due_date_type === 'continuous'
                            ? 'bg-blue-50/70 border-blue-300 border-l-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.15)]'
                            : 'bg-slate-50/65 border-slate-200'
                          } rounded-2xl border border-l-4 ${card.due_date_type === 'continuous' ? 'border-l-blue-500' : col.lBorder} shadow-sm hover:shadow-md transition-all p-3.5`}>
                          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                            {card.due_date_type === 'continuous' && (
                              col.key === 'done' && reportedThisCycle(card) ? (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold border border-emerald-200">✓ 本周期已填报 {progressMap[card.id]?.cycleDate?.slice(5)}</span>
                              ) : col.key === 'done' ? (
                                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">🔄 持续执行</span>
                              ) : (
                                (() => {
                                  const cl = cycleLabelOf(card);
                                  // 未处理列：已推送 → 蓝色"本期待填报"；未推送 → 灰色"<类别> · 持续执行"
                                  return cl.hasCycle ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-600 text-white font-bold shadow-sm">🔄 {cl.label}</span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">🔄 {cl.label}</span>
                                  );
                                })()
                              )
                            )}
                            {/* 部门+优先级联合标签 */}
                          <div className="flex items-center gap-1">
                              {card.dept && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                                  {card.dept}
                                </span>
                              )}
                            </div>
                            {isOD && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium flex items-center gap-0.5">
                                <AlertTriangle className="w-2.5 h-2.5" />超期{Math.abs(daysLeft!)}天
                              </span>
                            )}
                            {daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 && col.key !== 'done' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                                {daysLeft === 0 ? '今日到期' : `还剩${daysLeft}天`}
                              </span>
                            )}
                          </div>
                          <p className={`text-sm leading-snug mb-3 ${col.key === 'done' ? 'text-slate-400' : 'text-slate-800 font-medium'}`}>
                            {card.description}
                          </p>
                          <div className="space-y-1 mb-3">
                            {card.due_date && (card.due_date_type || 'date') === 'date' && (
                              <div className={`flex items-center gap-1 text-[11px] ${isOD ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                                <Calendar className="w-3 h-3" /> {card.due_date.slice(0,10)}
                              </div>
                            )}
                            {(card.due_date_type === 'tbd' || (!card.due_date && card.due_date_type !== 'continuous')) && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">❓ 待定</span>
                            )}
                            {card.meeting_title && (
                              <button onClick={() => card.meeting_id && router.push(`/meeting/${card.meeting_id}`)}
                                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-500 transition-colors max-w-full">
                                <FileText className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{card.meeting_title}</span>
                              </button>
                            )}
                          </div>
                          {(() => {
                            // 持续项：优先显示周期填报内容；普通项：显示 oa_result
                            if (card.due_date_type === 'continuous') {
                              const pr = progressMap[card.id];
                              if (pr?.progress) {
                                return (
                                  <div className="mb-2.5 p-2 bg-blue-50/60 rounded-lg border border-blue-100 text-[11px] text-slate-600 line-clamp-2">
                                    <span className="text-slate-400">最近填报（{pr.cycleDate?.slice(5)}）：</span>{pr.progress}
                                  </div>
                                );
                              }
                              return null;
                            }
                            const display = getDisplayOaResult((card as any).oa_result);
                            return display ? (
                              <div className="mb-2.5 p-2 bg-slate-50 rounded-lg border border-slate-100 text-[11px] text-slate-600 line-clamp-2">
                                <span className="text-slate-400">上次汇报：</span>{display}
                              </div>
                            ) : null;
                          })()}
                          <div className="flex items-center justify-end pt-1">
                            <button
                              onClick={() => openResult(card)}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all ${
                                col.key === 'done'
                                  ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                  : col.key === 'overdue'
                                    ? 'border-red-200 bg-white text-red-600 hover:bg-red-50'
                                    : 'border-blue-200 bg-white text-blue-600 hover:bg-blue-50'
                              }`}
                            >
                              <Pencil className="h-3 w-3" />
                              {col.key === 'done' ? '查看 / 修改汇报' : '汇报进展'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {colCards.length === 0 && (
                      <div className="flex flex-col items-center justify-center h-24 text-slate-300 text-xs gap-2 pt-4">
                        <CheckCircle2 className="w-8 h-8 opacity-30" />
                        <span>暂无{col.label}任务</span>
                      </div>
                    )}
                    {col.key === 'unprocessed' && colCards.length > DEFAULT_COLLAPSED_CARD_COUNT && (
                      <button
                        onClick={() => toggleExpandedCol(expandKey)}
                        className="w-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-500 hover:border-slate-300 hover:bg-slate-100"
                      >
                        {expandedCols.has(expandKey)
                          ? '收起多余任务'
                          : `还有 ${colCards.length - DEFAULT_COLLAPSED_CARD_COUNT} 条待处理，点击展开`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 看板列（全部任务 + 群体项视图共用：群体项复用三列看板，过滤已在 filteredCards 完成） */}
      {viewType === 'board' && (viewMode === 'all' || viewMode === 'group') && (
      <div className="grid gap-5 flex-1 min-h-[320px] grid-rows-1 grid-cols-3">
        {COLUMNS.map(col => {
          const colCards = getColumnCards(col.key);
          const isOver = dragOverCol === col.key;
          const expandKey = `all-${col.key}`;
          const visibleCards = getVisibleCards(colCards, expandKey, DEFAULT_COLLAPSED_CARD_COUNT);
          return (
            <div
              key={col.key}
              className={`flex flex-col rounded-[24px] border transition-all ${
                isOver
                  ? 'border-blue-300 bg-blue-50/70 shadow-md'
                  : `border-slate-200 bg-white`
              }`}
              onDragOver={e => { e.preventDefault(); setDragOverCol(col.key); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={() => handleDrop(col.key)}
            >
              {/* 列头 */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/70">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className={`text-sm font-semibold ${col.color}`}>{col.label}</span>
                {(() => {
                  const overdueCount = col.key === 'unprocessed'
                    ? colCards.filter(c => c.due_date && new Date(c.due_date) < today).length : 0;
                  return overdueCount > 0 ? (
                    <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold leading-none" title={`${overdueCount}项已超期`}>
                      {overdueCount}
                    </span>
                  ) : null;
                })()}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-slate-400 bg-white/80 px-1.5 py-0.5 rounded-full border border-slate-200">
                    {colCards.length}
                  </span>
                  {colCards.length > DEFAULT_COLLAPSED_CARD_COUNT && !dragId && (
                    col.key === 'overdue' ? (
                      <button
                        onClick={() => setOverdueDialogOpen(true)}
                        className="text-[11px] font-semibold text-red-600 hover:text-red-700 whitespace-nowrap"
                      >
                        查看剩余 {colCards.length - DEFAULT_COLLAPSED_CARD_COUNT}
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleExpandedCol(expandKey)}
                        className={`text-[11px] font-semibold whitespace-nowrap ${
                          col.key === 'done'
                            ? 'text-emerald-600 hover:text-emerald-700'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {expandedCols.has(expandKey)
                          ? '收起'
                          : `查看剩余 ${colCards.length - DEFAULT_COLLAPSED_CARD_COUNT}`}
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* 卡片区域 */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {visibleCards.map((card: KanbanCard) => {
                  const isDragging = dragId === card.id;
                  const isMyCard = (currentUser?.name && card.owner === currentUser.name) ||
                    (currentUser?.loginid && card.ownerLoginId === currentUser.loginid);
                  // 截止日期色彩判定
                  const today0 = new Date(); today0.setHours(0,0,0,0);
                  const dueD = card.due_date ? new Date(card.due_date.slice(0,10)) : null;
                  const daysLeft = dueD ? Math.ceil((dueD.getTime() - today0.getTime()) / 86400000) : null;
                  const colKey = toColKey(card);
                  const isOverdue = daysLeft !== null && daysLeft < 0 && colKey !== 'done' && colKey !== 'verified' && (card.due_date_type || 'date') === 'date';
                  const isDueSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 && colKey !== 'done' && colKey !== 'verified';
                  return (
                    <div
                      key={card.id}
                      draggable={currentUser?.role !== 'employee'}
                      onDragStart={() => currentUser?.role !== 'employee' && handleDragStart(card.id)}
                      onDragEnd={handleDragEnd}
                      className={`group relative rounded-2xl border p-3 ${currentUser?.role !== 'employee' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} transition-all select-none ${
                        isDragging ? 'opacity-50 scale-95 shadow-lg'
                        : isOverdue ? 'border-red-200 bg-red-50/40 shadow-sm shadow-red-100'
                        : isDueSoon ? 'border-amber-200 bg-amber-50/40'
                        : colKey === 'done' ? 'border-emerald-200 bg-emerald-50/30'
                        : colKey === 'verified' ? 'border-blue-200 bg-blue-50/25'
                        : isMyCard ? 'border-blue-200 bg-blue-50/20 ring-1 ring-blue-100'
                        : 'border-slate-200 bg-slate-50/65 hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      {colKey === 'done' && (
                        <div className="flex items-center gap-1.5 mb-2 p-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                          <span className="text-[11px] text-emerald-700">
                            {card.completed_by && <span className="font-medium">{card.completed_by}</span>}
                            {card.completed_at && <span className="text-emerald-500 ml-1">{formatTime(card.completed_at)}</span>}
                            {!card.completed_by && !card.completed_at && '已处理'}
                          </span>
                        </div>
                      )}
                      {colKey === 'verified' && (
                        <div className="flex items-center gap-1.5 mb-2 p-1.5 bg-blue-50 rounded-lg border border-blue-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          <span className="text-xs text-blue-700 font-medium">已勾稽</span>
                        </div>
                      )}
                      {/* 未处理列内展示实际子状态 */}
                      {colKey === 'unprocessed' && (card.status === 'in_progress' || card.status === 'blocked') && (
                        <div className={`flex items-center gap-1.5 mb-2 p-1.5 rounded-lg border ${
                          card.status === 'blocked' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'
                        }`}>
                          {card.status === 'blocked'
                            ? <Ban className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                            : <Clock className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                          <span className={`text-xs font-medium ${
                            card.status === 'blocked' ? 'text-red-600' : 'text-blue-700'
                          }`}>
                            {card.status === 'blocked'
                              ? `未完成${card.block_reason ? '：' + card.block_reason.slice(0, 20) : ''}`
                              : '进行中'}
                          </span>
                        </div>
                      )}

                      {/* 拖拽手柄 + 任务描述 */}
                      <div className="flex items-start gap-2 pr-16">
                        <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <p className={`text-sm leading-snug flex-1 ${card.status === 'done' ? 'text-slate-400' : 'text-slate-800'}`}>
                          {card.description}
                        </p>
                      </div>

                      {/* 元信息行 */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {/* 部门+优先级联合标签 */}
                        <div className="flex items-center gap-1">
                          {card.dept && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 font-medium">
                              {card.dept}
                            </span>
                          )}
                        </div>

                        {card.owner ? (
                          <span className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border ${
                            isMyCard ? 'text-blue-600 bg-blue-50 border-blue-200 font-medium' : 'text-slate-500 bg-slate-50 border-slate-200'
                          }`}>
                            <User className="w-2.5 h-2.5" />
                            {card.owner}
                            {isMyCard && <span className="text-[9px]">（我）</span>}
                            <ConfidenceDot value={card.confidence_owner} />
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] text-red-500">
                            <User className="w-2.5 h-2.5" /> 未指定
                          </span>
                        )}

                        {card.due_date ? (
                          <span className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full border ${
                            isOverdue ? 'text-red-600 bg-red-50 border-red-200 font-medium' :
                            isDueSoon ? 'text-amber-600 bg-amber-50 border-amber-200 font-medium' :
                            'text-slate-500 bg-slate-50 border-slate-200'
                          }`}>
                            <Calendar className="w-2.5 h-2.5" />
                            {card.due_date.slice(0,10)}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Clock className="w-2.5 h-2.5" /> 无截止日
                          </span>
                        )}
                      </div>

                      {/* OA 回传结果（过滤导入元数据） */}
                      {getDisplayOaResult((card as any).oa_result) && (
                        <div className="mt-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 line-clamp-2">
                          <span className="text-slate-400">OA回传：</span>{getDisplayOaResult((card as any).oa_result)}
                        </div>
                      )}
                      {/* 完成说明 */}
                      {colKey === 'done' && card.completion_note && (
                        <div className="mt-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1">
                          <span className="text-slate-400">处理结果：</span>{card.completion_note}
                        </div>
                      )}
                      {/* 附件 */}
                      {colKey === 'done' && card.evidence_files && card.evidence_files.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {card.evidence_files.map((f, i) => (
                            <span key={i} className="flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded">
                              <Paperclip className="w-2.5 h-2.5" />{f}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 操作按钮：编辑仅限管理角色，处理通过OA回传 */}
                      <div className="absolute right-3 top-3 z-10 flex gap-1.5 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
                         {colKey === 'unprocessed' && (currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'secretary') && (
                           <button
                             onClick={() => openEdit(card)}
                             className="flex items-center justify-center gap-1 text-xs text-slate-600 bg-white/95 hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg shadow-sm transition-colors"
                           >
                             <Pencil className="w-3 h-3" /> 编辑
                           </button>
                         )}
                       </div>

                       {/* 来源会议 */}
                       {card.meeting_title && (
                         <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1">
                           <button
                             onClick={() => card.meeting_id && router.push(`/meeting/${card.meeting_id}`)}
                             className="text-[10px] text-slate-400 hover:text-blue-500 truncate flex items-center gap-0.5 transition-colors"
                           >
                             <FileText className="w-2.5 h-2.5" />
                             {card.meeting_title}
                           </button>
                           {card.confirmed_by && card.status !== 'done' && (
                             <span className="ml-auto text-[10px] text-blue-500 flex items-center gap-0.5 flex-shrink-0">
                               <User className="w-2.5 h-2.5" /> {card.confirmed_by} 确认
                             </span>
                           )}
                         </div>
                       )}

                       {/* 群体项视图：复刻「我的任务」卡片——最近填报展示 + 代填汇报按钮（管理员代填场景） */}
                       {viewMode === 'group' && card.due_date_type === 'continuous' && (() => {
                         const pr = progressMap[card.id];
                         return pr?.progress ? (
                           <div className="mt-1.5 p-2 bg-blue-50/60 rounded-lg border border-blue-100 text-[11px] text-slate-600 line-clamp-2">
                             <span className="text-slate-400">最近填报（{pr.cycleDate?.slice(5)}）：</span>{pr.progress}
                           </div>
                         ) : null;
                       })()}
                       {viewMode === 'group' && (
                         <div className="mt-2 flex items-center justify-end">
                           <button
                             onClick={() => openResult(card)}
                             className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all ${
                               colKey === 'done'
                                 ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                 : 'border-violet-200 bg-white text-violet-600 hover:bg-violet-50'
                             }`}
                           >
                             <Pencil className="h-3 w-3" />
                             {colKey === 'done' ? '查看 / 修改汇报' : '代填汇报'}
                           </button>
                         </div>
                       )}
                     </div>
                   );
                 })}


                {/* 空状态 */}
                {colCards.length === 0 && !dragId && (
                  <div className="flex flex-col items-center justify-center h-24 text-slate-300 text-xs gap-1.5">
                    <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span>拖拽卡片到此处</span>
                  </div>
                )}

                {/* 拖拽放置提示 */}
                {dragId && isOver && (
                  <div className="flex items-center justify-center h-16 border-2 border-dashed border-blue-300 rounded-2xl bg-blue-50 text-blue-500 text-xs font-medium gap-2">
                    <ArrowRight className="w-3.5 h-3.5" />
                    放置到此列
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* 汇报进展弹窗 */}
      {resultItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setResultItem(null); }}>
          <div className="bg-white w-full sm:w-[540px] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            <div className={`h-1.5 w-full ${resultItem.due_date_type === 'continuous' ? 'bg-gradient-to-r from-blue-400 to-indigo-500' : resultForm.status === 'done' ? 'bg-gradient-to-r from-emerald-400 to-green-500' : resultForm.status === 'blocked' ? 'bg-gradient-to-r from-red-400 to-rose-500' : 'bg-gradient-to-r from-blue-400 to-indigo-500'}`} />
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">汇报进展</h2>
                <p className="text-xs text-slate-400 mt-0.5">填写后自动同步到台账评分</p>
              </div>
              <button onClick={() => setResultItem(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="mx-6 mb-4 p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5"><FileText className="w-3.5 h-3.5 text-blue-600" /></div>
              <div className="min-w-0">
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">任务内容</div>
                <div className="text-xs text-slate-700 leading-relaxed line-clamp-3">{resultItem.description}</div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-2">
              {resultItem.due_date_type !== 'continuous' && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-2.5">处理结果</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'done',        label: '已完成', emoji: '✅', activeBg: 'bg-emerald-500', border: 'border-emerald-300', bg: 'bg-emerald-50', text: 'text-emerald-700' },
                      { value: 'blocked',     label: '未完成', emoji: '🚫', activeBg: 'bg-red-500',     border: 'border-red-300',     bg: 'bg-red-50',     text: 'text-red-700' },
                    ].map(opt => (
                      <button key={opt.value} onClick={() => setResultForm(f => ({ ...f, status: opt.value }))}
                        className={`py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                          resultForm.status === opt.value
                            ? `${opt.activeBg} border-transparent text-white shadow-md scale-[1.02]`
                            : `${opt.bg} ${opt.border} ${opt.text} hover:scale-[1.01]`
                        }`}>
                        <span className="text-lg">{opt.emoji}</span>
                        <span className="text-xs font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {resultItem.due_date_type !== 'continuous' && resultForm.status === 'blocked' && (
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
              {/* 持续项：先选本期是否有完成情况；无 → 免填说明与附件 */}
              {resultItem.due_date_type === 'continuous' && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-2.5">本期是否有完成情况？</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'none', label: '无进展', note: '本期无事发生，免填', activeBg: 'bg-slate-500', border: 'border-slate-300', bg: 'bg-slate-50', text: 'text-slate-600' },
                      { value: 'has',   label: '有进展', note: '需填说明 + 附截图',  activeBg: 'bg-blue-500',  border: 'border-blue-300', bg: 'bg-blue-50', text: 'text-blue-700' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setResultNone(opt.value === 'none')}
                        className={`py-2.5 rounded-xl border-2 flex flex-col items-center gap-0.5 transition-all ${
                          (opt.value === 'none') === resultNone
                            ? `${opt.activeBg} border-transparent text-white shadow-md scale-[1.02]`
                            : `${opt.bg} ${opt.border} ${opt.text} hover:scale-[1.01]`
                        }`}
                      >
                        <span className="text-sm font-semibold">{opt.label}</span>
                        <span className="text-[10px] opacity-70">{opt.note}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(resultItem.due_date_type !== 'continuous' || !resultNone) && (<>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-slate-500">{resultItem.due_date_type === 'continuous' ? '进展说明' : '处理说明'} <span className="text-red-400">*</span></div>
                  <div className="text-[10px] text-slate-300">{resultForm.text.length}/500</div>
                </div>
                <textarea rows={4} autoFocus value={resultForm.text}
                  onChange={e => setResultForm(f => ({ ...f, text: e.target.value.slice(0, 500) }))}
                  className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 resize-none placeholder:text-slate-300 transition-all"
                  placeholder={resultItem.due_date_type === 'continuous' ? '描述本周/本期进展、完成情况...' : resultForm.status === 'done' ? '描述完成情况、成果...' : resultForm.status === 'blocked' ? '说明未完成原因、需要的支持...' : '描述当前进展、下一步计划...'}
                />
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">图片附件 <span className="text-red-400">*</span> <span className="text-slate-300 font-normal">（截图、证明材料等，至少上传 1 张）</span></div>
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer group"
                  onClick={() => document.getElementById('kanban-img-upload')?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); setResultImages(prev => [...prev, ...Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))]); }}>
                  <input id="kanban-img-upload" type="file" accept="image/*" multiple className="hidden"
                    onChange={e => setResultImages(prev => [...prev, ...Array.from(e.target.files || [])])} />
                  <div className="text-2xl mb-1">🖼️</div>
                  <div className="text-xs text-slate-400 group-hover:text-blue-500 transition-colors">点击上传 / 拖拽图片 / <b>Ctrl+V 粘贴微信QQ截图</b></div>
                  <div className="text-[10px] text-slate-300 mt-0.5">支持 JPG · PNG · GIF · WebP</div>
                </div>
                {resultImages.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {resultImages.map((f, i) => (
                      <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group">
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => setResultImages(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <div className="aspect-square rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all" onClick={() => document.getElementById('kanban-img-upload')?.click()}>
                      <span className="text-slate-300 text-xl">+</span>
                    </div>
                  </div>
                )}
              </div>
              </>)}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 mt-2">
              <button onClick={() => setResultItem(null)} className="px-5 h-10 border border-slate-200 text-slate-500 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">取消</button>
              <button
                onClick={async () => {
                  const isCont = resultItem.due_date_type === 'continuous';
                  const isNone = isCont && resultNone; // 持续项选「无进展」：免填说明与附件
                  // 未完成必须填下次完成时间
                  if (!isCont && resultForm.status === 'blocked' && !nextDueDate) {
                    alert('请选择下次完成时间');
                    return;
                  }
                  if (!isNone) {
                    // 处理说明/进展说明必填
                    if (!resultForm.text.trim()) {
                      alert(isCont ? '请填写进展说明' : '请填写处理说明');
                      return;
                    }
                    // 图片附件必填（至少 1 张）——持续项选「有进展」同样需要证明截图
                    if (resultImages.length === 0) {
                      alert('请至少上传 1 张图片附件（截图、证明材料等）');
                      return;
                    }
                  }
                  setResultSubmitting(true);
                  try {
                    const imageUrls: string[] = [];
                    if (!isNone) {
                      for (const file of resultImages) {
                        const fd = new FormData(); fd.append('file', file); fd.append('type', 'image');
                        const r = await fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
                        if (r.success) imageUrls.push(r.url);
                      }
                    }
                    await fetch(`/api/actions/${resultItem.id}`, {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        // 持续项「无进展」：内容统一为"无"，后台据此打 is_none 标记（不计有进展统计）
                        oa_result: isNone ? '无' : resultForm.text,
                        oa_result_at: new Date().toISOString(),
                        // 持续项：不设处理结果，状态保持进行中，不写 oa_score
                        oa_none: isCont ? resultNone : undefined,
                        ...(isCont
                          ? { status: 'in_progress' }
                          : { oa_score: resultForm.status === 'done' ? 1 : resultForm.status === 'blocked' ? -1 : undefined, status: resultForm.status,
                              next_due_date: resultForm.status === 'blocked' ? nextDueDate : undefined }),
                        oa_auto_detected: false,
                        // 「无进展」不保留历史附件，避免误导为有内容
                        oa_attachments: isNone ? [] : (imageUrls.length > 0 ? imageUrls : ((resultItem as any).oa_attachments || [])),
                      }),
                    });
                    setResultItem(null); loadActions();
                  } finally { setResultSubmitting(false); }
                }}
                disabled={resultSubmitting}
                className={`flex-1 h-10 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 ${
                  resultItem.due_date_type === 'continuous' ? 'bg-blue-600 hover:bg-blue-700' :
                  resultForm.status === 'done' ? 'bg-emerald-500 hover:bg-emerald-600' :
                  resultForm.status === 'blocked' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {resultSubmitting ? <span className="flex items-center justify-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" />提交中...</span>
                  : resultItem.due_date_type === 'continuous' ? (resultNone ? '提交无进展' : '更新进展')
                  : resultForm.status === 'done' ? '标记完成' : resultForm.status === 'blocked' ? '标记未完成' : '更新进展'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 编辑对话框 ── */}
      <Dialog open={overdueDialogOpen} onOpenChange={setOverdueDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              全部逾期任务
              <span className="text-xs font-normal text-slate-400">{overdueCards.length} 条</span>
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5">
              <div className="text-[11px] text-red-500">高优先级</div>
              <div className="mt-0.5 text-base font-semibold text-red-700">{overdueSummary.high}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
              <div className="text-[11px] text-amber-500">中优先级</div>
              <div className="mt-0.5 text-base font-semibold text-amber-700">{overdueSummary.medium}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
              <div className="text-[11px] text-emerald-500">低优先级</div>
              <div className="mt-0.5 text-base font-semibold text-emerald-700">{overdueSummary.low}</div>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5">
              <div className="text-[11px] text-blue-500">我的逾期</div>
              <div className="mt-0.5 text-base font-semibold text-blue-700">{overdueSummary.mine}</div>
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            已按“超期天数优先，其次优先级高低”排序。
          </div>
          <div className="max-h-[72vh] overflow-y-auto space-y-2 py-1">
            {overdueCardsSorted.map(card => {
              const today0 = new Date(); today0.setHours(0, 0, 0, 0);
              const dueD = card.due_date ? new Date(card.due_date.slice(0, 10)) : null;
              const daysLeft = dueD ? Math.ceil((dueD.getTime() - today0.getTime()) / 86400000) : null;
              const isMyCard = (currentUser?.name && card.owner === currentUser.name) ||
                (currentUser?.loginid && card.ownerLoginId === currentUser.loginid);
              return (
                <div key={card.id} className="rounded-xl border border-red-200 bg-red-50/30 p-3">
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5">
                      <AlertTriangle className="w-3 h-3 text-red-500" />
                      <span className="text-[11px] font-medium text-red-600">超期 {Math.abs(daysLeft || 0)} 天</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-5 text-slate-800 line-clamp-2">{card.description}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {card.owner ? (
                          <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                            isMyCard ? 'text-blue-600 bg-blue-50 border-blue-200 font-medium' : 'text-slate-500 bg-white border-slate-200'
                          }`}>
                            <User className="w-2.5 h-2.5" />
                            {card.owner}
                            {isMyCard && <span className="text-[9px]">（我）</span>}
                          </span>
                        ) : null}
                        {card.due_date ? (
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-red-200 bg-white text-red-600 font-medium">
                            <Calendar className="w-2.5 h-2.5" />
                            {card.due_date.slice(0, 10)}
                          </span>
                        ) : null}
                        {card.meeting_title ? (
                          <button
                            onClick={() => card.meeting_id && router.push(`/meeting/${card.meeting_id}`)}
                            className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-500"
                          >
                            <FileText className="w-2.5 h-2.5" />
                            {card.meeting_title}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editCard} onOpenChange={open => !open && setEditCard(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>编辑行动项</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">任务描述</label>
              <textarea
                value={editForm.description}
                onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <label className="text-xs text-slate-500 mb-1 block">负责人</label>
                <OwnerSearchPicker
                  value={editForm.owner}
                  orgEmployees={orgEmployees}
                  onChange={name => setEditForm(f => ({ ...f, owner: name }))}
                />
              </div>
              <div className="relative">
                <label className="text-xs text-slate-500 mb-1 block">提出人</label>
                <OwnerSearchPicker
                  value={editForm.proposer}
                  orgEmployees={orgEmployees}
                  onChange={name => setEditForm(f => ({ ...f, proposer: name }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">截止日期</label>
                <Input type="date" value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">优先级</label>
              <div className="flex gap-2">
                {(['high', 'medium', 'low'] as const).map(p => (
                  <button key={p} onClick={() => setEditForm(f => ({ ...f, priority: p }))}
                    className={`flex-1 py-1.5 text-xs rounded-lg border font-semibold transition-colors ${editForm.priority === p ? PRIORITY_COLOR[p] : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    {PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setEditCard(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">取消</button>
            <button onClick={submitEdit} disabled={!editForm.description.trim()} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> 保存
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 完成对话框 ── */}
      <Dialog open={!!doneCard} onOpenChange={open => !open && setDoneCard(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> 确认完成</DialogTitle></DialogHeader>
          {doneCard && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2">{doneCard.description}</p>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">完成说明 <span className="text-slate-400">（可选）</span></label>
                <textarea
                  value={doneNote}
                  onChange={e => setDoneNote(e.target.value)}
                  rows={3}
                  placeholder="描述完成情况、交付物、注意事项..."
                  className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">上传证据文件 <span className="text-slate-400">（可选）</span></label>
                <div
                  ref={dropZoneRef}
                  onDragOver={handleFileDragOver}
                  onDragLeave={handleFileDragLeave}
                  onDrop={handleFileDrop}
                  onPaste={handlePaste}
                  tabIndex={0}
                  className={`border-2 border-dashed rounded-lg p-4 transition-colors outline-none focus:border-purple-400 ${
                    isDragging ? 'border-purple-400 bg-purple-50' : pasteHint ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <button onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors">
                      <Paperclip className="w-3.5 h-3.5" /> 选择文件
                    </button>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileAdd} />
                    <ScreenshotCapture onCapture={handleScreenshotCapture} />
                    {pasteHint ? (
                      <span className="text-xs text-emerald-600 font-medium">✓ 已粘贴图片</span>
                    ) : (
                      <span className="text-xs text-slate-400">
                        可拖拽上传 / 点此区域后 <kbd className="bg-slate-100 border border-slate-300 rounded px-1 font-mono">Ctrl+V</kbd> 粘贴截图
                      </span>
                    )}
                  </div>
                  {doneFiles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {doneFiles.map((f, i) => {
                        const isImage = f.type.startsWith('image/');
                        const previewUrl = isImage ? URL.createObjectURL(f) : null;
                        return (
                          <div key={i} className="relative group">
                            {isImage ? (
                              <img
                                src={previewUrl!}
                                alt={f.name}
                                className="w-16 h-16 object-cover rounded-lg border border-slate-200"
                              />
                            ) : (
                              <div className="flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-full">
                                <Paperclip className="w-2.5 h-2.5" />{f.name}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                if (previewUrl) URL.revokeObjectURL(previewUrl);
                                setDoneFiles(prev => prev.filter((_, j) => j !== i));
                              }}
                              className="absolute -top-1 -right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <button onClick={() => setDoneCard(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">取消</button>
            <button onClick={submitDone} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> 确认完成
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 未完成登记对话框 ── */}
      <Dialog open={!!blockCard} onOpenChange={open => { if (!open) { setBlockCard(null); setPendingBlockDragId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Ban className="w-4 h-4 text-red-500" /> 登记未完成原因</DialogTitle></DialogHeader>
          {blockCard && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2">{blockCard.description}</p>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">未完成原因 <span className="text-red-500">*必填</span></label>
                <textarea
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  rows={4}
                  placeholder="说明具体未完成原因，方便后续复盘探讨..."
                  className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
                  autoFocus
                />
                {!blockReason.trim() && <p className="text-[11px] text-red-500 mt-1">请填写未完成原因，复盘时需要用到</p>}
              </div>
            </div>
          )}
          <DialogFooter>
            <button onClick={() => { setBlockCard(null); setPendingBlockDragId(null); }} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">取消</button>
            <button onClick={submitBlock} disabled={!blockReason.trim()}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" /> 确认未完成
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建任务批次弹窗 */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowBatchModal(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-slate-800">新建任务</h2>
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
                  <button
                    onClick={() => setBatchRows(prev => [...prev, { description: '', owner: '', proposer: '', dueDate: new Date().toISOString().slice(0, 10), dueDateType: 'date', priority: 'medium' }])}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  ><Plus className="w-3 h-3" /> 添加一行</button>
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
                onClick={async () => {
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
                      setBatchTitle('');
                      setBatchChannel('wechat');
                      setBatchRows([{ description: '', owner: '', proposer: '', dueDate: new Date().toISOString().slice(0, 10), dueDateType: 'date', priority: 'medium' }]);
                      router.push(`/batch/${r.data.batch.id}`);
                    } else { alert(r.error || '创建失败'); }
                  } finally { setBatchSubmitting(false); }
                }}
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
