'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  CheckSquare, X, Check, AlertTriangle, Clock, ArrowLeft,
  Search, Edit2, ChevronDown, ChevronUp, GitMerge, Users,
  Calendar, Flag, Sparkles, CheckCheck
} from 'lucide-react';

interface ActionItem {
  id: string;
  description: string;
  owner?: string | null;
  due_date?: string | null;
  priority: string;
  status: string;
  project_id?: string | null;
  meeting_id: string;
  meeting_title: string;
  meeting_date: string;
  source_sentence?: string;
  source_text?: string | null;
  confidence_owner?: number;
  confidence_date?: number;
}

interface EditState {
  description: string;
  owner: string;
  due_date: string;
  priority: string;
}

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLOR: Record<string, string> = {
  high: 'text-red-600 bg-red-50',
  medium: 'text-amber-600 bg-amber-50',
  low: 'text-slate-500 bg-slate-100',
};

function confidenceLevel(item: ActionItem): 'high' | 'medium' | 'low' | 'needs_info' {
  if (!item.owner) return 'needs_info';
  const c = item.confidence_owner ?? 0.5;
  if (c >= 0.8) return 'high';
  if (c >= 0.5) return 'medium';
  return 'low';
}

function similarityKey(desc: string) {
  return desc.toLowerCase().trim().replace(/[，。、？！,. ]/g, '').substring(0, 20);
}

function findMergeSuggestions(items: ActionItem[]): Map<string, ActionItem[]> {
  const groups = new Map<string, ActionItem[]>();
  for (const item of items) {
    const key = similarityKey(item.description);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const result = new Map<string, ActionItem[]>();
  for (const [key, group] of groups) {
    if (group.length > 1) result.set(key, group);
  }
  return result;
}

function ActionCard({
  item,
  mergeGroup,
  onApprove,
  onReject,
  onUpdate,
}: {
  item: ActionItem;
  mergeGroup?: ActionItem[];
  onApprove: (id: string, edits?: Partial<EditState>) => void;
  onReject: (id: string) => void;
  onUpdate: (id: string, edits: Partial<EditState>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [edit, setEdit] = useState<EditState>({
    description: item.description,
    owner: item.owner || '',
    due_date: item.due_date || '',
    priority: item.priority || 'medium',
  });

  const level = confidenceLevel(item);
  const levelDot = level === 'high' ? 'bg-emerald-500' : level === 'medium' ? 'bg-amber-500' : level === 'needs_info' ? 'bg-blue-400' : 'bg-red-500';
  const levelLabel = level === 'high' ? '高置信' : level === 'medium' ? '中置信' : level === 'needs_info' ? '待补充' : '低置信';

  const handleSaveAndApprove = () => {
    onApprove(item.id, edit);
    setEditing(false);
  };

  return (
    <div className={`bg-white border rounded-xl transition-shadow hover:shadow-sm ${
      level === 'needs_info' ? 'border-blue-200' : level === 'low' ? 'border-red-200' : 'border-slate-200'
    }`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* 置信度 */}
          <div className="flex flex-col items-center gap-1 pt-0.5 min-w-[44px]">
            <div className={`w-2.5 h-2.5 rounded-full ${levelDot}`} />
            <span className="text-[10px] text-slate-400 text-center leading-tight">{levelLabel}</span>
            {item.confidence_owner != null && (
              <span className="text-[10px] text-slate-300">{Math.round(item.confidence_owner * 100)}%</span>
            )}
          </div>

          {/* 内容 */}
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2 mb-3">
                <textarea
                  value={edit.description}
                  onChange={e => setEdit(v => ({ ...v, description: e.target.value }))}
                  rows={2}
                  className="w-full text-sm text-slate-700 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                />
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Users className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      value={edit.owner}
                      onChange={e => setEdit(v => ({ ...v, owner: e.target.value }))}
                      placeholder="负责人"
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                  <div className="flex-1 relative">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="date"
                      value={edit.due_date}
                      onChange={e => setEdit(v => ({ ...v, due_date: e.target.value }))}
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                  <select
                    value={edit.priority}
                    onChange={e => setEdit(v => ({ ...v, priority: e.target.value }))}
                    className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                  >
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </select>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-700 mb-2">{item.description}</p>
                <div className="flex items-center gap-3 text-xs mb-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_COLOR[item.priority]}`}>
                    {PRIORITY_LABEL[item.priority] || item.priority}
                  </span>
                  <span className="flex items-center gap-1 text-slate-500">
                    <Users className="w-3 h-3" />
                    {item.owner || <span className="text-red-400">未指派</span>}
                  </span>
                  {item.due_date ? (
                    <span className="flex items-center gap-1 text-slate-500">
                      <Calendar className="w-3 h-3" /> {item.due_date}
                    </span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> 无截止日期
                    </span>
                  )}
                  <span className="text-slate-400">{item.meeting_title} · {item.meeting_date}</span>
                </div>
              </>
            )}

            {/* 来源片段 */}
            {(item.source_text || item.source_sentence) && (
              <button
                onClick={() => setShowSource(v => !v)}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-500 mb-1"
              >
                {showSource ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                原文依据
              </button>
            )}
            {showSource && (
              <p className="text-xs text-slate-400 bg-slate-50 rounded px-3 py-2 italic mb-2">
                {item.source_text || item.source_sentence}
              </p>
            )}

            {/* 合并建议 */}
            {mergeGroup && mergeGroup.length > 1 && (
              <div className="mt-1">
                <button
                  onClick={() => setShowMerge(v => !v)}
                  className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700"
                >
                  <GitMerge className="w-3 h-3" />
                  发现 {mergeGroup.length - 1} 条相似行动项，建议合并
                  {showMerge ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {showMerge && (
                  <div className="mt-1.5 space-y-1 pl-4 border-l-2 border-amber-200">
                    {mergeGroup.filter(a => a.id !== item.id).map(a => (
                      <div key={a.id} className="text-xs text-slate-500 flex items-start gap-1.5">
                        <span className="text-amber-400 mt-0.5">·</span>
                        <span>{a.description} <span className="text-slate-400">({a.meeting_title})</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-col gap-1.5 flex-shrink-0">
            {editing ? (
              <>
                <button
                  onClick={handleSaveAndApprove}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" /> 保存确认
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> 取消
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onApprove(item.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" /> 确认
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" /> 编辑
                </button>
                <button
                  onClick={() => onReject(item.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> 拒绝
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupSection({
  title,
  icon,
  items,
  mergeMap,
  onApprove,
  onReject,
  onUpdate,
  onBatchApprove,
  defaultOpen = true,
  accentColor = 'text-slate-600',
  badgeColor = 'bg-slate-100 text-slate-600',
}: {
  title: string;
  icon: React.ReactNode;
  items: ActionItem[];
  mergeMap: Map<string, ActionItem[]>;
  onApprove: (id: string, edits?: Partial<EditState>) => void;
  onReject: (id: string) => void;
  onUpdate: (id: string, edits: Partial<EditState>) => void;
  onBatchApprove?: () => void;
  defaultOpen?: boolean;
  accentColor?: string;
  badgeColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <span className={`text-sm font-semibold ${accentColor} flex items-center gap-1.5`}>
            {icon} {title}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{items.length}</span>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </button>
        {onBatchApprove && open && (
          <button
            onClick={onBatchApprove}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
          >
            <CheckCheck className="w-3.5 h-3.5" /> 全部确认
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          {items.map(item => (
            <ActionCard
              key={item.id}
              item={item}
              mergeGroup={mergeMap.get(similarityKey(item.description))}
              onApprove={onApprove}
              onReject={onReject}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReviewPage() {
  const router = useRouter();
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/actions')
      .then(r => r.json())
      .then(d => { if (d.success) setActions(d.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string, edits?: Partial<EditState>) => {
    const body: any = { status: 'pending' };
    if (edits?.description) body.description = edits.description;
    if (edits?.owner !== undefined) body.owner = edits.owner || null;
    if (edits?.due_date !== undefined) body.dueDate = edits.due_date || null;
    if (edits?.priority) body.priority = edits.priority;
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const handleReject = async (id: string) => {
    await fetch(`/api/actions/${id}`, { method: 'DELETE' });
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const handleUpdate = async (id: string, edits: Partial<EditState>) => {
    const body: any = {};
    if (edits.description) body.description = edits.description;
    if (edits.owner !== undefined) body.owner = edits.owner || null;
    if (edits.due_date !== undefined) body.dueDate = edits.due_date || null;
    if (edits.priority) body.priority = edits.priority;
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  const candidates = actions.filter(a =>
    a.status === 'candidate' &&
    (!search || a.description.toLowerCase().includes(search.toLowerCase()))
  );

  const highConf = candidates.filter(a => confidenceLevel(a) === 'high');
  const medConf = candidates.filter(a => confidenceLevel(a) === 'medium');
  const lowConf = candidates.filter(a => confidenceLevel(a) === 'low');
  const needsInfo = candidates.filter(a => confidenceLevel(a) === 'needs_info');

  const mergeMap = findMergeSuggestions(candidates);

  const batchApproveHigh = async () => {
    for (const item of highConf) {
      await fetch(`/api/actions/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      });
    }
    setActions(prev => prev.filter(a => !highConf.find(h => h.id === a.id)));
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/')} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-amber-500" /> 行动项审核台
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              AI 提取的行动项待人工审核确认，确认后进入正式行动项库
            </p>
          </div>
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: '待审核', value: candidates.length, color: 'text-amber-600 bg-amber-50' },
            { label: '高置信', value: highConf.length, color: 'text-emerald-600 bg-emerald-50' },
            { label: '待补充', value: needsInfo.length, color: 'text-blue-600 bg-blue-50' },
            { label: '合并建议', value: mergeMap.size, color: 'text-purple-600 bg-purple-50' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl p-3 text-center ${s.color.split(' ')[1]}`}>
              <div className={`text-2xl font-bold ${s.color.split(' ')[0]}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* 搜索 */}
        <div className="relative mb-5">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索行动项描述..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">加载中...</div>
        ) : candidates.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <CheckSquare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">暂无待审核行动项</p>
          </div>
        ) : (
          <>
            <GroupSection
              title="高置信度"
              icon={<Check className="w-4 h-4" />}
              items={highConf}
              mergeMap={mergeMap}
              onApprove={handleApprove}
              onReject={handleReject}
              onUpdate={handleUpdate}
              onBatchApprove={highConf.length > 0 ? batchApproveHigh : undefined}
              accentColor="text-emerald-700"
              badgeColor="bg-emerald-100 text-emerald-700"
            />
            <GroupSection
              title="待补充信息"
              icon={<AlertTriangle className="w-4 h-4" />}
              items={needsInfo}
              mergeMap={mergeMap}
              onApprove={handleApprove}
              onReject={handleReject}
              onUpdate={handleUpdate}
              accentColor="text-blue-700"
              badgeColor="bg-blue-100 text-blue-700"
            />
            <GroupSection
              title="中置信度"
              icon={<Clock className="w-4 h-4" />}
              items={medConf}
              mergeMap={mergeMap}
              onApprove={handleApprove}
              onReject={handleReject}
              onUpdate={handleUpdate}
              accentColor="text-amber-700"
              badgeColor="bg-amber-100 text-amber-700"
              defaultOpen={false}
            />
            <GroupSection
              title="低置信度"
              icon={<AlertTriangle className="w-4 h-4" />}
              items={lowConf}
              mergeMap={mergeMap}
              onApprove={handleApprove}
              onReject={handleReject}
              onUpdate={handleUpdate}
              accentColor="text-red-700"
              badgeColor="bg-red-100 text-red-700"
              defaultOpen={false}
            />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
