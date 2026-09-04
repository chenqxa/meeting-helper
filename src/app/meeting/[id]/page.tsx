'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  Download, Search, Lock, Check, Clock, User, Calendar, FileText, Sparkles,
  AlertTriangle, Plus, Trash2, ChevronLeft, RefreshCw, FolderOpen,
  CheckCircle2, Shield, Eye, Network, GitBranch, X, History, Copy, Send, Pencil,
  CalendarClock, Flag
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MeetingMindMap } from '@/components/mindmap/meeting-mindmap';
import { SummaryActionSplit } from '@/components/summary-action-split';
import MeetingRecorder from '@/components/meeting-recorder';
import { OperationLog } from '@/components/operation-log';

interface ActionItem {
  id: string;
  dbId?: string | null;
  originalId?: string | null;
  description: string;
  owner?: string | null;
  ownerLoginId?: string | null;  // OA loginid
  ownerOaId?: string | null;     // OA 数字 ID
  dept?: string | null;
  proposer?: string | null;
  proposerLoginId?: string | null;
  proposerOaId?: string | null;
  due_date?: string | null;
  due_date_type?: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'confirmed' | 'in_progress' | 'done' | 'blocked';
  confidence_owner: number;
  confidence_date: number;
  source_sentence?: string;
  initial_result?: string | null;
  evidence_files?: string[];
  confirmed_by?: string;
  confirmed_at?: string;
}

const normalizeName = (name?: string | null): string => {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const garbledMap: Record<string, string> = {
    '褰撳墠鐢ㄦ埛': '当前用户',
  };
  return garbledMap[trimmed] ?? trimmed;
};

interface OAUser {
  oaId?: string;
  loginid: string;
  name: string;
  dept?: string;
}

interface SummarySection {
  section_type: 'agenda' | 'conclusion' | 'risk' | 'decision' | 'next_step';
  content: string;
  confidence: number;
}

interface Meeting {
  id: string;
  title: string;
  type: string;
  meeting_time?: string;
  meeting_date?: string;
  meetingDate?: string;
  status: 'draft' | 'locked' | 'archived' | 'review';
  organizer?: string;
  participants?: string[];
  content?: string;
  input_content?: string;
  transcript?: string;
  locked_version?: number;
  summary?: any;
  minutes?: any;
}

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
};
const SECTION_LABEL: Record<string, string> = {
  agenda: '议题', conclusion: '结论', risk: '风险', decision: '决策', next_step: '下一步',
};
const SECTION_COLOR: Record<string, string> = {
  agenda: 'text-blue-700 bg-blue-50 border-blue-200',
  conclusion: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  risk: 'text-red-700 bg-red-50 border-red-200',
  decision: 'text-purple-700 bg-purple-50 border-purple-200',
  next_step: 'text-amber-700 bg-amber-50 border-amber-200',
};

function OAUserPicker({ value, onSelect, onChange, placeholder }: {
  value: string;
  onSelect: (u: OAUser) => void;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<OAUser[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    setQuery(q);
    onChange(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/oa/users?keyword=${encodeURIComponent(q)}`);
        const d = await r.json();
        if (d.success && d.data?.length) { setResults(d.data); setOpen(true); }
        else { setResults([]); setOpen(false); }
      } catch { setResults([]); setOpen(false); }
    }, 300);
  };

  return (
    <div className="relative flex-1">
      <Input
        placeholder={placeholder || '负责人（输入搜索OA用户）'}
        value={query}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => search(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="h-7 text-xs"
      />
      {open && results.length > 0 && (
        <div className="absolute top-8 left-0 right-0 z-50 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {results.map((u) => (
            <button
              key={u.loginid}
              type="button"
              onMouseDown={() => { onSelect(u); setQuery(u.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between"
            >
              <span className="font-medium">{u.name}</span>
              <span className="text-slate-400">{u.dept || u.loginid}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 前端临时行动项 id：时间戳+自增序+随机段，快速连点不撞 key；服务端以其为 originalId 落台账
let tmpActionSeq = 0;
const nextTempActionId = () =>
  `new-${Date.now().toString(36)}-${(++tmpActionSeq).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// 行内可编辑文本：点击变输入框，失焦/回车提交，Esc 取消
function ContentEditableText({ value, onCommit, readOnly, className }: {
  value: string; onCommit: (v: string) => void; readOnly?: boolean; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const commit = () => { setEditing(false); onCommit(draft.trim()); };
  if (readOnly) return <p className={className}>{value}</p>;
  if (!editing) return (
    <p className={`${className} cursor-text rounded px-1 -mx-1 hover:bg-slate-100/60`} onClick={() => setEditing(true)}>{value || <span className="text-slate-300">点击编辑…</span>}</p>
  );
  return (
    <textarea
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setEditing(false); setDraft(value); }
      }}
      rows={2}
      className={`${className} bg-white border border-blue-300 rounded px-1 -mx-1 outline-none ring-2 ring-blue-100 resize-none`}
    />
  );
}

// 行内人员字段：胶囊样式，点击变搜索输入，选人即保存
function InlineUserField({ icon, label, value, placeholder, tone, readOnly, onPick }: {
  icon: React.ReactNode; label: string; value: string; placeholder: string;
  tone: 'blue' | 'violet'; readOnly?: boolean;
  onPick: (name: string, extra: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<OAUser[]>([]);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (!editing) setQuery(value); }, [value, editing]);
  const toneCls = tone === 'blue'
    ? 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100'
    : 'text-violet-600 bg-violet-50 border-violet-200 hover:bg-violet-100';
  const search = (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    if (timer) clearTimeout(timer);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/oa/users?keyword=${encodeURIComponent(q)}`);
        const d = await r.json();
        setResults(d.success ? (d.data || []) : []);
      } catch { setResults([]); }
    }, 300);
    setTimer(t);
  };
  const pick = (u: OAUser) => {
    const extra: Record<string, unknown> = tone === 'blue'
      ? { ownerLoginId: u.loginid, ownerOaId: u.oaId || null, dept: u.dept || '' }
      : { proposerLoginId: u.loginid, proposerOaId: u.oaId || null };
    onPick(u.name, extra);
    setEditing(false);
  };
  if (readOnly) {
    if (!value) return null;
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${toneCls} opacity-70`}>
        <span className="opacity-60 text-[10px]">{label}</span>{value}
      </span>
    );
  }
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}
        className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${value ? toneCls : 'text-slate-400 bg-slate-50 border-slate-200 hover:bg-slate-100'}`}>
        <span className="opacity-60 text-[10px]">{label}</span>{value || placeholder}
      </button>
    );
  }
  return (
    <div className="relative">
      <input
        autoFocus
        value={query}
        onChange={(e) => search(e.target.value)}
        onBlur={() => setTimeout(() => {
          if (query && query !== value) onPick(query, {});
          setEditing(false);
        }, 200)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onPick(query, {}); setEditing(false); }
          if (e.key === 'Escape') { setEditing(false); setQuery(value); }
        }}
        placeholder={placeholder}
        className={`w-28 text-xs px-2 py-1 rounded-lg border outline-none ring-2 ${tone === 'blue' ? 'border-blue-300 ring-blue-100' : 'border-violet-300 ring-violet-100'}`}
      />
      {results.length > 0 && (
        <div className="absolute z-50 top-7 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-32 overflow-y-auto">
          {results.slice(0, 8).map(u => (
            <button key={u.loginid} type="button" onMouseDown={(e) => { e.preventDefault(); pick(u); }}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between">
              <span className="font-medium">{u.name}</span>
              <span className="text-slate-400 text-[10px]">{u.dept}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ value, label }: { value: number; label: string }) {
  const color = value >= 0.7 ? 'bg-emerald-100 text-emerald-700' : value >= 0.4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>
      {value < 0.7 && <AlertTriangle className="w-3 h-3" />}
      {label} {Math.round(value * 100)}%
    </span>
  );
}

// 标签颜色映射（飞书风格）
const LABEL_STYLE: Record<string, { chip: string; bar: string }> = {
  '问题':   { chip: 'bg-red-50 text-red-600 border-red-200',       bar: 'bg-red-400' },
  '背景':   { chip: 'bg-slate-50 text-slate-500 border-slate-200',  bar: 'bg-slate-400' },
  '决议':   { chip: 'bg-blue-50 text-blue-600 border-blue-200',     bar: 'bg-blue-500' },
  '共识':   { chip: 'bg-indigo-50 text-indigo-600 border-indigo-200', bar: 'bg-indigo-500' },
  '进展':   { chip: 'bg-emerald-50 text-emerald-600 border-emerald-200', bar: 'bg-emerald-500' },
  '已完成': { chip: 'bg-emerald-50 text-emerald-600 border-emerald-200', bar: 'bg-emerald-500' },
  '待优化': { chip: 'bg-amber-50 text-amber-600 border-amber-200',  bar: 'bg-amber-400' },
  '待办':   { chip: 'bg-orange-50 text-orange-600 border-orange-200', bar: 'bg-orange-400' },
  '方向':   { chip: 'bg-purple-50 text-purple-600 border-purple-200', bar: 'bg-purple-500' },
  '计划':   { chip: 'bg-violet-50 text-violet-600 border-violet-200', bar: 'bg-violet-500' },
  '行动':     { chip: 'bg-teal-50 text-teal-600 border-teal-200',     bar: 'bg-teal-500' },
  '探索方向': { chip: 'bg-indigo-50 text-indigo-600 border-indigo-200', bar: 'bg-indigo-400' },
  '风险提示': { chip: 'bg-orange-50 text-orange-600 border-orange-200', bar: 'bg-orange-400' },
  '讨论':     { chip: 'bg-amber-50 text-amber-700 border-amber-200',    bar: 'bg-amber-400' },
  '数据通报': { chip: 'bg-sky-50 text-sky-600 border-sky-200',          bar: 'bg-sky-400' },
  '汇报内容': { chip: 'bg-sky-50 text-sky-600 border-sky-200',          bar: 'bg-sky-400' },
};
const DEFAULT_LABEL_STYLE = { chip: 'bg-slate-50 text-slate-500 border-slate-200', bar: 'bg-slate-400' };
// 只有这些标签需要醒目显示 badge，其余标签只保留左侧色条
const NOTABLE_LABELS = new Set(['问题', '决议', '共识', '风险提示', '待办', '待优化', '讨论']);

const SECTION_ACCENT = ['border-blue-400', 'border-purple-400', 'border-emerald-400', 'border-amber-400'];
const SECTION_TITLE_COLOR = ['text-blue-700', 'text-purple-700', 'text-emerald-700', 'text-amber-700'];

function MinutesLabelPoint({ pt, parentSubtitle }: { pt: any; parentSubtitle?: string }) {
  const style = LABEL_STYLE[pt.label] || DEFAULT_LABEL_STYLE;
  const showBadge = NOTABLE_LABELS.has(pt.label) && pt.label !== parentSubtitle;
  return (
    <div className="flex gap-2.5 mt-2">
      <div className={`w-0.5 rounded-full flex-shrink-0 mt-0.5 ${style.bar}`} style={{ minHeight: '1.1em' }} />
      <div className="flex-1 min-w-0">
        {showBadge && (
          <span className={`inline-block text-xs font-semibold px-1.5 py-0.5 rounded border mr-1.5 mb-1 ${style.chip}`}>
            {pt.label}
          </span>
        )}
        {pt.text && (
          pt.text.includes('；')
            ? <div className="text-sm text-slate-700 leading-relaxed space-y-0.5">
                {pt.text.split('；').filter((s: string) => s.trim()).map((line: string, i: number) => (
                  <div key={i}>{line.trim()}</div>
                ))}
              </div>
            : <span className="text-sm text-slate-700 leading-relaxed">{pt.text}</span>
        )}
        {pt.bullets && pt.bullets.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {pt.bullets.map((b: string, bi: number) => (
              <li key={bi} className="flex gap-2 text-sm text-slate-700">
                <span className="text-slate-400 flex-shrink-0 mt-0.5">•</span>
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── 可编辑文本块（contentEditable，Notion 风格）──
function InlineEdit({ value, onChange, className = '', tag = 'span', ...props }: {
  value: string; onChange: (v: string) => void; className?: string; tag?: string;
  [key: string]: any;
}) {
  const ref = useRef<HTMLElement>(null);
  const lastVal = useRef(value);
  // 初次挂载 + value 外部变化时同步 DOM（聚焦编辑中跳过，防异步回写重置光标/覆盖正在输入的内容）
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.textContent = value || '';
    }
    lastVal.current = value;
  }, [value]);
  const Tag = tag as any;
  return (
    <Tag ref={ref} contentEditable suppressContentEditableWarning
      {...props}
      onBlur={(e: React.FocusEvent) => {
        const nv = ref.current?.textContent || '';
        if (nv !== lastVal.current) { lastVal.current = nv; onChange(nv); }
        props.onBlur?.(e);
      }}
      onKeyDown={(e: React.KeyboardEvent) => { 
        if (e.key === 'Enter' && tag !== 'p') { 
          e.preventDefault(); 
          (e.target as HTMLElement).blur(); 
        } 
        props.onKeyDown?.(e);
      }}
      className={`${className} outline-none rounded-sm focus:ring-1 focus:ring-blue-300 focus:bg-blue-50/30 transition-colors cursor-text hover:bg-slate-50`}
    />
  );
}

// ── 分号自动换行显示（点击进入编辑模式）──
function SemicolonText({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [editing, setEditing] = React.useState(false);
  if (editing || !value.includes('；')) {
    return <InlineEdit value={value} onChange={v => { onChange(v); setEditing(false); }} className={className} />;
  }
  return (
    <div className={`${className} cursor-text rounded-sm hover:bg-slate-50 space-y-0.5 px-0.5`} onClick={() => setEditing(true)}>
      {value.split('；').filter((s: string) => s.trim()).map((line: string, i: number) => (
        <div key={i}>{line.trim()}；</div>
      ))}
    </div>
  );
}

// ── 支持 **bold** 渲染的内联编辑（用于行动项 task 字段）──
function boldToHtml(t: string) { return t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); }
function RichInlineEdit({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (ref.current && !editing.current) ref.current.innerHTML = boldToHtml(value || '');
  }, [value]);
  return (
    <span ref={ref} contentEditable suppressContentEditableWarning
      onFocus={() => { editing.current = true; if (ref.current) ref.current.textContent = value || ''; }}
      onBlur={() => {
        editing.current = false;
        const raw = ref.current?.textContent || '';
        onChange(raw);
        if (ref.current) ref.current.innerHTML = boldToHtml(raw);
      }}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
      className={`${className} outline-none rounded-sm focus:ring-1 focus:ring-blue-300 focus:bg-blue-50/30 transition-colors cursor-text hover:bg-slate-50`}
    />
  );
}

// ── Hover 操作菜单 ──
function HoverActions({ children, onDelete, onAdd, addLabel }: {
  children: React.ReactNode; onDelete?: () => void; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <div className="group/item relative">
      {children}
      <div className="absolute -left-7 top-0 flex flex-col gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity">
        {onAdd && (
          <button onClick={onAdd} title={addLabel || '新增'}
            className="w-5 h-5 flex items-center justify-center rounded text-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
            <Plus className="w-3 h-3" />
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} title="删除"
            className="w-5 h-5 flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── 行动项负责人：输入联想搜索 ──
function InlineOwnerPicker({ value, onChange, className = '' }: {
  value: string;
  onChange: (name: string, dept?: string, loginid?: string, oaId?: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<{ oaId?: string; loginid: string; name: string; dept: string }[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  const search = (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/oa/users?keyword=${encodeURIComponent(q)}`);
        const d = await r.json();
        if (d.success && d.data?.length) { setResults(d.data); setOpen(true); }
        else { setResults([]); setOpen(false); }
      } catch { setResults([]); setOpen(false); }
    }, 300);
  };

  const pick = (u: { oaId?: string; name: string; dept: string; loginid: string }) => {
    setQuery(u.name);
    setOpen(false);
    onChange(u.name, u.dept, u.loginid, u.oaId);
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        value={query}
        onChange={e => search(e.target.value)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 200);
          if (query !== value) onChange(query);
        }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur(); } }}
        className={`${className} outline-none rounded-sm focus:ring-1 focus:ring-blue-300 focus:bg-blue-50/30 transition-colors cursor-text hover:bg-slate-50 border-none bg-transparent`}
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto mt-0.5 min-w-[140px]">
          {results.map(u => (
            <button key={u.loginid} type="button"
              onMouseDown={() => pick(u)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{u.name}</span>
              <span className="text-slate-400 truncate">{u.dept}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingMinutesBlock({ minutes, meeting, onSave, onRegenerate, isGenerating, genStep, generateProvider, setGenerateProvider, actionItems, onGoActions }: {
  minutes: any; meeting: Meeting;
  onSave?: (updated: any) => void;
  onRegenerate?: () => void;
  isGenerating?: boolean;
  genStep?: string;
  generateProvider?: string;
  setGenerateProvider?: (v: 'tencent' | 'qwen' | 'siliconflow' | 'deepseek' | 'deepseek-v4-pro') => void;
  actionItems?: ActionItem[];
  onGoActions?: () => void;
}) {
  const [data, setData] = useState<any>(() => JSON.parse(JSON.stringify(minutes)));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditingMarkdown, setIsEditingMarkdown] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sectionTitle: string } | null>(null);

  // 当外部 minutes 变化时重置（本地有未保存编辑时不覆盖，防输入被服务端旧数据冲掉）
  useEffect(() => {
    if (dirty) return;
    setData(JSON.parse(JSON.stringify(minutes)));
    setDirty(false);
    setIsEditingMarkdown(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);

  // 他人归档（status → locked）时强制退出正文编辑态，避免锁定后页面仍显示可编辑
  const meetingStatus = (meeting as any)?.status;
  useEffect(() => {
    if (meetingStatus === 'locked') setIsEditingMarkdown(false);
  }, [meetingStatus]);

  if (!data) return null;
  const participants = (meeting.participants || []).map(normalizeName).filter(Boolean);

  // 通用更新：沿路径浅拷贝（替代整树深克隆，大文档键击不再全量克隆卡顿）
  const upd = (path: string, value: string) => {
    const keys = path.split('.');
    setData((prev: any) => {
      if (!prev) return prev;
      const root: any = Array.isArray(prev) ? [...prev] : { ...prev };
      let obj: any = root;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        const child = obj[k];
        obj[k] = Array.isArray(child) ? [...child] : { ...(child || {}) };
        obj = obj[k];
      }
      obj[keys[keys.length - 1]] = value;
      return root;
    });
    setDirty(true);
  };
  const del = (arrayPath: string, index: number) => {
    const d = JSON.parse(JSON.stringify(data));
    const keys = arrayPath.split('.');
    let obj: any = d;
    for (const k of keys) obj = obj[k];
    if (Array.isArray(obj)) { obj.splice(index, 1); setData(d); setDirty(true); }
  };
  const add = (arrayPath: string, item: any) => {
    const d = JSON.parse(JSON.stringify(data));
    const keys = arrayPath.split('.');
    let obj: any = d;
    for (const k of keys) obj = obj[k];
    if (Array.isArray(obj)) { obj.push(item); setData(d); setDirty(true); }
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try { await onSave(data); setDirty(false); }
    finally { setSaving(false); }
  };
  const handleDiscard = () => {
    setData(JSON.parse(JSON.stringify(minutes)));
    setDirty(false);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300" onClick={() => setContextMenu(null)}>

      {/* ── 文档头部（飞书风格）── */}
      <div className="relative">
        {/* 顶部蓝色条 */}
        <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-400" />

        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          {/* 工具栏 */}
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100">
              <FileText className="w-3 h-3" />会议纪要
            </span>
            <span className="text-xs text-slate-300">点击文字即可编辑</span>
            {data.markdownBody && (
              <button
                onClick={() => setIsEditingMarkdown(!isEditingMarkdown)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border transition-all ${
                  isEditingMarkdown ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {isEditingMarkdown ? <Check className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                {isEditingMarkdown ? '完成正文编辑' : '编辑正文(MD)'}
              </button>
            )}
            {onRegenerate && (
              <div className="ml-auto flex items-center gap-2">
                {setGenerateProvider && (
                  <select
                    value={generateProvider}
                    onChange={e => setGenerateProvider(e.target.value as any)}
                    disabled={isGenerating}
                    className="px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white text-slate-600 disabled:opacity-50 focus:outline-none"
                  >
                    <option value="tencent">腾讯元宝</option>
                    <option value="qwen">阿里千问</option>
                    <option value="siliconflow">硅基流动（V3）</option>
                    <option value="deepseek">DeepSeek（V4 Flash）</option>
                    <option value="deepseek-v4-pro">DeepSeek（V4 Pro）</option>
                  </select>
                )}
                <button
                  onClick={onRegenerate}
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-60 font-medium"
                >
                  {isGenerating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {isGenerating ? (genStep || 'AI生成中...') : '重新生成'}
                </button>
              </div>
            )}
          </div>

          {/* 标题 */}
          <InlineEdit value={data.title} onChange={v => upd('title', v)}
            className="text-2xl font-bold text-slate-900 leading-tight block w-full" tag="h2" />

          {/* 会议核心一句话 */}
          {data.meetingContent && (
            <InlineEdit value={data.meetingContent} onChange={v => upd('meetingContent', v)}
              className="text-sm text-slate-500 mt-2 leading-relaxed block w-full" tag="p" />
          )}

          {/* 元信息 */}
          <div className="flex flex-wrap gap-3 mt-4">
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100">
              <Calendar className="w-3 h-3 text-slate-400" />{data.meetingDate}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100">
              <User className="w-3 h-3 text-slate-400" />主持：{normalizeName(meeting.organizer) || '待明确'}
            </span>
            {participants.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100">
                <User className="w-3 h-3 text-slate-400" />参会：{participants.join('、')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 正文内容（Markdown 渲染或编辑）── */}
      {data.markdownBody ? (
        <div 
          className={`px-6 py-6 minutes-markdown ${!isEditingMarkdown ? 'cursor-text hover:bg-slate-50/50 transition-colors' : ''}`}
          onClick={() => { if (!isEditingMarkdown) setIsEditingMarkdown(true); }}
        >
          {isEditingMarkdown ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">Markdown Editor</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-slate-300">支持标准 Markdown 语法</span>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setIsEditingMarkdown(false); }}
                    className="text-[10px] text-blue-600 hover:underline font-medium"
                  >
                    预览效果
                  </button>
                </div>
              </div>
              <Textarea
                autoFocus
                value={data.markdownBody}
                onChange={(e) => upd('markdownBody', e.target.value)}
                onBlur={() => {
                  // 如果内容没变且失去焦点，可以考虑自动退出，但 Textarea 通常很大，建议保留完成按钮
                }}
                className="w-full min-h-[500px] font-mono text-sm leading-relaxed p-4 bg-slate-50 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 transition-all"
                placeholder="在此输入或粘贴会议纪要正文 (Markdown 格式)..."
              />
            </div>
          ) : (
            <div className="relative group/md-view">
              <div className="absolute -right-2 -top-2 opacity-0 group-hover/md-view:opacity-100 transition-opacity">
                <span className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded-md shadow-sm flex items-center gap-1">
                  <Pencil className="w-2.5 h-2.5" /> 点击进入编辑模式
                </span>
              </div>
              <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-lg font-bold text-slate-900 mt-6 mb-3 pb-2 border-b border-slate-200 first:mt-0">{children}</h1>
                ),
                h2: ({ children }) => {
                  const text = String(children);
                  const colors = [
                    { bg: 'bg-blue-50', badge: 'bg-blue-500', text: 'text-blue-700', border: 'border-blue-200' },
                    { bg: 'bg-violet-50', badge: 'bg-violet-500', text: 'text-violet-700', border: 'border-violet-200' },
                    { bg: 'bg-emerald-50', badge: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-200' },
                    { bg: 'bg-amber-50', badge: 'bg-amber-500', text: 'text-amber-700', border: 'border-amber-200' },
                  ];
                  const match = text.match(/^[一二三四五六七八九十]+/);
                  const idx = match ? '一二三四五六七八九十'.indexOf(match[0]) : 0;
                  const c = colors[idx % colors.length];
                  return (
                    <div
                      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-t-xl ${c.bg} border ${c.border} mt-6 first:mt-0 cursor-pointer hover:opacity-80 transition-opacity`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, sectionTitle: text });
                      }}
                    >
                      <span className={`w-5 h-5 rounded-full ${c.badge} text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                        {idx + 1}
                      </span>
                      <h2 className={`text-sm font-bold ${c.text}`}>{children}</h2>
                    </div>
                  );
                },
                h3: ({ children }) => (
                  <h3 className="text-sm font-semibold text-slate-800 mt-4 mb-1.5">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="text-sm text-slate-700 leading-relaxed my-1.5">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="ml-4 my-1.5 space-y-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="ml-4 my-1.5 space-y-1 list-decimal">{children}</ol>
                ),
                li: ({ children }) => {
                  // 提取纯文本内容
                  const extractText = (node: React.ReactNode): string => {
                    if (typeof node === 'string') return node;
                    if (Array.isArray(node)) return node.map(extractText).join('');
                    if (React.isValidElement(node) && (node.props as any)?.children) return extractText((node.props as any).children);
                    return '';
                  };
                  const fullText = extractText(children);
                  // 检测"人名（部门）："或"**人名**："模式，后面有分号分隔的多条任务
                  const hasSemicolons = fullText.includes('；');
                  if (hasSemicolons) {
                    // 找到冒号位置，拆分为 header + tasks
                    const colonIdx = fullText.indexOf('：');
                    if (colonIdx > 0 && colonIdx < 30) {
                      const header = fullText.substring(0, colonIdx);
                      const tasksStr = fullText.substring(colonIdx + 1);
                      const tasks = tasksStr.split('；').map(t => t.trim()).filter(Boolean);
                      return (
                        <li className="text-sm text-slate-700 leading-relaxed">
                          <div className="flex gap-2 items-start">
                            <span className="text-slate-300 flex-shrink-0 mt-1 text-[10px]">●</span>
                            <span className="font-bold text-slate-800">{header}</span>
                          </div>
                          {tasks.length > 0 && (
                            <ul className="ml-6 mt-1 space-y-0.5">
                              {tasks.map((task, i) => (
                                <li key={i} className="flex gap-1.5 items-start text-sm text-slate-600">
                                  <span className="text-slate-300 flex-shrink-0 mt-1.5 text-[8px]">◦</span>
                                  <span>{task}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    }
                  }
                  return (
                    <li className="text-sm text-slate-700 leading-relaxed flex gap-2 items-start">
                      <span className="text-slate-300 flex-shrink-0 mt-1 text-[10px]">●</span>
                      <span className="flex-1">{children}</span>
                    </li>
                  );
                },
                strong: ({ children }) => (
                  <strong className="font-bold text-slate-800">{children}</strong>
                ),
                hr: () => <hr className="my-4 border-slate-100" />,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-3 border-blue-300 pl-3 my-2 text-sm text-slate-600 italic">{children}</blockquote>
                ),
              }}
            >
              {data.markdownBody}
            </ReactMarkdown>
            </div>
          )}
        </div>
      ) : data.sections?.length > 0 ? (
        <div className="px-6 py-6 space-y-8">
          {data.sections.map((section: any, si: number) => (
            <section key={si} className="relative group/section">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-8 w-1 bg-blue-500 rounded-full" />
                <InlineEdit
                  value={section.title}
                  onChange={v => upd(`sections.${si}.title`, v)}
                  className="text-lg font-bold text-slate-900"
                  tag="h2"
                />
                <button
                  onClick={() => del('sections', si)}
                  className="p-1 text-slate-300 opacity-0 group-hover/section:opacity-100 hover:text-red-500 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-6 ml-4">
                {section.items?.map((item: any, ii: number) => (
                  <div key={ii} className="relative group/item">
                    <div className="flex items-center gap-2 mb-2">
                      <InlineEdit
                        value={item.subtitle}
                        onChange={v => upd(`sections.${si}.items.${ii}.subtitle`, v)}
                        className="text-sm font-bold text-slate-800"
                        tag="h3"
                      />
                      <button
                        onClick={() => del(`sections.${si}.items`, ii)}
                        className="p-1 text-slate-300 opacity-0 group-hover/item:opacity-100 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1">
                      {item.points?.map((pt: any, pi: number) => (
                        <div key={pi} className="relative group/point flex gap-2.5 mt-2">
                          <div className={`w-0.5 rounded-full flex-shrink-0 mt-0.5 bg-slate-200`} style={{ minHeight: '1.1em' }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <InlineEdit
                                value={pt.label}
                                onChange={v => upd(`sections.${si}.items.${ii}.points.${pi}.label`, v)}
                                className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                              />
                              <button
                                onClick={() => del(`sections.${si}.items.${ii}.points`, pi)}
                                className="p-1 text-slate-300 opacity-0 group-hover/point:opacity-100 hover:text-red-500 transition-all"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            <SemicolonText
                              value={pt.text}
                              onChange={v => upd(`sections.${si}.items.${ii}.points.${pi}.text`, v)}
                              className="text-sm text-slate-700 leading-relaxed"
                            />
                            {pt.bullets?.length > 0 && (
                              <ul className="mt-1.5 space-y-1">
                                {pt.bullets.map((b: string, bi: number) => (
                                  <li key={bi} className="flex gap-2 text-sm text-slate-700 group/bullet">
                                    <span className="text-slate-400 flex-shrink-0 mt-0.5">•</span>
                                    <InlineEdit
                                      value={b}
                                      onChange={v => upd(`sections.${si}.items.${ii}.points.${pi}.bullets.${bi}`, v)}
                                      className="flex-1 leading-relaxed"
                                    />
                                    <button
                                      onClick={() => {
                                        const nb = [...pt.bullets];
                                        nb.splice(bi, 1);
                                        upd(`sections.${si}.items.${ii}.points.${pi}.bullets`, nb as any);
                                      }}
                                      className="p-0.5 text-slate-200 opacity-0 group-hover/bullet:opacity-100 hover:text-red-500 transition-all"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => add(`sections.${si}.items.${ii}.points`, { label: '重点', text: '', bullets: [] })}
                        className="ml-3 mt-2 text-[10px] text-slate-400 hover:text-blue-500 flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-all"
                      >
                        <Plus className="w-3 h-3" /> 添加要点
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => add(`sections.${si}.items`, { subtitle: '新议题', points: [] })}
                  className="mt-2 text-xs text-slate-400 hover:text-blue-500 flex items-center gap-1 opacity-0 group-hover/section:opacity-100 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" /> 添加议题
                </button>
              </div>
            </section>
          ))}
          <button
            onClick={() => add('sections', { title: '新章节', items: [] })}
            className="w-full py-4 border-2 border-dashed border-slate-100 rounded-2xl text-slate-400 hover:border-blue-200 hover:text-blue-500 hover:bg-blue-50/30 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> 添加新章节
          </button>
        </div>
      ) : null}

      {/* ── 行动项表格（只读，数据来自行动项tab） ── */}
      <div className="px-6 pb-6 space-y-5">
        {actionItems && actionItems.length > 0 && (
          <section className="rounded-xl border border-orange-200 overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-orange-50 to-amber-50 border-b border-orange-100">
              <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3" />
              </span>
              <h3 className="text-sm font-bold text-orange-700 flex-1">行动项跟踪</h3>
              <span className="text-xs text-orange-400 font-medium">{actionItems.length} 项</span>
              {onGoActions && (
                <button onClick={onGoActions}
                  className="text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-0.5 rounded-lg transition-colors flex items-center gap-1">
                  <Eye className="w-3 h-3" /> 查看详情
                </button>
              )}
            </div>
            <div className="bg-white">
              <div className="divide-y divide-slate-50">
                {actionItems.map((item: ActionItem, i: number) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">{item.description}</span>
                    {item.owner && (
                      <span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 flex-shrink-0">{item.owner}</span>
                    )}
                    {item.due_date && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-100 flex-shrink-0">
                        <Clock className="w-3 h-3 text-slate-300" />{item.due_date}
                      </span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${PRIORITY_COLOR[item.priority]}`}>
                      {PRIORITY_LABEL[item.priority]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── 会议总结 ── */}
        {data.conclusion && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">会议总结</p>
            <InlineEdit value={data.conclusion} onChange={v => upd('conclusion', v)}
              className="text-sm text-slate-600 leading-relaxed block w-full" tag="p" />
          </div>
        )}
      </div>

      {/* ── 底部状态 / 浮出保存栏 ── */}
      {dirty ? (
        <div className="px-6 py-3 bg-blue-50 border-t border-blue-200 flex items-center gap-3 sticky bottom-0">
          <span className="text-xs text-blue-600 flex-1">有未保存的修改</span>
          <button onClick={handleDiscard}
            className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700 border border-slate-200 bg-white rounded-lg transition-colors">
            放弃修改
          </button>
          <button onClick={handleSave} disabled={saving}
            className="text-xs px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center gap-1">
            {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      ) : (
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
          <p className="text-xs text-slate-400">由 AI 自动生成 · 点击文字直接修改 · 左侧悬浮可增删</p>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.sectionTitle);
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-xs text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Copy className="w-3 h-3" /> 复制标题
          </button>
          <button
            onClick={() => {
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-xs text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Eye className="w-3 h-3" /> 仅查看此节
          </button>
          <div className="h-px bg-slate-100 my-1" />
          <button
            onClick={() => setContextMenu(null)}
            className="w-full px-3 py-2 text-xs text-left text-red-600 hover:bg-red-50 flex items-center gap-2"
          >
            <Trash2 className="w-3 h-3" /> 删除此节
          </button>
        </div>
      )}
    </div>
  );
}

export default function MeetingEditorPage() {
  const params = useParams();
  const router = useRouter();
  const meetingId = params.id as string;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [summary, setSummary] = useState<SummarySection[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [minutes, setMinutes] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStep, setGenStep] = useState('');
  const [isLocking, setIsLocking] = useState(false);
  const [activeTab, setActiveTab] = useState<'minutes' | 'summary' | 'actions' | 'mindmap' | 'linked' | 'export' | 'logs'>('minutes');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'done'>('all');
  const [showSummaryTooltip, setShowSummaryTooltip] = useState(false);
  const [editingAction, setEditingAction] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<ActionItem>>({});
  const [aiTimeout, setAiTimeout] = useState(false);
  const [generateProvider, setGenerateProvider] = useState<'tencent' | 'qwen' | 'siliconflow' | 'deepseek' | 'deepseek-v4-pro'>('tencent');
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugMarkdown, setDebugMarkdown] = useState('');
  const [userRole, setUserRole] = useState<string>('employee');
  const [projects, setProjects] = useState<any[]>([]);
  const [isUpdatingProject, setIsUpdatingProject] = useState(false);
  const [meetingTypes, setMeetingTypes] = useState<any[]>([]);
  const [isUpdatingType, setIsUpdatingType] = useState(false);
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [isSavingTranscript, setIsSavingTranscript] = useState(false);
  const [loadError, setLoadError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadMeeting(); }, [meetingId]);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.success) setUserRole(d.data.role || 'employee');
    }).catch(() => {});
    
    // 获取项目列表供关联使用
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (d.success) setProjects(d.data || []);
    }).catch(() => {});
    // 获取会议类型列表供修改使用
    fetch('/api/meeting-types').then(r => r.json()).then(d => {
      if (d.success) setMeetingTypes(d.data || []);
    }).catch(() => {});
  }, []);

  // 保存 Step 1A Markdown 用于调试
  useEffect(() => {
    if (minutes?.debug_step1a_markdown) {
      setDebugMarkdown(minutes.debug_step1a_markdown);
    }
  }, [minutes]);

  const convertSummary = (raw: any): SummarySection[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const sections: SummarySection[] = [];
    if (raw.overview) sections.push({ section_type: 'agenda', content: raw.overview, confidence: 0.8 });
    raw.keyTopics?.forEach((t: any) => sections.push({ section_type: 'agenda', content: `${t.topic}: ${t.description}`, confidence: 0.7 }));
    raw.decisions?.forEach((d: any) => sections.push({ section_type: 'decision', content: `${d.decision}\n依据: ${d.rationale}\n影响: ${d.impact}`, confidence: 0.8 }));
    raw.risks?.forEach((r: any) => sections.push({ section_type: 'risk', content: `${r.risk}\n应对: ${r.mitigation}`, confidence: 0.7 }));
    raw.nextSteps?.forEach((s: any) => sections.push({ section_type: 'next_step', content: `${s.step}${s.owner ? ` (负责人: ${s.owner})` : ''}${s.timeline ? ` (时间: ${s.timeline})` : ''}`, confidence: 0.8 }));
    return sections;
  };

  const mapActionItems = (items: any[]) => items.map((item: any) => ({
    id: item.dbId || item.id,
    dbId: item.dbId || null,
    originalId: item.originalId || item.id,
    description: item.description,
    owner: item.assignee || item.owner || null,
    ownerLoginId: item.ownerLoginId || null,
    ownerOaId: item.ownerOaId || null,
    dept: item.dept || null,
    proposer: item.proposer || null,
    proposerLoginId: item.proposerLoginId || null,
    proposerOaId: item.proposerOaId || null,
    proposerDept: item.proposerDept || item.proposer_dept || null,
    due_date: item.dueDate || item.due_date || null,
    due_date_type: item.dueDateType || item.due_date_type || null,
    priority: item.priority || 'medium',
    status: item.status || 'pending',
    confidence_owner: item.confidence?.assignee ?? item.confidence_owner ?? 0.5,
    confidence_date: item.confidence?.dueDate ?? item.confidence_date ?? 0.5,
    source_sentence: item.sourceText || item.source_sentence || '',
    initial_result: item.initialResult || item.initial_result || null,
    evidence_files: item.evidence_files || [],
  }));

  const loadMeeting = async () => {
    setLoadError('');
    const traceId = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('_t')
        || `mtgedit-${Date.now().toString(36)}`
      : 'mtgedit-ssr';
    const log = (step: string, extra: Record<string, unknown> = {}) => {
      console.log('[share-trace]', JSON.stringify({ traceId, step, meetingId, ...extra }));
    };
    log('meeting.editor.load.start');
    try {
      const res = await fetch(`/api/meetings/${meetingId}?_t=${encodeURIComponent(traceId)}`, { cache: 'no-store' });
      const r = await res.json();
      log('meeting.editor.load.response', { status: res.status, success: r.success, code: r.code, error: r.error });

      // 权限检查：403表示无权访问
      if (res.status === 403 || r.code === 'FORBIDDEN') {
        log('meeting.editor.load.forbidden');
        router.push('/meetings');
        alert('无权访问此会议：您不是此会议的参会人员或主持人');
        return;
      }

      if (!res.ok || !r.success) {
        setLoadError(r.error || `会议加载失败（${res.status}）`);
        return;
      }

      setMeeting(r.data.meeting);
      setSummary(convertSummary(r.data.summary));
      setActionItems(mapActionItems(r.data.actionItems || []));
      if (r.data.meeting?.minutes) setMinutes(r.data.meeting.minutes);
      log('meeting.editor.load.ok', { actionCount: (r.data.actionItems || []).length });
    } catch (e) {
      log('meeting.editor.load.exception', { message: e instanceof Error ? e.message : String(e) });
      setLoadError('会议加载失败，请检查网络后重试');
    }
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenStep('正在分析会议内容...');
    setAiTimeout(false);
    const stepTimer1 = setTimeout(() => setGenStep('Step 1A：生成Markdown纪要...'), 4000);
    const stepTimer2 = setTimeout(() => setGenStep('Step 1B：转换JSON结构...'), 60000);
    const stepTimer3 = setTimeout(() => setGenStep('Step 2：提炼行动项...'), 120000);
    const timer = setTimeout(() => setAiTimeout(true), 600_000);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId,
          generateProvider,
        }),
      });
      const r = await res.json();
      clearTimeout(timer);
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      setGenStep('');
      if (r.success) {
        // Convert backend data to frontend format
        const summaryData = r.data.summary;
        const actionItemsData = mapActionItems(r.data.actionItems || []);

        // Convert structured summary to SummarySection format
        const summarySections: SummarySection[] = [];
        
        // Add overview
        if (summaryData.overview) {
          summarySections.push({
            section_type: 'agenda',
            content: summaryData.overview,
            confidence: 0.8
          });
        }

        // Add key topics
        summaryData.keyTopics?.forEach((topic: any) => {
          summarySections.push({
            section_type: 'agenda',
            content: `${topic.topic}: ${topic.description}`,
            confidence: 0.7
          });
        });

        // Add decisions
        summaryData.decisions?.forEach((decision: any) => {
          summarySections.push({
            section_type: 'decision',
            content: `${decision.decision}\n\nRationale: ${decision.rationale}\nImpact: ${decision.impact}`,
            confidence: 0.8
          });
        });

        // Add risks
        summaryData.risks?.forEach((risk: any) => {
          summarySections.push({
            section_type: 'risk',
            content: `${risk.risk}\n\nMitigation: ${risk.mitigation}`,
            confidence: 0.7
          });
        });

        // Add next steps
        summaryData.nextSteps?.forEach((step: any) => {
          summarySections.push({
            section_type: 'next_step',
            content: `${step.step}${step.owner ? ` (Owner: ${step.owner})` : ''}${step.timeline ? ` (Timeline: ${step.timeline})` : ''}`,
            confidence: 0.8
          });
        });

        setSummary(summarySections);
        setActionItems(actionItemsData);
        if (r.data.minutes) setMinutes(r.data.minutes);

        // 自动匹配行动项负责人到 OA 用户（后台静默执行）
        const ownerNames = [...new Set(
          actionItemsData.map((a: ActionItem) => a.owner).filter((n): n is string => !!n && !actionItemsData.find((a: ActionItem) => a.owner === n && a.ownerLoginId))
        )];
        if (ownerNames.length > 0) {
          fetch('/api/oa/match-owners', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ names: ownerNames }),
          }).then(r => r.json()).then(r => {
            if (r.success && r.matches && Object.keys(r.matches).length > 0) {
              setActionItems((prev: ActionItem[]) => {
                const updated = prev.map((a: ActionItem) => {
                  const m = a.owner ? r.matches[a.owner] : null;
                  if (m && !a.ownerLoginId) {
                    return { ...a, owner: m.name, ownerLoginId: m.loginid, ownerOaId: m.oaId || null, dept: m.dept };
                  }
                  return a;
                });
                // 持久化回 DB，避免刷新后丢失匹配结果
                fetch(`/api/meetings/${meetingId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ actionItems: updated }),
                }).catch(() => {});
                return updated;
              });
            }
          }).catch(() => {});
        }

        // Reload meeting info only (summary already set above)
        const mRes = await fetch(`/api/meetings/${meetingId}`);
        const mR = await mRes.json();
        if (mR.success) setMeeting(mR.data.meeting);
      } else { alert(r.error || '生成失败'); }
    } catch { alert('生成失败，请重试'); clearTimeout(timer); clearTimeout(stepTimer3); }
    finally { setIsGenerating(false); setGenStep(''); }
  };

  const hasUnconfirmedLow = actionItems.some(
    (a: ActionItem) => (a.confidence_owner < 0.7 || a.confidence_date < 0.7) && a.status === 'pending'
  );

  const handleLock = async () => {
    if (hasUnconfirmedLow) { alert('存在未确认的低置信度行动项，请先逐一确认后再锁定版本'); return; }
    setIsLocking(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/lock`, { method: 'POST' });
      const r = await res.json();
      if (r.success) {
        await loadMeeting();
        const oa = r.data?.oaPush;
        const noOwner = actionItems.filter(a => !a.owner).length;
        let msg = '版本已锁定 ✓';
        if (oa) {
          msg += `\nOA 推送：${oa.message || `${oa.pushed} 条成功${oa.failed > 0 ? `，${oa.failed} 条失败` : ''}`}`;
          if (oa.summary) {
            if (oa.summary.cancelled > 0) msg += `\n已作废未处理旧项：${oa.summary.cancelled} 条`;
            if (oa.summary.skippedProcessedUpdates > 0) msg += `\n已处理项未覆盖：${oa.summary.skippedProcessedUpdates} 条`;
            if (oa.summary.preservedProcessedDeletes > 0) msg += `\n已处理删除项保留：${oa.summary.preservedProcessedDeletes} 条`;
          }
          if (oa.notices?.length) {
            msg += `\n提示：${oa.notices.slice(0, 2).join('；')}`;
            if (oa.notices.length > 2) msg += ` 等 ${oa.notices.length} 条`;
          }
          if (oa.errors?.length) {
            msg += `\n失败详情：${oa.errors.slice(0, 2).join('；')}`;
            if (oa.errors.length > 2) msg += ` 等 ${oa.errors.length} 条`;
          }
        }
        if (noOwner > 0) {
          msg += `\n⚠️ 有 ${noOwner} 条行动项未填写责任人，OA 中将显示空白。请补全后重新锁定以更新 OA。`;
        }
        alert(msg);
      } else alert(r.error || '锁定失败');
    } catch { alert('锁定失败'); }
    finally { setIsLocking(false); }
  };

  const handleUnlock = async () => {
    if (!confirm('确定要解除归档吗？解除后可以继续编辑并重新归档。\n注意：系统会保留 OA 数据和行动项台账，不会自动删除；若 OA 中已有行动项回传，则无法解除归档。')) return;
    setIsLocking(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/lock`, { method: 'DELETE' });
      const r = await res.json();
      if (r.success) {
        await loadMeeting();
        const cleanup = r.data?.cleanup;
        let msg = '版本已解锁';
        if (cleanup) {
          msg += `\n${cleanup.message || '已保留 OA 数据和行动项台账，不会自动删除。'}`;
        }
        alert(msg);
      }
      else alert(r.error || '解锁失败');
    } catch { alert('解锁失败'); }
    finally { setIsLocking(false); }
  };

  const handleExport = async (format: 'word' | 'pdf') => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      const r = await res.json();
      if (r.success) {
        // Convert base64 data URI to Blob for reliable download
        const dataUri = r.data.fileUrl as string;
        const [meta, b64] = dataUri.split(',');
        const mime = meta.match(/:(.*?);/)?.[1] || 'application/octet-stream';
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const blob = new Blob([arr], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = r.data.filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert(r.error || '导出失败');
      }
    } catch { alert('导出失败'); }
  };

  const handleUpdateProject = async (projectId: string) => {
    setIsUpdatingProject(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const r = await res.json();
      if (r.success) {
        setMeeting(r.data);
      } else {
        alert(r.error || '关联项目失败');
      }
    } catch {
      alert('关联项目失败');
    } finally {
      setIsUpdatingProject(false);
    }
  };

  const handleUpdateType = async (newType: string) => {
    if (!newType || newType === meeting?.type) return;
    setIsUpdatingType(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType }),
      });
      const r = await res.json();
      if (r.success) {
        setMeeting(r.data);
      } else {
        alert(r.error || '修改会议类型失败');
      }
    } catch {
      alert('修改会议类型失败');
    } finally {
      setIsUpdatingType(false);
    }
  };

  const confirmAction = useCallback(async (id: string) => {
    setActionItems((prev: ActionItem[]) => prev.map((a: ActionItem) => a.id === id ? { ...a, status: 'confirmed' as const, confirmed_by: '当前用户', confirmed_at: new Date().toISOString() } : a));
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed', confirmed_by: '当前用户', _meetingId: meetingId }),
    }).catch(() => {});
  }, [meetingId]);

  const confirmAllLow = useCallback(async () => {
    const lowItems = actionItems.filter(
      (a: ActionItem) => (a.confidence_owner < 0.7 || a.confidence_date < 0.7) && a.status === 'pending'
    );
    for (const item of lowItems) {
      await confirmAction(item.id);
    }
  }, [actionItems, confirmAction]);

  const startEdit = (item: ActionItem) => {
    setEditingAction(item.id);
    setEditBuf({
      description: item.description,
      owner: item.owner,
      ownerLoginId: item.ownerLoginId,
      ownerOaId: item.ownerOaId,
      dept: item.dept,
      proposer: item.proposer,
      proposerLoginId: item.proposerLoginId,
      proposerOaId: item.proposerOaId,
      due_date: item.due_date,
      // 类型不预计算：保留 undefined 交给服务端按"有无日期"兜底，
      // 避免新增项先算出 tbd、后填日期时 tbd 已固化导致锁定后日期不显示
      due_date_type: (item as any).due_date_type,
      priority: item.priority,
    });
  };

  const saveEdit = useCallback(async (id: string) => {
    setActionItems((prev: ActionItem[]) => prev.map((a: ActionItem) => a.id === id ? { ...a, ...editBuf } : a));
    setEditingAction(null);

    if (id.startsWith('new-')) {
      // 新增项：调 addActionItem API 写入台账，仅回填该行的 dbId/originalId（id 保持不变，行不重挂载）
      try {
        const res = await fetch(`/api/meetings/${meetingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addActionItem: { id, ...editBuf, status: editBuf.status || 'confirmed', confidence_owner: 1, confidence_date: 1 } }),
        });
        const r = await res.json();
        if (r.success && r.createdAction) {
          const created = r.createdAction;
          setActionItems((prev: ActionItem[]) => prev.map((a: ActionItem) =>
            a.id === id ? { ...a, dbId: created.id ?? a.dbId, originalId: created.originalId ?? a.originalId } : a
          ));
        } else {
          alert(r.error || '新增行动项保存失败，请重试');
        }
      } catch { alert('新增行动项保存失败，请检查网络后重试'); }
    } else {
      fetch(`/api/actions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editBuf, _meetingId: meetingId }),
      }).then(r => r.json()).then(r => {
        if (!r.success) alert(r.error || '行动项保存失败');
      }).catch(() => { alert('行动项保存失败，请检查网络后重试'); });
    }
  }, [editBuf, meetingId]);

  // 行内即时保存：改单个字段直接 PATCH，无需进入编辑态
  const flashSaved = useCallback((id: string) => {
    setSavedFlash(id);
    setTimeout(() => setSavedFlash(prev => prev === id ? null : prev), 1500);
  }, [setSavedFlash]);
  const patchAction = useCallback(async (id: string, patch: Partial<ActionItem>) => {
    setActionItems((prev: ActionItem[]) => prev.map((a: ActionItem) => a.id === id ? { ...a, ...patch } : a));
    flashSaved(id);
    if (id.startsWith('new-')) {
      // 新增项首次编辑：走 addActionItem 写台账拿真实 ID（幂等，重复提交不产生重复行）
      const cur = actionItems.find(a => a.id === id);
      if (!cur) return;
      try {
        const res = await fetch(`/api/meetings/${meetingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addActionItem: { ...cur, ...patch, status: 'confirmed', confidence_owner: 1, confidence_date: 1 } }),
        });
        const r = await res.json();
        if (r.success && r.createdAction) {
          const created = r.createdAction;
          setActionItems((prev: ActionItem[]) => prev.map((a: ActionItem) =>
            a.id === id ? { ...a, dbId: created.id ?? a.dbId, originalId: created.originalId ?? a.originalId } : a
          ));
        } else {
          alert(r.error || '行动项保存失败，请重试');
        }
      } catch { alert('行动项保存失败，请检查网络后重试'); }
    } else {
      fetch(`/api/actions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, _meetingId: meetingId }),
      }).then(r => r.json()).then(r => {
        if (!r.success) alert(r.error || '行动项保存失败');
      }).catch(() => { alert('行动项保存失败，请检查网络后重试'); });
    }
  }, [actionItems, meetingId]);

  const deleteAction = useCallback(async (id: string) => {
    setActionItems((prev: ActionItem[]) => prev.filter((a: ActionItem) => a.id !== id));
    await fetch(`/api/actions/${id}?meetingId=${meetingId}`, { method: 'DELETE' }).catch(() => {});
  }, [meetingId]);

  const addAction = () => {
    const newItem: ActionItem = {
      id: nextTempActionId(),
      dbId: null,
      originalId: null,
      description: '新行动项',
      owner: null, due_date: null,
      proposer: (meeting as any)?.defaultProposer || null,
      proposerLoginId: (meeting as any)?.defaultProposerLoginId || null,
      proposerOaId: (meeting as any)?.defaultProposerOaId || null,
      priority: 'medium', status: 'confirmed',
      confidence_owner: 1, confidence_date: 1,
      evidence_files: [],
    };
    setActionItems((prev: ActionItem[]) => [...prev, newItem]);
    startEdit(newItem);
    setTimeout(() => {
      const el = document.getElementById(`action-${newItem.id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const duplicateAction = (item: ActionItem) => {
    const dup: ActionItem = {
      ...item,
      id: nextTempActionId(),
      dbId: null,
      originalId: null,
      description: `${item.description}（副本）`,
      status: 'confirmed',
      confidence_owner: 1,
      confidence_date: 1,
      evidence_files: [],
    };
    setActionItems((prev: ActionItem[]) => [...prev, dup]);
    startEdit(dup);
    setTimeout(() => {
      const el = document.getElementById(`action-${dup.id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  // 纪要保存（带乐观锁）：base_updated_at 与服务端不一致 → 409，确认后可强制覆盖
  const saveMinutesToServer = async (updated: any, force = false): Promise<boolean> => {
    const payload: any = { minutes: updated };
    const baseUpdatedAt = (meeting as any)?.updatedAt ?? (meeting as any)?.updated_at;
    if (!force && baseUpdatedAt) payload.base_updated_at = baseUpdatedAt;
    const res = await fetch(`/api/meetings/${meetingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const r = await res.json().catch(() => ({ success: false as const }));
    if (res.status === 409 && (r as any).conflict) {
      if (window.confirm('检测到他人已保存过更新版本，继续保存将覆盖对方的修改。是否继续？')) {
        return saveMinutesToServer(updated, true);
      }
      return false;
    }
    if (!r.success) { alert((r as any).error || '保存失败'); return false; }
    setMinutes(updated);
    // 自动更新派生的摘要和行动项
    if ((r as any).derived?.summary) setSummary(convertSummary((r as any).derived.summary));
    if ((r as any).derived?.actionItems) setActionItems(mapActionItems((r as any).derived.actionItems));
    return true;
  };

  const transcript = meeting?.content || meeting?.input_content || meeting?.transcript || '';

  useEffect(() => {
    if (!isEditingTranscript) {
      setTranscriptDraft(transcript);
    }
  }, [transcript, isEditingTranscript]);

  const isLocked = meeting?.status === 'locked';

  const handleSaveTranscript = async () => {
    setIsSavingTranscript(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: transcriptDraft,
          input_content: transcriptDraft,
        }),
      });
      const r = await res.json();
      if (!r.success) {
        alert(r.error || '保存失败');
        return;
      }
      setMeeting(prev => prev ? {
        ...prev,
        content: transcriptDraft,
        input_content: transcriptDraft,
      } : prev);
      setIsEditingTranscript(false);
    } catch {
      alert('保存失败，请重试');
    } finally {
      setIsSavingTranscript(false);
    }
  };

  // 行动项编辑缓冲类型
  const editBufAny = editBuf as any;

  if (!meeting) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            {loadError ? (
              <>
                <p className="text-sm text-red-500 mb-3">{loadError}</p>
                <button
                  type="button"
                  onClick={loadMeeting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  重新加载
                </button>
              </>
            ) : (
              <>
                <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mx-auto mb-3" />
                <p className="text-sm text-slate-500">加载中...</p>
              </>
            )}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* ── 顶栏 ── */}
      <div className="flex items-center justify-between mb-4 -mt-2">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => window.history.back()} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <div className="min-w-0 flex items-center gap-2 relative">
            {/* 状态标签前置 */}
            {isLocked ? (
              <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex-shrink-0">
                <Lock className="w-3 h-3" /> 已归档
              </span>
            ) : hasUnconfirmedLow ? (
              <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                <AlertTriangle className="w-3 h-3" /> 待确认
              </span>
            ) : (meeting as any).status === 'review' ? (
              <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                <AlertTriangle className="w-3 h-3" /> 待确认
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 flex-shrink-0">
                <FileText className="w-3 h-3" /> 草稿
              </span>
            )}
            <InlineEdit
              value={meeting.title}
              onChange={async (v) => {
                if (!v || v === meeting.title) return;
                try {
                  const res = await fetch(`/api/meetings/${meetingId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: v }),
                  });
                  const r = await res.json();
                  if (r.success) {
                    setMeeting(prev => prev ? { ...prev, title: v } : prev);
                  } else {
                    alert(r.error || '修改标题失败');
                  }
                } catch {
                  alert('网络错误，修改标题失败');
                }
              }}
              className="text-lg font-semibold text-slate-900 truncate cursor-text"
              onMouseEnter={() => setShowSummaryTooltip(true)}
              onMouseLeave={() => setShowSummaryTooltip(false)}
            />

            {/* AI摘要预览Tooltip */}
            {showSummaryTooltip && minutes?.meetingContent && (
              <div className="absolute top-full left-0 mt-2 z-50 w-80 bg-slate-900 text-white text-xs rounded-lg p-3 shadow-xl">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-3 h-3 text-blue-400" />
                  <span className="font-semibold text-blue-300">AI摘要预览</span>
                </div>
                <p className="text-slate-300 leading-relaxed line-clamp-3">{minutes.meetingContent}</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 项目关联选择器 - 移至操作栏左侧，更显眼 */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${((meeting as any).projectId || (meeting as any).project_id) ? 'bg-blue-50 border-blue-100' : 'bg-slate-50 border-slate-200'}`}>
            <FolderOpen className={`w-3.5 h-3.5 ${((meeting as any).projectId || (meeting as any).project_id) ? 'text-blue-500' : 'text-slate-400'}`} />
            <select
              value={(meeting as any).projectId || (meeting as any).project_id || ''}
              onChange={(e) => handleUpdateProject(e.target.value)}
              disabled={isUpdatingProject || isLocked}
              className="text-xs bg-transparent border-none text-slate-700 font-bold focus:outline-none focus:ring-0 max-w-[120px] truncate cursor-pointer disabled:cursor-not-allowed"
            >
              <option value="">未关联项目</option>
              {(Array.isArray(projects) ? projects : []).filter(Boolean).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {isUpdatingProject && <RefreshCw className="w-3 h-3 text-blue-500 animate-spin ml-1" />}
          </div>

          {/* 会议类型选择器 */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all ${meeting?.type ? 'bg-purple-50 border-purple-100' : 'bg-slate-50 border-slate-200'}`}>
            <Flag className={`w-3.5 h-3.5 ${meeting?.type ? 'text-purple-500' : 'text-slate-400'}`} />
            <select
              value={meeting?.type || ''}
              onChange={(e) => handleUpdateType(e.target.value)}
              disabled={isUpdatingType}
              className="text-xs bg-transparent border-none text-slate-700 font-bold focus:outline-none focus:ring-0 max-w-[120px] truncate cursor-pointer disabled:cursor-not-allowed"
            >
              {meetingTypes.length === 0 && meeting?.type && (
                <option value={meeting.type}>{meeting.type}</option>
              )}
              {meetingTypes.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
            {isUpdatingType && <RefreshCw className="w-3 h-3 text-purple-500 animate-spin ml-1" />}
          </div>

          <div className="h-4 w-px bg-slate-200 mx-1" />

          {hasUnconfirmedLow && !isLocked && (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5" />
              {actionItems.filter(a => (a.confidence_owner < 0.7 || a.confidence_date < 0.7) && a.status === 'pending').length} 项待确认
            </span>
          )}
          {!isLocked && (
            <button
              onClick={async () => {
                if (!confirm('确定要立即向所有责任人推送本次会议的待办任务吗？')) return;
                try {
                  const res = await fetch('/api/chat/push-now', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meetingId })
                  });
                  const d = await res.json();
                  if (d.success) {
                    alert(`推送成功！共触达 ${d.data.sent} 位责任人。`);
                  } else {
                    alert(`推送失败: ${d.error}`);
                  }
                } catch (e) {
                  alert('推送请求失败，请检查网络');
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold border border-indigo-100 transition-colors"
              title="推送本次会议待办到 IM"
            >
              <Send className="w-3.5 h-3.5" />
              推送
            </button>
          )}
          {!isLocked && (
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isGenerating ? (genStep || '生成中...') : '重新生成'}
            </button>
          )}
          <button
            onClick={handleLock}
            disabled={isLocked || isLocking || hasUnconfirmedLow}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isLocked
                ? 'bg-emerald-100 text-emerald-700 cursor-default'
                : hasUnconfirmedLow
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isLocked ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            {isLocked ? '已归档' : isLocking ? '归档中...' : '归档纪要'}
          </button>
          {isLocked && (
            <button
              onClick={handleUnlock}
              disabled={isLocking}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors"
            >
              {isLocking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              {isLocking ? '解除归档中...' : '解除归档'}
            </button>
          )}
        </div>
      </div>

      {/* 顶部统计小模块 - 已隐藏 */}
      {/* <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-slate-100 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-500">
            <Check className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs text-slate-500">行动项</p>
            <p className="text-sm font-bold text-slate-800">{actionItems.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-500">
            <User className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs text-slate-500">参与人数</p>
            <p className="text-sm font-bold text-slate-800">{meeting.participants?.length || 0}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-500">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs text-slate-500">议题数</p>
            <p className="text-sm font-bold text-slate-800">{minutes?.sections?.length || 0}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-500">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs text-slate-500">已完成</p>
            <p className="text-sm font-bold text-slate-800">{actionItems.filter(a => a.status === 'done').length}</p>
          </div>
        </div>
      </div> */}

      {/* AI超时提示 */}
      {aiTimeout && (
        <div className="mb-3 flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>AI生成耗时较长（已超10分钟），请检查网络或重试</span>
          <button onClick={handleGenerate} className="ml-auto flex items-center gap-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> 重试
          </button>
        </div>
      )}

      {/* 调试入口 */}
      {debugMarkdown && (
        <div className="mb-3">
          <button
            onClick={() => setShowDebug(true)}
            className="text-xs text-slate-400 hover:text-blue-600 transition-colors"
          >
            [调试] 查看 AI 原始输出
          </button>
        </div>
      )}

      {/* 调试弹窗 */}
      {showDebug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 uppercase tracking-wide">DEBUG</span>
                <h3 className="text-sm font-bold text-slate-900">Step 1A 原始 Markdown</h3>
              </div>
              <button onClick={() => setShowDebug(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-slate-50">
              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono">{debugMarkdown}</pre>
            </div>
          </div>
        </div>
      )}

      {/* ── 双栏主体 ── */}
      <div className="flex gap-4 h-[calc(100vh-10rem)] overflow-hidden">

        {/* ─ 左栏：转写文本 ─ */}
        <div className="w-[42%] bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden flex-shrink-0">
          {/* 录音组件 */}
          {!isLocked && (
            <div className="px-3 pt-3 pb-1">
              <MeetingRecorder
                disabled={isLocked}
                participantCount={meeting.participants?.length || 0}
                transcriptHints={{
                  organizer: meeting.organizer,
                  participants: meeting.participants || [],
                  terms: [meeting.title, meeting.type],
                }}
                onRecordingEnd={async (text, audioBlob) => {
                  if (!text) return;
                  // 追加转写文本到会议内容
                  const newContent = (meeting?.content || meeting?.input_content || '') + (text ? '\n' + text : '');
                  await fetch(`/api/meetings/${meetingId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: newContent, input_content: newContent }),
                  });
                  loadMeeting();
                }}
              />
            </div>
          )}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="text-sm font-medium text-slate-700">原始转写文本</span>
            {!isLocked && (
              <div className="ml-auto flex items-center gap-2">
                {isEditingTranscript ? (
                  <>
                    <button
                      onClick={() => {
                        setTranscriptDraft(transcript);
                        setIsEditingTranscript(false);
                      }}
                      disabled={isSavingTranscript}
                      className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveTranscript}
                      disabled={isSavingTranscript}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isSavingTranscript ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      {isSavingTranscript ? '保存中...' : '保存'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditingTranscript(true)}
                    className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  >
                    编辑内容
                  </button>
                )}
              </div>
            )}
            <div className={`${!isLocked ? '' : 'ml-auto'} relative flex-1 max-w-[160px]`}>
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                ref={searchRef}
                placeholder="搜索..."
                value={searchText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
                disabled={isEditingTranscript}
                className="w-full pl-7 pr-2 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!transcript && !isEditingTranscript ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm gap-2">
                <FileText className="w-10 h-10 opacity-30" />
                <span>暂无转写文本</span>
              </div>
            ) : isEditingTranscript ? (
              <Textarea
                value={transcriptDraft}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTranscriptDraft(e.target.value)}
                placeholder="请输入会议内容或修正转写文本..."
                className="min-h-full h-full resize-none border-slate-200 text-sm leading-relaxed"
              />
            ) : (
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {searchText.trim()
                  ? transcript.split(new RegExp(`(${searchText})`, 'gi')).map((part: string, i: number) =>
                    part.toLowerCase() === searchText.toLowerCase()
                      ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">{part}</mark>
                      : part
                  )
                  : transcript
                }
              </div>
            )}
          </div>
        </div>

        {/* ─ 右栏：摘要/行动项/导出 ─ */}
        <div className="flex-1 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden">
          {/* Tab导航 */}
          <div className="flex border-b border-slate-100">
            {([
              { key: 'minutes', label: '纪要', icon: FileText },
              // { key: 'summary', label: '摘要', icon: Sparkles },
              { key: 'actions', label: '行动项', icon: Check, badge: actionItems.filter(a => a.status !== 'done').length },
              // { key: 'mindmap', label: '思维导图', icon: Network },
              // { key: 'linked', label: '关联视图', icon: GitBranch },
              { key: 'export', label: '导出', icon: Download },
              { key: 'logs', label: '操作记录', icon: History },
            ]).map(({ key, label, icon: Icon, badge }: any) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {badge !== undefined && badge > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full">
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* ── Tab: 纪要 ── */}
            {activeTab === 'minutes' && (
              <div className="p-5">
                {meeting && minutes ? (
                  <MeetingMinutesBlock minutes={minutes} meeting={meeting}
                    onRegenerate={handleGenerate}
                    isGenerating={isGenerating}
                    genStep={genStep}
                    generateProvider={generateProvider}
                    setGenerateProvider={setGenerateProvider}
                    actionItems={actionItems}
                    onGoActions={() => setActiveTab('actions')}
                    onSave={async (updated) => {
                    const ok = await saveMinutesToServer(updated);
                    if (!ok) throw new Error('save-cancelled');
                  }} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4">
                    <FileText className="w-12 h-12 opacity-30" />
                    <p className="text-sm">尚未生成纪要，选择大模型后点击生成</p>
                    <div className="flex items-center gap-2">
                      <select
                        value={generateProvider}
                        onChange={e => setGenerateProvider(e.target.value as any)}
                        disabled={isGenerating}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white text-slate-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="tencent">腾讯元宝（混元 Pro）</option>
                        <option value="qwen">阿里千问（Qwen Max）</option>
                        <option value="siliconflow">硅基流动（DeepSeek V3）</option>
                        <option value="deepseek">DeepSeek官方（V4 Flash）</option>
                        <option value="deepseek-v4-pro">DeepSeek官方（V4 Pro）</option>
                      </select>
                      <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                      >
                        {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {isGenerating ? genStep || 'AI生成中...' : '开始生成纪要'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: 摘要（从纪要派生） ── */}
            {activeTab === 'summary' && (
              <div className="p-5 space-y-5">
                {!minutes ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4">
                    <Sparkles className="w-12 h-12 opacity-30" />
                    <p className="text-sm">暂无AI摘要</p>
                    <button
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                    >
                      {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {isGenerating ? '生成中...' : '点击生成AI摘要'}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* 会议概述 */}
                    {(minutes.meetingContent || minutes.conclusion) && (
                      <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4">
                        <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">会议概述</h3>
                        <InlineEdit
                          value={minutes.meetingContent || minutes.conclusion || ''}
                          onChange={async (v) => {
                            const updated = { ...minutes, meetingContent: v };
                            await saveMinutesToServer(updated);
                          }}
                          className="text-sm text-slate-700 leading-relaxed block w-full" 
                          tag="p" 
                        />
                      </div>
                    )}

                    {/* 核心决议 */}
                    {(() => {
                      const decisions = minutes.sections?.flatMap((sec: any) =>
                        sec.items?.flatMap((item: any) =>
                          item.points?.filter((p: any) => p.label === '决议' || p.label === '共识').map((p: any) => ({
                            subtitle: item.subtitle,
                            text: p.text,
                            bullets: p.bullets,
                          })) || []
                        ) || []
                      ) || [];
                      return decisions.length > 0 ? (
                        <div className="border border-purple-200 bg-purple-50/50 rounded-xl p-4">
                          <h3 className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-3">核心决议</h3>
                          <div className="space-y-3">
                            {decisions.map((d: any, i: number) => (
                              <div key={i}>
                                <p className="text-sm font-medium text-slate-800">{d.subtitle}</p>
                                <p className="text-sm text-slate-600 mt-0.5">{d.text}</p>
                                {d.bullets?.length > 0 && (
                                  <ul className="mt-1 ml-4 space-y-0.5">
                                    {d.bullets.map((b: string, j: number) => (
                                      <li key={j} className="text-xs text-slate-500 list-disc">{b}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null;
                    })()}

                    {/* 行动项概览 */}
                    {(minutes.actionTable?.length > 0 || actionItems.length > 0) && (
                      <div className="border border-amber-200 bg-amber-50/50 rounded-xl p-4">
                        <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">行动项概览</h3>
                        <div className="space-y-2">
                          {actionItems.length > 0 ? actionItems.map((item: ActionItem, i: number) => (
                            <div key={item.id} className="flex items-start gap-3 text-sm">
                              <span className="w-5 h-5 bg-amber-200 text-amber-800 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <span className="text-slate-800">{item.description}</span>
                                {item.owner && (
                                  <>
                                    <span className="text-slate-400 mx-1.5">→</span>
                                    <span className="text-slate-600 font-medium">{item.owner}</span>
                                  </>
                                )}
                                {item.due_date && <span className="text-slate-400 text-xs ml-2">({item.due_date})</span>}
                              </div>
                            </div>
                          )) : minutes.actionTable?.map((row: any, i: number) => (
                            <div key={i} className="flex items-start gap-3 text-sm">
                              <span className="w-5 h-5 bg-amber-200 text-amber-800 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{row.seq || i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <span className="text-slate-800">{row.task}</span>
                                <span className="text-slate-400 mx-1.5">→</span>
                                <span className="text-slate-600 font-medium">{row.owner}</span>
                                {row.goal && <span className="text-slate-400 text-xs ml-2">({row.goal})</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 总结 */}
                    {minutes.conclusion && (
                      <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-4">
                        <h3 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">会议总结</h3>
                        <p className="text-sm text-slate-700 leading-relaxed">{minutes.conclusion}</p>
                      </div>
                    )}
                    <p className="text-xs text-slate-400 text-center pt-2">* 内容由AI基于纪要生成，仅供参考</p>
                  </>
                )}
              </div>
            )}

            {/* ── Tab: 行动项 ── */}
            {activeTab === 'actions' && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0 bg-white">
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-slate-500">{actionItems.length} 条行动项</p>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value as any)}
                      className="text-xs border border-slate-200 rounded-lg bg-slate-50 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                      <option value="all">全部状态</option>
                      <option value="pending">待处理</option>
                      <option value="confirmed">已确认</option>
                      <option value="done">已完成</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasUnconfirmedLow && !isLocked && (
                      <button
                        onClick={confirmAllLow}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> 一键确认全部
                      </button>
                    )}
                    {!isLocked && (
                      <button
                        onClick={addAction}
                        className="flex items-center gap-1 text-xs text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5" /> 新增
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {actionItems.filter(item => {
                    if (statusFilter === 'all') return true;
                    return item.status === statusFilter;
                  }).map((item: ActionItem) => {
                    const justSaved = savedFlash === item.id;
                    return (
                      <div
                        key={item.id}
                        id={`action-${item.id}`}
                        className={`group relative border rounded-xl p-3 transition-all ${
                          item.status === 'confirmed' || item.status === 'done'
                            ? 'border-emerald-200 bg-emerald-50/50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        {/* 已保存提示 */}
                        {justSaved && (
                          <span className="absolute top-2 right-2 text-[10px] text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200 z-10 animate-in fade-in">已保存</span>
                        )}
                        {/* 描述：点击直接编辑，失焦自动保存 */}
                        <div className="flex items-start gap-2 mb-2">
                          <ContentEditableText
                            value={item.description}
                            onCommit={(v) => { if (v !== item.description) patchAction(item.id, { description: v }); }}
                            readOnly={isLocked}
                            className="flex-1 text-sm text-slate-800 leading-snug"
                          />
                        </div>
                        {/* 字段控件行：每个独立即时保存 */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* 提出人 */}
                          <InlineUserField
                            icon={<User className="w-3 h-3 text-violet-500" />}
                            label="提出"
                            value={item.proposer || ''}
                            placeholder="提出人"
                            tone="violet"
                            readOnly={isLocked}
                            onPick={(name, extra) => patchAction(item.id, { proposer: name, ...extra } as any)}
                          />
                          {/* 负责人 */}
                          <InlineUserField
                            icon={<User className="w-3 h-3 text-blue-500" />}
                            label="负责"
                            value={item.owner || ''}
                            placeholder="负责人"
                            tone="blue"
                            readOnly={isLocked}
                            onPick={(name, extra) => patchAction(item.id, { owner: name, ...extra, confidence_owner: 1 } as any)}
                          />
                          {/* 节点模式 */}
                          {!isLocked && (
                            <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
                              {[{ k: 'date', icon: '📅', tip: '日期' }, { k: 'continuous', icon: '🔄', tip: '持续' }, { k: 'tbd', icon: '❓', tip: '待定' }].map(opt => (
                                <button key={opt.k} type="button" title={opt.tip}
                                  onClick={() => patchAction(item.id, { due_date_type: opt.k, due_date: opt.k === 'date' ? (item.due_date || new Date().toISOString().slice(0, 10)) : '' } as any)}
                                  className={`w-6 h-6 rounded text-[11px] flex items-center justify-center transition-all ${(item.due_date_type || 'date') === opt.k ? 'bg-white shadow-sm' : 'opacity-50 hover:opacity-80'}`}>
                                  {opt.icon}
                                </button>
                              ))}
                            </div>
                          )}
                          {/* 日期 */}
                          {(item.due_date_type || 'date') === 'date' && (
                            isLocked ? (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
                                <CalendarClock className="w-3 h-3" />{item.due_date || '未定'}
                              </span>
                            ) : (
                              <input type="date" value={item.due_date || ''}
                                onChange={(e) => patchAction(item.id, { due_date: e.target.value, confidence_date: 1 } as any)}
                                className="h-7 text-xs border border-slate-200 rounded-lg px-2 bg-white" />
                            )
                          )}
                          {/* 优先级：三态切换 */}
                          {!isLocked ? (
                            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                              {([['high', '高', 'text-red-600'],['medium', '中', 'text-amber-600'],['low', '低', 'text-emerald-600']] as const).map(([k, label, cls]) => (
                                <button key={k} type="button" title={label}
                                  onClick={() => patchAction(item.id, { priority: k as ActionItem['priority'] })}
                                  className={`px-2 h-6 rounded text-[11px] font-medium transition-all ${(item.priority || 'medium') === k ? `bg-white shadow-sm ${cls}` : 'text-slate-400 hover:text-slate-600'}`}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${PRIORITY_COLOR[item.priority]}`}>{PRIORITY_LABEL[item.priority]}</span>
                          )}
                          {/* 锁定态：显示节点类型 */}
                          {isLocked && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
                              (item.due_date_type || 'date') === 'date' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                              (item.due_date_type || 'date') === 'continuous' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                              'bg-slate-50 text-slate-500 border-slate-200'
                            }`}>
                              {(item.due_date_type || 'date') === 'date' ? '📅 日期' :
                               (item.due_date_type || 'date') === 'continuous' ? '🔄 持续' : '❓ 待定'}
                            </span>
                          )}
                          {/* 确认状态 */}
                          {item.confirmed_by && (
                            <span className="text-xs text-emerald-600 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> {item.confirmed_by}
                            </span>
                          )}
                          {/* 操作按钮 */}
                          {!isLocked && (
                            <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => duplicateAction(item)} title="复制" className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => deleteAction(item.id)} title="删除" className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                        {item.source_sentence && (
                          <p className="mt-1.5 text-xs text-slate-400 italic border-l-2 border-slate-200 pl-2 line-clamp-1">
                            "{item.source_sentence}"
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {actionItems.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400 text-sm gap-2">
                      <Check className="w-8 h-8 opacity-30" />
                      <span>暂无行动项</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab: 思维导图 ── */}
            {activeTab === 'mindmap' && (
              <div className="p-5">
                {summary.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4">
                    <Network className="w-12 h-12 opacity-30" />
                    <p className="text-sm">先生成摘要，再查看思维导图</p>
                    <button
                      onClick={() => setActiveTab('summary')}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                      去生成摘要
                    </button>
                  </div>
                ) : (
                  <MeetingMindMap
                    title={meeting?.title || '会议'}
                    topics={summary
                      .filter(s => s.section_type === 'agenda')
                      .map(s => ({ topic: s.content.substring(0, 50), description: s.content }))}
                    decisions={summary
                      .filter(s => s.section_type === 'decision')
                      .map(s => ({ decision: s.content, rationale: '', stakeholders: [] }))}
                    risks={summary
                      .filter(s => s.section_type === 'risk')
                      .map(s => ({ risk: s.content, mitigation: '' }))}
                    actionItems={actionItems.map(a => ({
                      description: a.description,
                      assignee: a.owner || undefined,
                      priority: a.priority
                    }))}
                    nextSteps={summary
                      .filter(s => s.section_type === 'next_step')
                      .map(s => ({ step: s.content, owner: '' }))}
                  />
                )}
              </div>
            )}

            {/* ── Tab: 关联视图 ── */}
            {activeTab === 'linked' && (
              <div className="p-5">
                {summary.length === 0 || actionItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4">
                    <GitBranch className="w-12 h-12 opacity-30" />
                    <p className="text-sm">需要摘要和行动项才能查看关联</p>
                    <button
                      onClick={() => setActiveTab(summary.length === 0 ? 'summary' : 'actions')}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                      {summary.length === 0 ? '去生成摘要' : '去查看行动项'}
                    </button>
                  </div>
                ) : (
                  <SummaryActionSplit
                    summary={summary}
                    actionItems={actionItems}
                    onActionClick={(actionId) => {
                      setEditingAction(actionId);
                      setActiveTab('actions');
                    }}
                  />
                )}
              </div>
            )}

            {/* ── Tab: 导出 ── */}
            {activeTab === 'export' && (
              <div className="p-6 space-y-6">
                {!minutes ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4">
                    <Download className="w-12 h-12 opacity-30" />
                    <p className="text-sm">尚未生成纪要，请先生成后再导出</p>
                  </div>
                ) : (
                  <>
                    {/* 导出预览信息 */}
                    <div className="rounded-xl p-4 border border-slate-200 bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center bg-blue-100">
                          <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{minutes.title || meeting.title}</p>
                          <p className="text-xs text-slate-500">
                            {minutes.meetingDate} · {meeting.participants?.length || 0}人参会 · {minutes.sections?.length || 0}个议题 · {minutes.actionTable?.length || 0}条行动项
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* 导出按钮 */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">推送与分发</p>
                      <button
                        onClick={async () => {
                          if (!confirm('确定要立即向所有责任人推送本次会议的待办任务吗？')) return;
                          try {
                            const res = await fetch('/api/chat/push-now', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ meetingId })
                            });
                            const d = await res.json();
                            if (d.success) {
                              alert(`推送成功！共触达 ${d.data.sent} 位责任人。`);
                            } else {
                              alert(`推送失败: ${d.error}`);
                            }
                          } catch (e) {
                            alert('推送请求失败，请检查网络');
                          }
                        }}
                        className="w-full flex items-center gap-4 p-4 border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-all text-left group"
                      >
                        <span className="text-2xl">⚡</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-indigo-700 group-hover:text-indigo-800">推送到 IM 助手</p>
                          <p className="text-xs text-indigo-400">立即通过自研 IM 对话系统向所有行动项责任人发送卡片通知</p>
                        </div>
                        <Send className="w-4 h-4 text-indigo-400 group-hover:text-indigo-600" />
                      </button>
                      <button
                        onClick={() => handleExport('word')}
                        className="w-full flex items-center gap-4 p-4 border border-slate-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all text-left group"
                      >
                        <span className="text-2xl">📄</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-700 group-hover:text-blue-700">下载 Word 文档</p>
                          <p className="text-xs text-slate-400">.docx 格式，完整纪要（概述 + 讨论 + 行动项表格 + 总结）</p>
                        </div>
                        <Download className="w-4 h-4 text-slate-400 group-hover:text-blue-500" />
                      </button>
                      <button
                        onClick={() => handleExport('pdf')}
                        className="w-full flex items-center gap-4 p-4 border border-slate-200 rounded-xl hover:border-red-300 hover:bg-red-50 transition-all text-left group"
                      >
                        <span className="text-2xl">📕</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-700 group-hover:text-red-700">下载 PDF 文档</p>
                          <p className="text-xs text-slate-400">.pdf 格式，适合打印和分发，格式固定不可编辑</p>
                        </div>
                        <Download className="w-4 h-4 text-slate-400 group-hover:text-red-500" />
                      </button>
                    </div>

                    {/* 导出内容预览 */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">内容预览</p>
                      <div className="rounded-xl border border-slate-200 bg-white p-4 max-h-64 overflow-y-auto">
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono leading-relaxed">
{`${minutes.title || meeting.title}
${'─'.repeat(40)}
会议主题：${minutes.meetingTheme || meeting.title}
会议日期：${minutes.meetingDate || ''}
参会人员：${meeting.participants?.join('、') || ''}

【会议概述】
${minutes.meetingContent || ''}

${minutes.sections?.map((sec: any) => `${sec.title}\n${sec.items?.map((item: any) => `  ${item.seq}. ${item.subtitle}\n${item.points?.map((p: any) => `     [${p.label}] ${p.text}`).join('\n') || ''}`).join('\n') || ''}`).join('\n\n') || ''}

【行动项】
${minutes.actionTable?.map((row: any) => `  ${row.seq}. ${row.task} → ${row.owner} (${row.goal || ''})`).join('\n') || ''}

【会议总结】
${minutes.conclusion || ''}`}
                        </pre>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Tab: 操作记录 ── */}
            {activeTab === 'logs' && (
              <div className="p-6">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-1">操作历史</h3>
                  <p className="text-xs text-slate-400">查看该会议的所有操作记录</p>
                </div>
                <OperationLog meetingId={meetingId} />
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
