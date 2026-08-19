'use client';

import React, { useEffect, useMemo, useState } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { BellRing, ChevronRight, RefreshCw } from 'lucide-react';

interface MyActionItem {
  id: string;
  description: string;
  owner?: string | null;
  due_date?: string | null;
  priority?: string;
  status: string;
  meeting_id?: string;
  meeting_title?: string;
  meeting_date?: string;
}

interface CurrentUser {
  name: string;
  loginid: string;
  dept?: string;
}

const STATUS_META: Record<string, { label: string; badge: string }> = {
  pending: { label: '待处理', badge: 'bg-amber-50 text-amber-700 border border-amber-200' },
  confirmed: { label: '待确认', badge: 'bg-sky-50 text-sky-700 border border-sky-200' },
  in_progress: { label: '进行中', badge: 'bg-blue-50 text-blue-700 border border-blue-200' },
  blocked: { label: '阻塞', badge: 'bg-red-50 text-red-700 border border-red-200' },
  done: { label: '已完成', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
};

const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  high: { label: '高', cls: 'bg-red-50 text-red-600' },
  medium: { label: '中', cls: 'bg-amber-50 text-amber-600' },
  low: { label: '低', cls: 'bg-emerald-50 text-emerald-600' },
};

function formatDueText(dateStr?: string | null) {
  if (!dateStr) return '未设置';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.floor((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff < 0) return `已逾期 ${Math.abs(diff)} 天`;
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff <= 7) return `${diff} 天后`;
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export default function PushPreviewPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [actions, setActions] = useState<MyActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [meRes, actionRes] = await Promise.all([
        fetch('/api/auth/me').then(r => r.json()),
        fetch('/api/actions/mine').then(r => r.json()),
      ]);
      if (meRes.success) setCurrentUser(meRes.data);
      if (actionRes.success) setActions(Array.isArray(actionRes.data) ? actionRes.data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const activeActions = useMemo(
    () => actions.filter(item => item.status !== 'done'),
    [actions]
  );

  const topFive = useMemo(
    () => activeActions.slice(0, 5),
    [activeActions]
  );

  const stats = useMemo(() => {
    const pending = activeActions.filter(item => ['pending', 'confirmed'].includes(item.status)).length;
    const inProgress = activeActions.filter(item => item.status === 'in_progress').length;
    const blocked = activeActions.filter(item => item.status === 'blocked').length;
    const overdue = activeActions.filter(item => item.due_date && new Date(item.due_date) < new Date(new Date().toDateString())).length;
    return { pending, inProgress, blocked, overdue };
  }, [activeActions]);

  const previewTitle = `${currentUser?.name || '当前同事'}今日待跟进 ${topFive.length} 项`;
  const previewSummary = `待处理 ${stats.pending} 项，进行中 ${stats.inProgress} 项${stats.blocked > 0 ? `，阻塞 ${stats.blocked} 项` : ''}${stats.overdue > 0 ? `，逾期 ${stats.overdue} 项` : ''}`;

  return (
    <DashboardLayout>
      <div className="pb-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-600">WeChat Preview</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">推送效果预览</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 hover:border-blue-200 hover:text-blue-600"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <button
              onClick={() => window.location.href = '/kanban?view=my'}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-sm font-bold text-white shadow-lg shadow-blue-200/70"
            >
              查看待办
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="w-full max-w-[520px] rounded-[46px] border-[12px] border-slate-900 bg-slate-950 p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
            <div className="overflow-hidden rounded-[34px] bg-[linear-gradient(180deg,#f7fbff_0%,#edf4ff_48%,#f5f8ff_100%)]">
              <div className="flex items-center justify-between px-5 py-3 text-[11px] font-bold text-slate-500">
                <span>09:30</span>
                <span>微信消息预览</span>
                <span>5G</span>
              </div>

              <div className="border-b border-white/60 bg-white/70 px-5 py-3 backdrop-blur">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-200/70">
                    <BellRing className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-900">项目助手</p>
                    <p className="text-[11px] text-slate-400">待办推送</p>
                  </div>
                </div>
              </div>

              <div className="p-4">
                <div className="rounded-[28px] bg-white/95 p-5 shadow-[0_16px_40px_rgba(59,130,246,0.12)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">
                        <BellRing className="h-3.5 w-3.5" />
                        待办卡片
                      </div>
                      <h2 className="mt-3 text-xl font-black leading-8 text-slate-900">{previewTitle}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-500">{previewSummary}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 text-right">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">账号</p>
                      <p className="mt-1 text-xs font-bold text-slate-700">{currentUser?.loginid || 'chenqiaoxia'}</p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {loading ? (
                      [0, 1, 2].map(index => (
                        <div key={index} className="rounded-2xl bg-slate-50 px-4 py-4">
                          <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                          <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                        </div>
                      ))
                    ) : topFive.length > 0 ? (
                      topFive.map((item, index) => {
                        const statusMeta = STATUS_META[item.status] || STATUS_META.pending;
                        const priorityMeta = PRIORITY_META[item.priority || 'medium'] || PRIORITY_META.medium;
                        return (
                          <div key={item.id} className="rounded-2xl bg-slate-50 px-4 py-4">
                            <div className="flex items-start gap-3">
                              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-black text-white">
                                {index + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold leading-6 text-slate-800">{item.description}</p>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusMeta.badge}`}>{statusMeta.label}</span>
                                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${priorityMeta.cls}`}>优先级 {priorityMeta.label}</span>
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm">
                                    {formatDueText(item.due_date)}
                                  </span>
                                </div>
                                <p className="mt-2 text-[11px] text-slate-400">来源：{item.meeting_title || '项目协同'}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 px-5 py-10 text-center">
                        <p className="text-sm font-bold text-slate-700">当前账号还没有可预览的待办</p>
                        <p className="mt-2 text-xs text-slate-400">先造数，或给当前账号分配 5 条待办后再查看。</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-5 flex items-center justify-between rounded-2xl bg-blue-50 px-4 py-3">
                    <p className="text-xs font-medium text-blue-700">
                      {activeActions.length > 5 ? `另有 ${activeActions.length - 5} 条待办未展开` : '当前已展示全部待办'}
                    </p>
                    <button
                      onClick={() => window.location.href = '/kanban?view=my'}
                      className="inline-flex items-center gap-1 text-xs font-black text-blue-600"
                    >
                      打开待办中心
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
