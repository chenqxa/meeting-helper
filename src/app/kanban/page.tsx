'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  AlertTriangle, User, Calendar, Clock, CheckCircle2,
  Plus, GripVertical, ArrowRight, Search, Target, RefreshCw,
  FileText, Eye, Pencil, Ban, Paperclip, X, Save, ShieldAlert
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';

// 模拟当前登录用户 — 后期替换为真实 session
const CURRENT_USER = '管理员';

interface KanbanCard {
  id: string;
  description: string;
  owner?: string | null;
  due_date?: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'confirmed' | 'in_progress' | 'done' | 'blocked';
  confidence_owner: number;
  confidence_date: number;
  source_sentence?: string;
  initial_result?: string | null;
  meeting_title?: string;
  meeting_id?: string;
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

type ColumnKey = 'pending' | 'in_progress' | 'done' | 'blocked';
type ViewMode = 'all' | 'my';

const COLUMNS: { key: ColumnKey; label: string; color: string; dot: string; bg: string }[] = [
  { key: 'pending',     label: '待确认', color: 'text-slate-600',   dot: 'bg-slate-400',   bg: 'bg-slate-50' },
  { key: 'in_progress', label: '进行中', color: 'text-blue-600',    dot: 'bg-blue-500',    bg: 'bg-blue-50/60' },
  { key: 'done',        label: '已完成', color: 'text-emerald-600', dot: 'bg-emerald-500', bg: 'bg-emerald-50/60' },
  { key: 'blocked',     label: '阻塞中', color: 'text-red-600',     dot: 'bg-red-500',     bg: 'bg-red-50/60' },
];

const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-green-100 text-green-700 border-green-200',
};
const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };

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

export default function KanbanPage() {
  const router = useRouter();
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterMeeting, setFilterMeeting] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColumnKey | null>(null);

  // 组织架构数据
  const [orgEmployees, setOrgEmployees] = useState<{ id: string; name: string; department: string }[]>([]);

  // 编辑对话框
  const [editCard, setEditCard] = useState<KanbanCard | null>(null);
  const [editForm, setEditForm] = useState({ description: '', owner: '', due_date: '', priority: 'medium' as KanbanCard['priority'] });

  // 完成对话框
  const [doneCard, setDoneCard] = useState<KanbanCard | null>(null);
  const [doneNote, setDoneNote] = useState('');
  const [doneFiles, setDoneFiles] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 阻塞对话框
  const [blockCard, setBlockCard] = useState<KanbanCard | null>(null);
  const [blockReason, setBlockReason] = useState('');
  // 拖拽到 blocked 列时暂存
  const [pendingBlockDragId, setPendingBlockDragId] = useState<string | null>(null);

  const loadActions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/actions');
      const r = await res.json();
      if (r.success) setCards(r.data || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

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

  useEffect(() => { loadActions(); loadOrgEmployees(); }, [loadActions, loadOrgEmployees]);

  // 筛选逻辑
  const filteredCards = cards.filter(c => {
    if (searchText && !c.description.toLowerCase().includes(searchText.toLowerCase()) && !c.owner?.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (filterOwner && c.owner !== filterOwner) return false;
    if (filterPriority && c.priority !== filterPriority) return false;
    if (filterMeeting && c.meeting_id !== filterMeeting) return false;
    if (viewMode === 'my' && c.owner !== CURRENT_USER) return false;
    return true;
  });

  const getColumnCards = useCallback((col: ColumnKey) => {
    return filteredCards.filter(c => c.status === col || (col === 'pending' && c.status === 'confirmed'));
  }, [filteredCards]);

  // ── 拖拽 ──
  const handleDragStart = (id: string) => setDragId(id);
  const handleDragEnd = () => { setDragId(null); setDragOverCol(null); };

  const handleDrop = async (targetCol: ColumnKey) => {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    setDragOverCol(null);
    if (targetCol === 'blocked') {
      // 拖到阻塞列 → 弹出原因对话框
      const card = cards.find(c => c.id === id);
      if (card) { setPendingBlockDragId(id); setBlockCard(card); setBlockReason(''); }
      return;
    }
    if (targetCol === 'done') {
      // 拖到完成列 → 弹出完成对话框
      const card = cards.find(c => c.id === id);
      if (card) { setDoneCard(card); setDoneNote(''); setDoneFiles([]); }
      return;
    }
    setCards(prev => prev.map(c => c.id === id ? { ...c, status: targetCol as KanbanCard['status'] } : c));
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetCol }),
    }).catch(() => {});
  };

  // ── 开始执行 / 确认 ──
  const confirmCard = async (id: string) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'in_progress', confirmed_by: CURRENT_USER } : c));
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress', confirmed_by: CURRENT_USER }),
    }).catch(() => {});
  };

  // ── 完成对话框提交 ──
  const submitDone = async () => {
    if (!doneCard) return;
    const now = new Date().toISOString();
    setCards(prev => prev.map(c => c.id === doneCard.id ? {
      ...c, status: 'done', completed_by: CURRENT_USER, completed_at: now,
      completion_note: doneNote, evidence_files: doneFiles,
    } : c));
    setDoneCard(null);
    await fetch(`/api/actions/${doneCard.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', completed_by: CURRENT_USER, completion_note: doneNote, evidence_files: doneFiles }),
    }).catch(() => {});
  };

  // ── 阻塞对话框提交 ──
  const submitBlock = async () => {
    if (!blockCard || !blockReason.trim()) return;
    const id = blockCard.id;
    const now = new Date().toISOString();
    setCards(prev => prev.map(c => c.id === id ? {
      ...c, status: 'blocked', block_reason: blockReason, blocked_by: CURRENT_USER, blocked_at: now,
    } : c));
    setBlockCard(null);
    setPendingBlockDragId(null);
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'blocked', block_reason: blockReason, blocked_by: CURRENT_USER }),
    }).catch(() => {});
  };

  // ── 编辑对话框 ──
  const openEdit = (card: KanbanCard) => {
    setEditCard(card);
    setEditForm({ description: card.description, owner: card.owner || '', due_date: card.due_date || '', priority: card.priority });
  };
  const submitEdit = async () => {
    if (!editCard) return;
    setCards(prev => prev.map(c => c.id === editCard.id ? {
      ...c, description: editForm.description, owner: editForm.owner || null,
      due_date: editForm.due_date || null, priority: editForm.priority,
    } : c));
    setEditCard(null);
    await fetch(`/api/actions/${editCard.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: editForm.description, owner: editForm.owner || null, due_date: editForm.due_date || null, priority: editForm.priority }),
    }).catch(() => {});
  };

  // ── 文件模拟上传 ──
  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setDoneFiles(prev => [...prev, ...files.map(f => f.name)]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const allOwners = [...new Set(cards.map(c => c.owner).filter(Boolean))] as string[];
  const allMeetings = [...new Map(cards.filter(c => c.meeting_id).map(c => [c.meeting_id, c.meeting_title])).entries()];
  const doneCount = filteredCards.filter(c => c.status === 'done').length;
  const inProgressCount = filteredCards.filter(c => c.status === 'in_progress').length;
  const pendingCount = filteredCards.filter(c => c.status === 'pending' || c.status === 'confirmed').length;
  const blockedCount = filteredCards.filter(c => c.status === 'blocked').length;

  return (
    <DashboardLayout>
      {/* 统计摘要条 */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <div className="flex items-center gap-6 flex-1">
          <div className="text-center">
            <div className="text-lg font-bold text-slate-800">{filteredCards.length}</div>
            <div className="text-[10px] text-slate-400">总计</div>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div className="text-center">
            <div className="text-lg font-bold text-slate-500">{pendingCount}</div>
            <div className="text-[10px] text-slate-400">待确认</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-blue-600">{inProgressCount}</div>
            <div className="text-[10px] text-slate-400">进行中</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-600">{doneCount}</div>
            <div className="text-[10px] text-slate-400">已完成</div>
          </div>
          {blockedCount > 0 && (
            <div className="text-center">
              <div className="text-lg font-bold text-red-500">{blockedCount}</div>
              <div className="text-[10px] text-slate-400">阻塞中</div>
            </div>
          )}
          {filteredCards.length > 0 && (
            <>
              <div className="h-8 w-px bg-slate-200" />
              <div className="flex-1">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
                  {doneCount > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${(doneCount / filteredCards.length) * 100}%` }} />}
                  {inProgressCount > 0 && <div className="bg-blue-500 transition-all" style={{ width: `${(inProgressCount / filteredCards.length) * 100}%` }} />}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">完成率 {Math.round((doneCount / filteredCards.length) * 100)}%</div>
              </div>
            </>
          )}
        </div>

        {/* 当前登录用户 */}
        <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
          <User className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-medium text-slate-700 px-2 py-1 bg-slate-100 rounded-lg">{CURRENT_USER}</span>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {/* 视图切换 */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('all')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Eye className="w-3.5 h-3.5" /> 全部任务
            </button>
            <button
              onClick={() => setViewMode('my')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'my' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <User className="w-3.5 h-3.5" /> 我的任务
            </button>
          </div>

        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadActions}
            className="h-8 px-3 text-xs border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-600 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="搜索..."
              value={searchText}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
              className="pl-8 h-8 w-36 text-xs"
            />
          </div>
          <select
            value={filterMeeting}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterMeeting(e.target.value)}
            className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600 max-w-[160px]"
          >
            <option value="">全部会议</option>
            {allMeetings.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
          <select
            value={filterOwner}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterOwner(e.target.value)}
            className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600"
          >
            <option value="">全部负责人</option>
            {allOwners.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            value={filterPriority}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterPriority(e.target.value)}
            className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600"
          >
            <option value="">全部优先级</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
        </div>
      </div>

      {/* 看板列 */}
      <div className="grid grid-cols-4 gap-4 h-[calc(100vh-16rem)]">
        {COLUMNS.map(col => {
          const colCards = getColumnCards(col.key);
          const isOver = dragOverCol === col.key;
          return (
            <div
              key={col.key}
              className={`flex flex-col rounded-2xl border transition-all ${
                isOver
                  ? 'border-blue-400 bg-blue-50 shadow-md'
                  : `border-slate-200 ${col.bg}`
              }`}
              onDragOver={e => { e.preventDefault(); setDragOverCol(col.key); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={() => handleDrop(col.key)}
            >
              {/* 列头 */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/70">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className={`text-sm font-semibold ${col.color}`}>{col.label}</span>
                <span className="ml-auto text-xs text-slate-400 bg-white/80 px-1.5 py-0.5 rounded-full border border-slate-200">
                  {colCards.length}
                </span>
              </div>

              {/* 卡片区域 */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {colCards.map(card => {
                  const isLow = card.confidence_owner < 0.7 || card.confidence_date < 0.7;
                  const isDragging = dragId === card.id;
                  const isMyCard = card.owner === CURRENT_USER;
                  return (
                    <div
                      key={card.id}
                      draggable
                      onDragStart={() => handleDragStart(card.id)}
                      onDragEnd={handleDragEnd}
                      className={`group relative bg-white rounded-xl border p-3 cursor-grab active:cursor-grabbing transition-all select-none ${
                        isDragging
                          ? 'opacity-50 scale-95 shadow-lg'
                          : isMyCard
                            ? 'border-blue-300 ring-1 ring-blue-100'
                            : isLow && card.status === 'pending'
                              ? 'border-red-300 shadow-sm shadow-red-100'
                              : card.status === 'done'
                                ? 'border-emerald-200 bg-emerald-50/30'
                                : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }`}
                    >
                      {/* 低置信度警告条 */}
                      {isLow && card.status === 'pending' && (
                        <div className="flex items-center gap-1.5 mb-2 p-1.5 bg-red-50 rounded-lg border border-red-200">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                          <span className="text-xs text-red-600 font-medium">需人工确认</span>
                          <button
                            onClick={() => confirmCard(card.id)}
                            className="ml-auto flex items-center gap-0.5 text-xs text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded transition-colors font-medium"
                          >
                            <CheckCircle2 className="w-3 h-3" /> 确认
                          </button>
                        </div>
                      )}

                      {/* 已完成标记 */}
                      {card.status === 'done' && (
                        <div className="flex items-center gap-1.5 mb-2 p-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                          <span className="text-[11px] text-emerald-700">
                            {card.completed_by && <span className="font-medium">{card.completed_by}</span>}
                            {card.completed_at && <span className="text-emerald-500 ml-1">{formatTime(card.completed_at)}</span>}
                            {!card.completed_by && !card.completed_at && '已完成'}
                          </span>
                        </div>
                      )}

                      {/* 拖拽手柄 + 任务描述 */}
                      <div className="flex items-start gap-2">
                        <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <p className={`text-sm leading-snug flex-1 ${card.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                          {card.description}
                        </p>
                      </div>

                      {/* 预期结果 */}
                      {card.initial_result && card.status !== 'done' && (
                        <div className="mt-1.5 flex items-start gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1">
                          <Target className="w-3 h-3 text-blue-500 flex-shrink-0 mt-0.5" />
                          <span className="text-[11px] text-blue-700 line-clamp-2">{card.initial_result}</span>
                        </div>
                      )}

                      {/* 元信息行 */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${PRIORITY_COLOR[card.priority]}`}>
                          {PRIORITY_LABEL[card.priority]}
                        </span>

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
                          <span className="flex items-center gap-1 text-[11px] text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded-full border border-slate-200">
                            <Calendar className="w-2.5 h-2.5" />
                            {card.due_date}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] text-amber-500">
                            <Clock className="w-2.5 h-2.5" /> 无截止日期
                          </span>
                        )}
                      </div>

                      {/* 置信度徽章（低置信度时显示） */}
                      {(card.confidence_owner < 0.7 || card.confidence_date < 0.7) && card.status === 'pending' && (
                        <div className="mt-2 flex gap-1 flex-wrap">
                          {card.confidence_owner < 0.7 && (
                            <ConfidenceBadge value={card.confidence_owner} label="负责人" />
                          )}
                          {card.confidence_date < 0.7 && (
                            <ConfidenceBadge value={card.confidence_date} label="截止日期" />
                          )}
                        </div>
                      )}

                      {/* 完成说明 */}
                      {card.status === 'done' && card.completion_note && (
                        <div className="mt-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1">
                          <span className="text-slate-400">完成说明：</span>{card.completion_note}
                        </div>
                      )}
                      {/* 附件 */}
                      {card.status === 'done' && card.evidence_files && card.evidence_files.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {card.evidence_files.map((f, i) => (
                            <span key={i} className="flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded">
                              <Paperclip className="w-2.5 h-2.5" />{f}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 阻塞原因 */}
                      {card.status === 'blocked' && (
                        <div className="mt-1.5 flex items-start gap-1.5 bg-red-50 border border-red-100 rounded-lg px-2 py-1">
                          <ShieldAlert className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
                          <div className="text-[11px] text-red-700">
                            <span className="font-medium">阻塞原因：</span>{card.block_reason || '未填写'}
                            {card.blocked_by && <span className="text-red-400 ml-1">— {card.blocked_by} {formatTime(card.blocked_at)}</span>}
                          </div>
                        </div>
                      )}

                      {/* 操作按钮 */}
                      <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5">
                        {(card.status === 'pending' || card.status === 'confirmed') && (
                          <button
                            onClick={() => openEdit(card)}
                            className="flex-1 flex items-center justify-center gap-1 text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg transition-colors"
                          >
                            <Pencil className="w-3 h-3" /> 编辑
                          </button>
                        )}
                        {(card.status === 'pending' || card.status === 'confirmed') && !isLow && (
                          <button
                            onClick={() => confirmCard(card.id)}
                            className="flex-1 flex items-center justify-center gap-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-1 rounded-lg transition-colors font-medium"
                          >
                            <ArrowRight className="w-3 h-3" /> 派发
                          </button>
                        )}
                        {card.status === 'in_progress' && (
                          <>
                            <button
                              onClick={() => { setDoneCard(card); setDoneNote(''); setDoneFiles([]); }}
                              className="flex-1 flex items-center justify-center gap-1 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-1 rounded-lg transition-colors font-medium"
                            >
                              <CheckCircle2 className="w-3 h-3" /> 完成
                            </button>
                            <button
                              onClick={() => { setBlockCard(card); setBlockReason(''); }}
                              className="flex items-center justify-center gap-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-1 rounded-lg transition-colors"
                            >
                              <Ban className="w-3 h-3" /> 阻塞
                            </button>
                          </>
                        )}
                        {card.status === 'blocked' && (
                          <button
                            onClick={() => confirmCard(card.id)}
                            className="flex-1 flex items-center justify-center gap-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-1 rounded-lg transition-colors"
                          >
                            <ArrowRight className="w-3 h-3" /> 重启执行
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
                    </div>
                  );
                })}

                {/* 空状态 */}
                {colCards.length === 0 && !dragId && (
                  <div className="flex flex-col items-center justify-center h-24 text-slate-300 text-xs gap-1.5">
                    <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span>{viewMode === 'my' ? '暂无你的任务' : '拖拽卡片到此处'}</span>
                  </div>
                )}

                {/* 拖拽放置提示 */}
                {dragId && isOver && (
                  <div className="flex items-center justify-center h-16 border-2 border-dashed border-blue-400 rounded-xl bg-blue-50 text-blue-500 text-xs font-medium gap-2">
                    <ArrowRight className="w-3.5 h-3.5" />
                    放置到此列
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 编辑对话框 ── */}
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
              <div>
                <label className="text-xs text-slate-500 mb-1 block">负责人</label>
                <select
                  value={editForm.owner}
                  onChange={e => setEditForm(f => ({ ...f, owner: e.target.value }))}
                  className="h-8 text-sm border border-slate-200 rounded-lg px-2 bg-white text-slate-700"
                >
                  <option value="">未指定</option>
                  {orgEmployees.map(emp => (
                    <option key={emp.id} value={emp.name}>{emp.name}{emp.department && ` (${emp.department})`}</option>
                  ))}
                </select>
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
                <div className="flex items-center gap-2">
                  <button onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors">
                    <Paperclip className="w-3.5 h-3.5" /> 选择文件
                  </button>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileAdd} />
                  <span className="text-xs text-slate-400">支持图片、PDF、文档等</span>
                </div>
                {doneFiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {doneFiles.map((f, i) => (
                      <span key={i} className="flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">
                        <Paperclip className="w-2.5 h-2.5" />{f}
                        <button onClick={() => setDoneFiles(prev => prev.filter((_, j) => j !== i))}><X className="w-2.5 h-2.5 text-blue-400 hover:text-blue-700" /></button>
                      </span>
                    ))}
                  </div>
                )}
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

      {/* ── 阻塞对话框 ── */}
      <Dialog open={!!blockCard} onOpenChange={open => { if (!open) { setBlockCard(null); setPendingBlockDragId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Ban className="w-4 h-4 text-red-500" /> 登记阻塞原因</DialogTitle></DialogHeader>
          {blockCard && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-2">{blockCard.description}</p>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">阻塞原因 <span className="text-red-500">*必填</span></label>
                <textarea
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  rows={4}
                  placeholder="说明具体阻塞原因，方便后续复盘探讨..."
                  className="w-full text-sm border border-slate-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
                  autoFocus
                />
                {!blockReason.trim() && <p className="text-[11px] text-red-500 mt-1">请填写阻塞原因，复盘时需要用到</p>}
              </div>
            </div>
          )}
          <DialogFooter>
            <button onClick={() => { setBlockCard(null); setPendingBlockDragId(null); }} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">取消</button>
            <button onClick={submitBlock} disabled={!blockReason.trim()}
              className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 flex items-center gap-1.5">
              <Ban className="w-3.5 h-3.5" /> 确认阻塞
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </DashboardLayout>
  );
}
