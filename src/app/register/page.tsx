'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  ArrowLeft, CheckCircle, Clock, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Search, Star, MessageSquare,
  Send, ClipboardList, Users, Calendar, Filter
} from 'lucide-react';
import { getActionDisplayLabel, getActionDisplayStatus } from '@/lib/action-status';

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
  completion_note?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  oa_result?: string | null;
  oa_score?: number | null;
  block_reason?: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:   { label: '未处理', color: 'bg-slate-100 text-slate-600', icon: <Clock className="w-3.5 h-3.5" /> },
  done:      { label: '已处理', color: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  cancelled: { label: '已取消', color: 'bg-slate-200 text-slate-500', icon: <XCircle className="w-3.5 h-3.5" /> },
};

const PRIORITY_COLOR: Record<string, string> = {
  high: 'text-red-500', medium: 'text-amber-500', low: 'text-slate-400',
};

function isOverdue(item: ActionItem) {
  if (!item.due_date || getActionDisplayStatus(item.status) !== 'pending') return false;
  return new Date(item.due_date) < new Date();
}

// ── 负责人回传弹窗 ──
function ReportModal({
  item,
  onClose,
  onSubmit,
}: {
  item: ActionItem;
  onClose: () => void;
  onSubmit: (id: string, status: string, note: string, blockReason?: string) => void;
}) {
  const [status, setStatus] = useState(item.status === 'done' ? 'done' : 'in_progress');
  const [note, setNote] = useState(item.completion_note || '');
  const [blockReason, setBlockReason] = useState(item.block_reason || '');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800 mb-1">回传执行结果</h3>
        <p className="text-xs text-slate-400 mb-4 truncate">{item.description}</p>

        <div className="mb-4">
          <label className="text-xs text-slate-500 mb-1.5 block">执行状态</label>
          <div className="flex gap-2">
            {(['in_progress', 'done', 'blocked'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  status === s
                    ? s === 'done' ? 'bg-emerald-600 text-white border-emerald-600'
                    : s === 'blocked' ? 'bg-red-500 text-white border-red-500'
                    : 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {STATUS_MAP[s]?.label || s}
              </button>
            ))}
          </div>
        </div>

        {status === 'blocked' ? (
          <div className="mb-4">
            <label className="text-xs text-slate-500 mb-1.5 block">阻塞原因 <span className="text-red-400">*</span></label>
            <textarea
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              rows={3}
              placeholder="描述阻塞原因及需要的支持..."
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
            />
          </div>
        ) : (
          <div className="mb-4">
            <label className="text-xs text-slate-500 mb-1.5 block">
              {status === 'done' ? '完成说明' : '进展备注'}
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              placeholder={status === 'done' ? '描述完成情况、交付物...' : '当前进展情况...'}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
            />
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-lg">取消</button>
          <button
            onClick={() => onSubmit(item.id, status, note, blockReason)}
            disabled={status === 'blocked' && !blockReason.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> 提交
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 管理者稽核弹窗 ──
function AuditModal({
  item,
  onClose,
  onSubmit,
}: {
  item: ActionItem;
  onClose: () => void;
  onSubmit: (id: string, result: string, score: number | null) => void;
}) {
  const [result, setResult] = useState(item.oa_result || '');
  const [score, setScore] = useState<number | null>(item.oa_score ?? null);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800 mb-1">稽核评分</h3>
        <p className="text-xs text-slate-400 mb-1 truncate">{item.description}</p>
        {item.completion_note && (
          <div className="bg-slate-50 rounded-lg px-3 py-2 mb-4">
            <p className="text-xs text-slate-500 mb-0.5">负责人回传</p>
            <p className="text-sm text-slate-700">{item.completion_note}</p>
          </div>
        )}

        <div className="mb-4">
          <label className="text-xs text-slate-500 mb-2 block">稽核结论</label>
          <textarea
            value={result}
            onChange={e => setResult(e.target.value)}
            rows={3}
            placeholder="评价完成质量、是否达标..."
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
          />
        </div>

        <div className="mb-5">
          <label className="text-xs text-slate-500 mb-2 block">评分（1-5）</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setScore(score === n ? null : n)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  score === n
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {'★'.repeat(n)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 hover:bg-slate-50 rounded-lg">取消</button>
          <button
            onClick={() => onSubmit(item.id, result, score)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Star className="w-3.5 h-3.5" /> 提交稽核
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 行动项行 ──
function ActionRow({
  item,
  mode,
  onReport,
  onAudit,
}: {
  item: ActionItem;
  mode: 'executor' | 'manager';
  onReport: (item: ActionItem) => void;
  onAudit: (item: ActionItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const overdue = isOverdue(item);
  const displayStatus = getActionDisplayStatus(item.status);
  const st = STATUS_MAP[displayStatus] || STATUS_MAP.pending;

  return (
    <div className={`bg-white border rounded-xl overflow-hidden transition-shadow hover:shadow-sm ${
      overdue ? 'border-red-200' : 'border-slate-200'
    }`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* 状态图标 */}
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${st.color}`}>
          {st.icon} {st.label}
        </span>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm text-slate-700 truncate">{item.description}</p>
            {overdue && <span className="text-[10px] text-red-500 flex-shrink-0 bg-red-50 px-1.5 rounded">已超期</span>}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Users className="w-3 h-3" />{item.owner || '未指派'}</span>
            {item.due_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{item.due_date}</span>}
            <span className={PRIORITY_COLOR[item.priority]}>{item.priority === 'high' ? '高' : item.priority === 'medium' ? '中' : '低'}优先</span>
            <span className="text-slate-300">·</span>
            <span className="truncate">{item.meeting_title}</span>
          </div>
        </div>

        {/* 操作 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {mode === 'executor' && displayStatus === 'pending' && (
            <button
              onClick={() => onReport(item)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
            >
              <Send className="w-3 h-3" /> 回传
            </button>
          )}
          {mode === 'manager' && displayStatus === 'done' && !item.oa_result && (
            <button
              onClick={() => onAudit(item)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
            >
              <Star className="w-3 h-3" /> 稽核
            </button>
          )}
          {item.oa_score != null && (
            <span className="text-xs text-amber-500 font-medium">{'★'.repeat(Math.max(0, item.oa_score))}</span>
          )}
          {(item.completion_note || item.oa_result || item.block_reason) && (
            <button onClick={() => setExpanded(v => !v)} className="p-1 text-slate-400 hover:text-slate-600">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50 space-y-2">
          {item.block_reason && (
            <div className="flex gap-2">
              <span className="text-xs text-red-500 font-medium flex-shrink-0">阻塞：</span>
              <span className="text-xs text-slate-600">{item.block_reason}</span>
            </div>
          )}
          {item.completion_note && (
            <div className="flex gap-2">
              <span className="text-xs text-slate-500 font-medium flex-shrink-0">回传：</span>
              <span className="text-xs text-slate-600">{item.completion_note}</span>
            </div>
          )}
          {item.completed_by && item.completed_at && (
            <p className="text-[11px] text-slate-400">{item.completed_by} · {item.completed_at.slice(0, 10)}</p>
          )}
          {item.oa_result && (
            <div className="flex gap-2">
              <span className="text-xs text-amber-600 font-medium flex-shrink-0">稽核：</span>
              <span className="text-xs text-slate-600">{item.oa_result}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 主页面 ──
export default function RegisterPage() {
  const router = useRouter();
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'executor' | 'manager'>('executor');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reportTarget, setReportTarget] = useState<ActionItem | null>(null);
  const [auditTarget, setAuditTarget] = useState<ActionItem | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/actions')
      .then(r => r.json())
      .then(d => { if (d.success) setActions(d.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReport = async (id: string, status: string, note: string, blockReason?: string) => {
    const body: any = { status };
    if (status === 'done') body.completion_note = note;
    else if (status === 'in_progress') body.completion_note = note;
    else if (status === 'blocked') body.block_reason = blockReason;

    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setReportTarget(null);
    load();
  };

  const handleAudit = async (id: string, result: string, score: number | null) => {
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oa_result: result, oa_score: score }),
    });
    setAuditTarget(null);
    load();
  };

  // 台账只显示已进入行动项库的（非 candidate）
  const visible = actions.filter(a => {
    if (a.status === 'candidate') return false;
    if (search && !a.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && getActionDisplayStatus(a.status) !== statusFilter) return false;
    return true;
  });

  const pending = visible.filter(a => getActionDisplayStatus(a.status) === 'pending');
  const done = visible.filter(a => getActionDisplayStatus(a.status) === 'done');
  const cancelled = visible.filter(a => getActionDisplayStatus(a.status) === 'cancelled');
  const overdueCount = visible.filter(isOverdue).length;
  const needAudit = done.filter(a => !a.oa_result).length;

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
              <ClipboardList className="w-6 h-6 text-blue-500" /> 行动项台账
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">负责人回传执行结果，管理者稽核评分</p>
          </div>
          {/* 视角切换 */}
          <div className="flex bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setMode('executor')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                mode === 'executor' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              负责人视角
            </button>
            <button
              onClick={() => setMode('manager')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                mode === 'manager' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              管理者视角
            </button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: '未处理', value: pending.length, color: 'text-slate-600 bg-slate-50' },
            { label: '已处理', value: done.length, color: 'text-emerald-600 bg-emerald-50' },
            { label: '已取消', value: cancelled.length, color: 'text-slate-500 bg-slate-100' },
            { label: mode === 'manager' ? '待稽核' : '已超期', value: mode === 'manager' ? needAudit : overdueCount, color: 'text-amber-600 bg-amber-50' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl p-3 text-center ${s.color.split(' ')[1]}`}>
              <div className={`text-2xl font-bold ${s.color.split(' ')[0]}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* 筛选栏 */}
        <div className="flex gap-3 mb-5">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索行动项..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="flex bg-slate-100 rounded-lg p-1 gap-0.5">
            {['all', 'pending', 'done', 'cancelled'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  statusFilter === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                }`}
              >
                {s === 'all' ? '全部' : getActionDisplayLabel(s)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400">加载中...</div>
        ) : visible.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">暂无行动项</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(item => (
              <ActionRow
                key={item.id}
                item={item}
                mode={mode}
                onReport={setReportTarget}
                onAudit={setAuditTarget}
              />
            ))}
          </div>
        )}
      </div>

      {reportTarget && (
        <ReportModal
          item={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmit={handleReport}
        />
      )}
      {auditTarget && (
        <AuditModal
          item={auditTarget}
          onClose={() => setAuditTarget(null)}
          onSubmit={handleAudit}
        />
      )}
    </DashboardLayout>
  );
}
