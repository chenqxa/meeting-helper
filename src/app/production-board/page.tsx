'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  Carousel, CarouselContent, CarouselItem, type CarouselApi,
} from '@/components/ui/carousel';
import {
  ChevronLeft, ChevronRight, Maximize2, Minimize2, Play, Pause,
  RefreshCw, Building2, User, CalendarClock, Clock, Flag, AlertTriangle,
  CheckCircle2, ClipboardList, LayoutTemplate, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getActionDisplayStatus } from '@/lib/action-status';
import SlideFrame from '@/components/slide-frame';
import BoardBigTextToggle from '@/components/board-big-text-toggle';
import ActionDoneDetailDialog from '@/components/board/action-done-detail-dialog';
import ContinuousDetailDialog from '@/components/board/continuous-detail-dialog';

// ── 数据结构（与 /api/actions 返回一致，仅取演示所需字段）──
interface BoardItem {
  id: string;
  description: string;
  owner: string | null;
  dept: string | null;
  proposer?: string | null;
  due_date: string | null;
  due_date_type?: string | null;
  priority: string;
  status: string;
  meeting_title?: string;
  meeting_date?: string;
  meeting_type?: string;
  oa_score?: number | null;
  oa_result?: string | null;
  // 完成详情（后端 /api/actions 已返回；详情弹窗展示用）
  completed_at?: string | null;
  completed_by?: string | null;
  completion_note?: string | null;
  oa_attachments?: (string | null)[] | null;
  evidence_files?: (string | null)[] | null;
}

// ── 工具函数 ──
function formatDate(d: string | null | undefined) {
  if (!d) return '';
  return d.slice(0, 10).replace(/-/g, '/');
}

// 产销会周期：上月16号 ~ 本月15号
// 传 offset：0=当前周期（默认），1=上一周期，-1=下一周期
// 例：当前月=8月 → 周期0 = 7/16~8/15；周期1 = 6/16~7/15
function prodCycleRange(offset = 0, d = new Date()) {
  const base = new Date(d);
  const y = base.getFullYear(), m = base.getMonth();
  const startMonth = m - 1 - offset; // 周期起点月 = 当前月-1，再减 offset
  const start = new Date(y, startMonth, 16);
  start.setHours(0, 0, 0, 0);
  const end = new Date(y, startMonth + 1, 15, 23, 59, 59, 999);
  return { start, end };
}

function isOverdue(due: string | null, dueType: string | null | undefined, status: string) {
  if (!due || dueType !== 'date') return false;
  if (getActionDisplayStatus(status) !== 'pending') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(due) < today;
}

// 与台账 effectiveScore 一致：有打分用打分；未打分但超期且没回传 → 自动算 -1（X）
function effectiveScore(item: BoardItem): number | null {
  const score = (item as any).oa_score;
  if (score !== null && score !== undefined) return score;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (item.due_date && (item.due_date_type || 'date') === 'date' && new Date(item.due_date) < today && !item.oa_result
    && item.status !== 'done' && item.status !== 'verified') {
    return -1;
  }
  return null;
}

// 打 V（effectiveScore=1）或原始状态 done 视为完成；
// 显式打 0（待定）优先级最高：即使 status=done 也不算完成
function isDone(item: BoardItem): boolean {
  const score = effectiveScore(item);
  if (score === 0) return false;
  return score === 1 || String(item.status || '').trim() === 'done';
}

// 打 0（待定）的项：产销会看板不归属任何板块（不算完成、不算待办、不计入完成率）
function isExcluded(item: BoardItem): boolean {
  return effectiveScore(item) === 0;
}

const PRIORITY_META: Record<string, { label: string; dot: string; chip: string }> = {
  high: { label: '紧急', dot: 'bg-red-500', chip: 'bg-red-50 text-red-600 border-red-100' },
  medium: { label: '正常', dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-600 border-amber-100' },
  low: { label: '宽松', dot: 'bg-emerald-400', chip: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
};
const priorityMeta = (p: string) => PRIORITY_META[p] ?? PRIORITY_META.medium;

// ─────────────────────────────────────────────────────────────
// ── 第 1 页：统计汇总 ──
function StatsSlide({ items, contItems = [], progressMap = {}, cycleOffset = 0 }: {
  items: BoardItem[];
  contItems?: BoardItem[];
  progressMap?: Record<string, {   progress: string | null; cycleDate: string; syncedAt: string; dataMonth?: string | null; detail?: any[] | null }>;
  cycleOffset?: number;
}) {
  const stats = useMemo(() => {
    // 按「打X/V/0」判定：V(1)/status=done 视为已处理；打0(待定)不归属任何板块，仅未稽核(null)视为待办
    // 打X(oa_score=-1) 的项不算待办，单独归为「未完成项」
    const done = items.filter(i => isDone(i));
    const xItems = items.filter(i => effectiveScore(i) === -1);           // 未完成项（打X，与台账操作栏一致）
    const pending = items.filter(i => !isDone(i) && effectiveScore(i) !== -1 && !isExcluded(i)); // 待办（排除打X/打0）
    const { start, end } = prodCycleRange(cycleOffset);
    const dueThisMonth = pending.filter(i =>
      i.due_date && (i.due_date_type || 'date') === 'date' &&
      new Date(i.due_date) >= start && new Date(i.due_date) <= end
    ).length;
    const high = pending.filter(i => i.priority === 'high').length;

    // 持续项统计：不用「已完成/未完成」口径（该口径仅行动项有节点才有），持续项按本周期填报情况统计
    // 本周期已填报数（产销会按 16~15 周期，按 progress 表 data_month 判断）
    const contFilledThisMonth = contItems.filter(i => {
      const pr = progressMap[i.id];
      if (!pr?.dataMonth) return false;
      const { start: cs, end: ce } = prodCycleRange(cycleOffset);
      const cd = new Date(pr.dataMonth + '-01T00:00:00');
      // 判断 dataMonth 是否落在本周期月份范围内（周期 = 上月16~本月15，对应月份 = 上月）
      const cycMonth = (cs.getFullYear() * 100) + (cs.getMonth() + 1);
      return (cd.getFullYear() * 100) + (cd.getMonth() + 1) === cycMonth;
    }).length;
    const contUnfilledThisMonth = contItems.length - contFilledThisMonth;

    // 按部门分布（未处理）
    const byDept: Record<string, number> = {};
    for (const i of pending) {
      const k = (i.dept || '未分配').trim() || '未分配';
      byDept[k] = (byDept[k] || 0) + 1;
    }
    const deptRows = Object.entries(byDept)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const deptMax = deptRows.length ? deptRows[0][1] : 1;

    // 优先级分布（未处理）
    const pHigh = pending.filter(i => i.priority === 'high').length;
    const pMed = pending.filter(i => i.priority === 'medium').length;
    const pLow = pending.filter(i => i.priority === 'low').length;
    const pTotal = pHigh + pMed + pLow || 1;

    return { pending: pending.length, done: done.length, dueThisMonth, xItems: xItems.length, high, deptRows, deptMax, pHigh, pMed, pLow, pTotal,
             contTotal: contItems.length, contFilledThisMonth, contUnfilledThisMonth };
  }, [items, contItems, progressMap, cycleOffset]);

  const cards = [
    { label: '待办（未处理）', value: stats.pending, icon: ClipboardList, color: 'text-blue-600', bg: 'bg-blue-50', ring: 'ring-blue-100' },
    { label: '已处理', value: stats.done, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-100' },
    { label: '本月到期', value: stats.dueThisMonth, icon: CalendarClock, color: 'text-violet-600', bg: 'bg-violet-50', ring: 'ring-violet-100' },
    { label: '未完成项', value: stats.xItems, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', ring: 'ring-red-100' },
  ];
  const contCards = [
    { label: '持续项总数', value: stats.contTotal, icon: RefreshCw, color: 'text-slate-600', bg: 'bg-slate-50', ring: 'ring-slate-100' },
    { label: '本周期已填报', value: stats.contFilledThisMonth, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-100' },
    { label: '本周期未填报', value: stats.contUnfilledThisMonth, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', ring: 'ring-red-100' },
  ];

  return (
    <SlideShell
      eyebrow="总览"
      title="产销会待办总览"
      subtitle={`数据范围：行动项台账全量 · 共 ${items.length} 条记录`}
      accent="from-blue-500 to-indigo-500"
    >
      <div className="flex-1 grid grid-cols-12 gap-5 min-h-0">
        {/* 四张统计卡 */}
        <div className="col-span-12 grid grid-cols-4 gap-4">
          {cards.map(c => (
            <div key={c.label} className={cn('relative rounded-2xl p-5 ring-1 overflow-hidden', c.bg, c.ring)}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-base font-semibold text-slate-500">{c.label}</div>
                  <div className={cn('text-6xl font-black mt-1 tabular-nums', c.color)}>{c.value}</div>
                </div>
                <div className={cn('w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center', c.color)}>
                  <c.icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 持续项统计行 */}
        {stats.contTotal > 0 && (
          <div className="col-span-12">
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-slate-400" />
              <h3 className="text-base font-bold text-slate-700">持续项（{stats.contTotal} 项）</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {contCards.map(c => (
                <div key={c.label} className={cn('relative rounded-2xl p-4 ring-1 overflow-hidden', c.bg, c.ring)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-base font-semibold text-slate-500">{c.label}</div>
                      <div className={cn('text-5xl font-black mt-1 tabular-nums', c.color)}>{c.value}</div>
                    </div>
                    <div className={cn('w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center', c.color)}>
                      <c.icon className="w-4.5 h-4.5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 部门分布 */}
        <div className="col-span-7 rounded-2xl border border-slate-100 p-5 bg-white flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-4 h-4 text-slate-400" />
            <h3 className="text-base font-bold text-slate-700">部门待办分布（未处理）</h3>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {stats.deptRows.length === 0 && (
              <div className="h-full flex items-center justify-center text-base text-slate-300">暂无数据</div>
            )}
            {stats.deptRows.map(([dept, n]) => (
              <div key={dept} className="flex items-center gap-3">
                <div className="w-28 text-base font-medium text-slate-600 truncate text-right">{dept}</div>
                <div className="flex-1 h-6 rounded-lg bg-slate-50 overflow-hidden relative">
                  <div
                    className="h-full rounded-lg bg-gradient-to-r from-blue-400 to-indigo-400 transition-all duration-500"
                    style={{ width: `${Math.max(8, (n / stats.deptMax) * 100)}%` }}
                  />
                </div>
                <div className="w-8 text-base font-bold text-slate-700 tabular-nums">{n}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 优先级分布 */}
        <div className="col-span-5 rounded-2xl border border-slate-100 p-5 bg-white flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Flag className="w-4 h-4 text-slate-400" />
            <h3 className="text-base font-bold text-slate-700">优先级分布（未处理）</h3>
          </div>
          <div className="flex-1 flex items-center justify-around">
            {[
              { label: '紧急', n: stats.pHigh, total: stats.pTotal, color: 'text-red-600', ring: 'ring-red-100', dot: 'bg-red-500' },
              { label: '正常', n: stats.pMed, total: stats.pTotal, color: 'text-amber-600', ring: 'ring-amber-100', dot: 'bg-amber-400' },
              { label: '宽松', n: stats.pLow, total: stats.pTotal, color: 'text-emerald-600', ring: 'ring-emerald-100', dot: 'bg-emerald-400' },
            ].map(p => (
              <div key={p.label} className="flex flex-col items-center gap-2">
                <div className={cn('relative w-24 h-24 rounded-full ring-1 flex items-center justify-center bg-white', p.ring)}>
                  <div className="text-center">
                    <div className={cn('text-4xl font-black tabular-nums', p.color)}>{p.n}</div>
                    <div className="text-base text-slate-400">{Math.round((p.n / p.total) * 100)}%</div>
                  </div>
                  <span className={cn('absolute -top-1 right-3 w-3 h-3 rounded-full ring-2 ring-white', p.dot)} />
                </div>
                <span className="text-base font-semibold text-slate-600">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

// ─────────────────────────────────────────────────────────────
// 示例页：待办明细（四字段卡片，作为后续异构页模板）?// ─────────────────────────────────────────────────────────────
function ActionBoardSlide({ items, title, eyebrow }: { items: BoardItem[]; title: string; eyebrow: string }) {
  return (
    <SlideShell
      eyebrow={eyebrow}
      title={title}
      subtitle={`共 ${items.length} 项待办 · 含提议内容 / 节点 / 部门 / 责任人`}
      accent="from-emerald-500 to-teal-500"
    >
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2">
            <ClipboardList className="w-10 h-10" />
            <span className="text-base">暂无待办</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map(it => {
              const pm = priorityMeta(it.priority);
              const overdue = isOverdue(it.due_date, it.due_date_type, it.status);
              return (
                <div key={it.id} className="group rounded-xl border border-slate-100 p-4 bg-white hover:shadow-md hover:border-slate-200 transition-all">
                  <div className="flex items-start gap-2 mb-3">
                    <span className={cn('mt-1.5 w-2 h-2 rounded-full flex-shrink-0', pm.dot)} />
                    <p className="text-base font-medium text-slate-800 leading-snug line-clamp-2">{it.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-base">
                    <Chip icon={<Building2 className="w-3 h-3" />} className="bg-slate-50 text-slate-600 border-slate-100">
                      {it.dept || '未分配'}
                    </Chip>
                    <Chip
                      icon={<CalendarClock className="w-3 h-3" />}
                      className={cn('border', overdue ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100')}
                    >
                      {(it.due_date_type || 'date') === 'date' ? formatDate(it.due_date) || '未定' : '持续跟进'}
                    </Chip>
                    <Chip icon={<User className="w-3 h-3" />} className="bg-violet-50 text-violet-600 border-violet-100">
                      {it.owner || '待分配'}
                    </Chip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SlideShell>
  );
}

// ─────────────────────────────────────────────────────────────
// ── 第 1 页：未完成项通报（上月到期未完成）──
interface WeekStats {
  year: number;
  monthNum: number;    // 数据月（如 7）
  target: number;      // 目标数（月会行动项，去取消）
  done: number;         // 完成数
  rate: number;        // 完成率 %
  diff: number;        // 较上月变化百分点（正=提升）
  mock: boolean;        // 是否模拟数据
}

// 未完成通报分块行（打X项 / 未处理项）
function SectionRow({ title, count, tone }: { title: string; count: number; tone: 'red' | 'amber' | 'emerald' }) {
  const c = {
    red:     { bar: 'bg-red-500',     text: 'text-red-700',     pill: 'bg-red-100 text-red-600',       band: 'bg-red-50/80' },
    amber:   { bar: 'bg-amber-400',   text: 'text-amber-700',   pill: 'bg-amber-100 text-amber-600',     band: 'bg-amber-50/80' },
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-700', pill: 'bg-emerald-100 text-emerald-600', band: 'bg-emerald-50/80' },
  }[tone];
  return (
    <tr>
      <td colSpan={6} className={`${c.band} px-3 py-1.5 border-b border-slate-100`}>
        <span className="inline-flex items-center gap-2">
          <span className={`w-1 h-3.5 rounded-full ${c.bar}`} />
          <span className={`text-base font-semibold tracking-wide ${c.text}`}>{title}</span>
          <span className={`px-1.5 py-px rounded-full text-base font-medium ${c.pill}`}>{count}</span>
        </span>
      </td>
    </tr>
  );
}

function Row({ it, no, newDue, onClick }: { it: BoardItem; no: string; newDue?: string | null; onClick?: (it: BoardItem) => void }) {
  return (
    <tr
      onClick={onClick ? () => onClick(it) : undefined}
      className={cn(
        '[&>td]:border-b [&>td]:border-slate-100 transition-colors',
        onClick ? 'cursor-pointer hover:bg-emerald-50/40' : 'hover:bg-slate-50/60'
      )}
    >
      <td className="text-center py-2.5 px-2"><span className="text-base font-semibold text-slate-300 tabular-nums">{no}</span></td>
      <td className="text-left py-2.5 px-2 text-[17px] font-medium text-slate-800 leading-snug">{it.description}</td>
      <td className="text-center py-2.5 px-2 text-base text-slate-500">{it.dept || '—'}</td>
      <td className="text-center py-2.5 px-2 text-base text-slate-700">{it.owner || '待分配'}</td>
      <td className="text-center py-2.5 px-2 text-base text-slate-600">{formatDateCN(it.due_date)}</td>
      <td className="text-center py-2.5 px-2 text-base">
        {onClick ? (
          <span className="inline-flex items-center gap-0.5 font-medium text-emerald-600 whitespace-nowrap">
            查看详情<ChevronRight className="w-3.5 h-3.5" />
          </span>
        ) : newDue ? (
          <span className="font-semibold text-blue-600">{formatDateCN(newDue)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
function OverdueNoticeSlide({ items, doneItems, allItems, monthLabel, stats, onDoneClick }: { items: BoardItem[]; doneItems: BoardItem[]; allItems: BoardItem[]; monthLabel: string; stats: WeekStats; onDoneClick?: (it: BoardItem) => void }) {
  const rows = items;
  const doneRows = doneItems || [];
  const up = stats.diff >= 0;
  // 分两块：打X项（稽核 X）/ 未处理项（无标记）
  const blockedRows = rows.filter(it => effectiveScore(it) === -1);
  const pendingRows = rows.filter(it => effectiveScore(it) !== -1);
  // 新节点：打X项若已重新派发，取新任务（reassigned_to）的节点
  const dueMap = new Map<string, string | null>();
  (allItems || []).forEach(x => dueMap.set(x.id, x.due_date));
  const newDueOf = (it: BoardItem) => (it as any).reassigned_to ? dueMap.get((it as any).reassigned_to) : null;
  return (
    <div className="relative w-full h-full bg-white rounded-xl shadow-2xl ring-1 ring-slate-200/60 overflow-hidden flex flex-col">
      {/* ── 标题栏：深蓝渐变 + 红色警示竖条 + 右侧角标 ── */}
      <div className="relative bg-gradient-to-r from-[#16233d] to-[#243a5e] px-7 py-4 flex items-center gap-4 flex-shrink-0">
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-500" />
        <div className="w-10 h-10 rounded-xl bg-red-500/15 ring-1 ring-red-400/30 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[32px] font-black text-white tracking-tight leading-tight">未完成项通报</h2>
          <p className="text-base text-blue-200/70 mt-1 tracking-widest">PRODUCTION-SALES OVERDUE REVIEW · {monthLabel} 未完成项通报</p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-base text-blue-200/60 tracking-wide">上月通报</div>
          <div className="text-3xl font-black text-white tabular-nums leading-tight">{rows.length}<span className="text-base font-normal text-white/60 ml-1">项</span></div>
        </div>
      </div>

      {/* ── 表格区：打X项 /?/ 未处理项 / 已完成项 三个板块 ── */}
      <div className="flex-1 min-h-0 px-7 pb-2 overflow-y-auto custom-scrollbar">
        {(rows.length === 0 && doneRows.length === 0) ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <span className="text-base">{monthLabel} 无未完成项</span>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-base text-slate-500">
                <th className="sticky top-0 z-10 text-center font-semibold py-2 px-2 w-10 bg-slate-50 border-b border-slate-200">No.</th>
                <th className="sticky top-0 z-10 text-left font-semibold py-2 px-2 bg-slate-50 border-b border-slate-200">项目内容</th>
                <th className="sticky top-0 z-10 text-center font-semibold py-2 px-2 w-24 bg-slate-50 border-b border-slate-200">责任部门</th>
                <th className="sticky top-0 z-10 text-center font-semibold py-2 px-2 w-20 bg-slate-50 border-b border-slate-200">责任人</th>
                <th className="sticky top-0 z-10 text-center font-semibold py-2 px-2 w-24 bg-slate-50 border-b border-slate-200">原节点</th>
                <th className="sticky top-0 z-10 text-center font-semibold py-2 px-2 w-24 bg-slate-50 border-b border-slate-200">新节点</th>
              </tr>
            </thead>
            <tbody>
              <SectionRow title="✕ 打X项" count={blockedRows.length} tone="red" />
              {blockedRows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-2 text-slate-300 text-base">无</td></tr>
              ) : blockedRows.map((it, i) => (
                <Row key={it.id} it={it} no={String(i + 1).padStart(2, '0')} newDue={newDueOf(it)} />
              ))}
              <SectionRow title="未处理项" count={pendingRows.length} tone="amber" />
              {pendingRows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-2 text-slate-300 text-base">无</td></tr>
              ) : pendingRows.map((it, i) => (
                <Row key={it.id} it={it} no={String(i + 1).padStart(2, '0')} />
              ))}
              <SectionRow title="✓ 已完成项" count={doneRows.length} tone="emerald" />
              {doneRows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-2 text-slate-300 text-base">无</td></tr>
              ) : doneRows.map((it, i) => (
                <Row key={it.id} it={it} no={String(i + 1).padStart(2, '0')} onClick={onDoneClick} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 底部统计栏：4 个指标块 + 完成率进度 ── */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100/60 px-7 py-3">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-base font-bold text-slate-500 tracking-wide">{stats.year}年{stats.monthNum}月</span>
          </div>
          <div className="w-px h-7 bg-slate-300/70 flex-shrink-0" />
          <Metric label="目标" value={`${stats.target}`} unit="项" tone="slate" />
          <Metric label="完成" value={`${stats.done}`} unit="项" tone="emerald" />
          <Metric label="完成率" value={`${stats.rate.toFixed(1)}`} unit="%" tone="blue" />
          <div className="w-px h-7 bg-slate-300/70 flex-shrink-0" />
          <Metric
            label="较上月"
            value={`${up ? '↑' : '↓'} ${Math.abs(stats.diff).toFixed(1)}`}
            unit="%"
            tone={up ? 'emerald' : 'red'}
          />
          <div className="flex-1" />
          {stats.mock && (
            <span className="text-base text-amber-500 bg-amber-50 px-2 py-0.5 rounded">示例数据</span>
          )}
        </div>
      </div>
    </div>
  );
}

// 底部指标块
function Metric({ label, value, unit, tone }: { label: string; value: string; unit: string; tone: 'slate' | 'emerald' | 'blue' | 'red' }) {
  const toneMap = {
    slate: 'text-slate-800',
    emerald: 'text-emerald-600',
    blue: 'text-blue-600',
    red: 'text-red-500',
  } as const;
  return (
    <div className="flex items-baseline gap-1.5 flex-shrink-0">
      <span className="text-base text-slate-400">{label}</span>
      <span className={cn('text-2xl font-black tabular-nums leading-none', toneMap[tone])}>{value}</span>
      <span className="text-base text-slate-400">{unit}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ── 第 2 页：持续项跟进（产销会来源的持续执行事项）──
// ─────────────────────────────────────────────────────────────
function ContinuousSlide({ items, mode, progressMap, onShowDetail }: {
  items: BoardItem[];
  mode: 'done' | 'pending';
  progressMap?: Record<string, { progress: string | null; cycleDate: string; syncedAt: string; detail?: any[] | null }>;
  onShowDetail?: (pr: { progress: string; cycleDate?: string; detail: any[]; sourceKey?: string | null }) => void; // 自动取数明细点击
}) {
  const rows = items;
  const isDone = mode === 'done';
  const accent = isDone ? 'from-[#1b4d3d] to-[#2d6b55]' : 'from-[#5a3d1b] to-[#7a5a2d]';
  const barColor = isDone ? 'bg-emerald-400' : 'bg-amber-400';
  const iconColor = isDone ? 'text-emerald-400' : 'text-amber-400';
  const badgeBg = isDone ? 'bg-emerald-500/15 ring-emerald-400/30' : 'bg-amber-500/15 ring-amber-400/30';
  const icon = isDone ? RefreshCw : Clock;
  const subtitle = isDone ? 'CONTINUOUS · 持续项稽核' : 'CONTINUOUS · 持续项按周期填报汇报';
  const badgeText = isDone ? '稽核' : '汇报中';
  const title = isDone ? '持续项稽核' : '持续项汇报';
  const IconComp = icon;
  const dotColor = isDone ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <div className="relative w-full h-full bg-white rounded-xl shadow-2xl ring-1 ring-slate-200/60 overflow-hidden flex flex-col">
      {/* 标题栏 */}
      <div className={`relative bg-gradient-to-r ${accent} px-7 py-4 flex items-center gap-4 flex-shrink-0`}>
        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${barColor}`} />
        <div className={`w-9 h-9 rounded-lg ${badgeBg} flex items-center justify-center flex-shrink-0`}>
          <IconComp className={`w-5 h-5 ${iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[30px] font-black text-white tracking-tight leading-tight">{title}</h2>
          <p className="text-base text-white/70 mt-0.5 tracking-wide">{subtitle}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-base text-white/60">{badgeText}</div>
          <div className="text-2xl font-black text-white tabular-nums leading-tight">{rows.length}<span className="text-base font-normal text-white/60 ml-1">项</span></div>
        </div>
      </div>

      {/* 表格区 */}
      <div className="flex-1 min-h-0 px-7 pb-4 overflow-y-auto custom-scrollbar">
        {rows.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2">
            <CheckCircle2 className="w-10 h-10 text-slate-300" />
            <span className="text-base">暂无{isDone ? '待稽核' : '可汇报'}持续项</span>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-lg uppercase tracking-wider text-slate-500">
                <th className="sticky top-0 z-10 text-center font-bold py-2.5 px-2 w-10 bg-white border-b-2 border-slate-200">No.</th>
                <th className="sticky top-0 z-10 text-center font-bold py-2.5 px-2 w-20 bg-white border-b-2 border-slate-200">日期</th>
                <th className="sticky top-0 z-10 text-center font-bold py-2.5 px-2 w-20 bg-white border-b-2 border-slate-200">提出人</th>
                <th className="sticky top-0 z-10 text-left font-bold py-2.5 px-2 bg-white border-b-2 border-slate-200">提议内容</th>
                <th className="sticky top-0 z-10 text-center font-bold py-2.5 px-2 w-16 bg-white border-b-2 border-slate-200">节点</th>
                <th className="sticky top-0 z-10 text-center font-bold py-2.5 px-2 w-24 bg-white border-b-2 border-slate-200">部门</th>
                <th className="sticky top-0 z-10 text-center font-bold py-2.5 px-2 w-28 whitespace-nowrap bg-white border-b-2 border-slate-200">责任人</th>
                <th className="sticky top-0 z-10 text-center font-bold py-2.5 px-2 w-48 bg-white border-b-2 border-slate-200">{isDone ? '稽核' : '本期填报'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it, i) => (
                <tr key={it.id} className="[&>td]:border-b [&>td]:border-slate-100 hover:bg-slate-50/70 transition-colors group">
                  <td className="text-center py-2.5 px-2">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0 group-hover:scale-125 transition-transform`} />
                      <span className="text-base font-bold text-slate-400 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    </div>
                  </td>
                  <td className="text-center py-2.5 px-2 text-base text-slate-600 tabular-nums">{formatDateCN(it.meeting_date) || '-'}</td>
                  <td className="text-center py-2.5 px-2 text-base text-slate-600">{it.proposer || <span className="text-slate-300">待补充</span>}</td>
                  <td className="text-left py-2.5 px-2 text-base font-medium text-slate-800 leading-snug">{it.description}</td>
                  <td className="text-center py-2.5 px-2 text-base">
                    <span className={cn(
                      'px-1.5 py-0.5 rounded-full border text-base',
                      (it.due_date_type || 'date') === 'continuous' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                      (it.due_date_type || 'date') === 'tbd' ? 'bg-slate-50 text-slate-500 border-slate-200' :
                      'bg-blue-50 text-blue-600 border-blue-100'
                    )}>
                      {(it.due_date_type || 'date') === 'continuous' ? '持续' :
                       (it.due_date_type || 'date') === 'tbd' ? '待定' : '日期'}
                    </span>
                  </td>
                  <td className="text-center py-2.5 px-2 text-base text-slate-600">{it.dept || '—'}</td>
                  <td className="text-center py-2.5 px-2 text-base text-slate-600 whitespace-nowrap">{it.owner || '待分配'}</td>
                  <td className="text-center py-2.5 px-2">
                    {isDone ? (
                      <span className={cn(
                        'text-base font-medium tabular-nums px-1.5 py-0.5 rounded',
                        it.oa_score === 1 ? 'text-emerald-600 bg-emerald-50' :
                        it.oa_score === -1 ? 'text-red-600 bg-red-50' :
                        it.oa_score === 0 ? 'text-blue-600 bg-blue-50' :
                        'text-slate-300'
                      )}>
                        {it.oa_score === 1 ? 'V' : it.oa_score === -1 ? 'X' : it.oa_score === 0 ? '0' : '-'}
                      </span>
                    ) : (
                      <div className="w-48" title={progressMap?.[it.id]?.progress || it.oa_result || undefined}>
                        {(() => {
                          const pr = progressMap?.[it.id];
                          if (pr?.progress) {
                            // 自动取数：格子只显示简短汇总，点击弹明细表格
                            const hasDetail = Array.isArray(pr.detail) && pr.detail.length > 0;
                            if (hasDetail && onShowDetail) {
                              return (
                                <div className="space-y-0.5">
                                  <button
                                    onClick={() => onShowDetail({ progress: pr.progress || '', cycleDate: pr.cycleDate, detail: pr.detail as any[], sourceKey: (it as any).auto_fetch_source ?? null })}
                                    className="inline-flex items-center gap-1 text-base font-medium text-blue-600 hover:text-blue-800"
                                    title="查看本周明细"
                                  >
                                    {pr.progress}<ChevronRight className="w-3.5 h-3.5" />
                                  </button>
                                  <p className="text-[13px] text-slate-400">自动取数 · 数据至 {(pr.cycleDate || '').slice(5).replace('-', '/')}</p>
                                </div>
                              );
                            }
                            return (
                              <div className="space-y-0.5">
                                <p className="text-base text-slate-700 leading-snug">{pr.progress}</p>
                                <p className="text-[13px] text-slate-400">{pr.cycleDate} 填报</p>
                              </div>
                            );
                          }
                          const fallback = it.oa_result || '';
                          // 导入元数据（{"y":..,"w":..,"d":..} 年/周/日期 JSON）不算填报内容
                          const isMetaJson = (() => {
                            if (!fallback || !fallback.trim().startsWith('{')) return false;
                            try { const j = JSON.parse(fallback); return !!(j.y || j.w || j.d); } catch { return false; }
                          })();
                          return fallback && !isMetaJson ? (
                            <div className="space-y-0.5">
                              <p className="text-base text-slate-700 leading-snug">{fallback}</p>
                              <p className="text-[13px] text-slate-400">{it.meeting_date ? formatDateCN(it.meeting_date) + ' 填报' : ''}</p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-base px-1.5 py-0.5 rounded-full border border-amber-200 text-amber-600 bg-amber-50">未填报</span>
                          );
                        })()}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// // 中文日期格式：2026-07-20 → 7月20日
function formatDateCN(d: string | null | undefined) {
  if (!d) return '未定';
  const m = d.slice(5, 7).replace(/^0/, '');
  const day = d.slice(8, 10).replace(/^0/, '');
  return `${m}月${day}日`;
}

// ─────────────────────────────────────────────────────────────
// 占位页：后续异构内容插槽
// ─────────────────────────────────────────────────────────────
function PlaceholderSlide({ title, hint }: { title: string; hint: string }) {
  return (
    <SlideShell eyebrow="待补充" title={title} subtitle="此页内容待定义" accent="from-slate-400 to-slate-500">
      <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-3">
        <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center">
          <LayoutTemplate className="w-8 h-8" />
        </div>
        <p className="text-base text-slate-400">{hint}</p>
      </div>
    </SlideShell>
  );
}

// ─────────────────────────────────────────────────────────────
// 幻灯片通用外壳：标题栏 + 内容区，统一 16:9 视觉
// ─────────────────────────────────────────────────────────────
function SlideShell({
  eyebrow, title, subtitle, accent, children,
}: {
  eyebrow: string; title: string; subtitle: string; accent: string; children: React.ReactNode;
}) {
  return (
    <div className="relative w-full h-full bg-white rounded-2xl shadow-2xl ring-1 ring-slate-100 overflow-hidden flex flex-col">
      {/* 顶部色带 */}
      <div className={cn('h-1.5 w-full bg-gradient-to-r', accent)} />
      {/* 标题栏 */}
      <div className="px-8 pt-5 pb-3 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-base font-bold uppercase tracking-widest text-slate-400">{eyebrow}</span>
          </div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tight">{title}</h2>
        </div>
        <p className="text-base text-slate-400 hidden sm:block">{subtitle}</p>
      </div>
      {/* 内容区 */}
      <div className="flex-1 min-h-0 px-8 pb-6 flex flex-col">{children}</div>
    </div>
  );
}

function Chip({ icon, className, children }: { icon: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-medium', className)}>
      {icon}{children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// 滑动演示主体
// ─────────────────────────────────────────────────────────────
export default function MonthlyBoardPage() {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, {   progress: string | null; cycleDate: string; syncedAt: string; dataMonth?: string | null; detail?: any[] | null }>>({});
  const [loading, setLoading] = useState(true);
  const [immersive, setImmersive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);
  const [cycleOffset, setCycleOffset] = useState(0); // 0=当前周期，1=上一周期，-1=下一周期
  const deckRef = useRef<HTMLDivElement>(null);
  const [doneDetail, setDoneDetail] = useState<BoardItem | null>(null); // 点开「已完成项」详情
  const [contDetail, setContDetail] = useState<{ progress: string; cycleDate?: string; detail: any[]; sourceKey?: string | null } | null>(null); // 点开持续项自动取数明细

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/actions').then(r => r.json());
      if (r.success) setItems(r.data || []);
      // 拉取持续项周期填报进展（actionId → 进展列表）
      const pr = await fetch('/api/continuous/progress').then(r => r.json());
      if (pr.success) {
        const map: Record<string, {   progress: string | null; cycleDate: string; syncedAt: string; dataMonth?: string | null; detail?: any[] | null }> = {};
        for (const [actionId, recs] of Object.entries(pr.data || {})) {
          const list = (recs as any[]);
          const latest = list.sort((a, b) => String(b.cycleDate).localeCompare(String(a.cycleDate)))[0];
          if (latest) {
            map[actionId] = {
              progress: latest.progress || null,
              cycleDate: latest.cycleDate,
              syncedAt: latest.syncedAt,
              dataMonth: latest.dataMonth || null,
              detail: latest.detail ?? null,
            };
          }
        }
        setProgressMap(map);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // 监听 carousel 选中状态
  useEffect(() => {
    if (!api) return;
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap());
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    api.on('select', onSelect);
    api.on('reInit', onSelect);
    return () => { api.off('select', onSelect); };
  }, [api]);

  // 自动播放
  useEffect(() => {
    if (!playing || !api) return;
    const t = setInterval(() => {
      if (api.canScrollNext()) api.scrollNext();
      else api.scrollTo(0);
    }, 6000);
    return () => clearInterval(t);
  }, [playing, api]);

  // ── 沉浸模式：进入真正的浏览器全屏（隐藏浏览器 UI，画面铺满屏幕）──
  const enterImmersive = useCallback(() => {
    setImmersive(true);
    const el = deckRef.current;
    if (el && !document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const exitImmersive = useCallback(() => {
    setImmersive(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const toggleImmersive = useCallback(() => {
    if (immersive) exitImmersive();
    else enterImmersive();
  }, [immersive, enterImmersive, exitImmersive]);

  // 浏览器全屏状态变化（如按 Esc 退出全屏）时同步 immersive 状态
  useEffect(() => {
    const onFsChange = () => setImmersive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // 全局键盘控制
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); api?.scrollNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); api?.scrollPrev(); }
      else if (e.key === 'Escape') { if (immersive) exitImmersive(); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleImmersive(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, immersive, exitImmersive, toggleImmersive]);

  // 产销会数据（总览页只统计产销会，排除持续项——持续项单独统计）
  const monthlyItems = useMemo(
    () => items.filter(i => i.meeting_type === '产销会' && i.due_date_type !== 'continuous'),
    [items]
  );
  // 产销会持续项（总览页单独展示）
  const monthlyContItems = useMemo(
    () => items.filter(i => i.meeting_type === '产销会' && i.due_date_type === 'continuous'),
    [items]
  );

  // 持续项：需按期填报汇报的持续执行项（仅产销会；无「已完成/未完成」口径，取消/关闭的不再汇报）
  const continuousPendingItems = useMemo(
    () => items.filter(i => {
      const mt = i.meeting_type || '';
      if (mt !== '产销会') return false;
      const ds = getActionDisplayStatus(i.status);
      if (ds === 'done' || ds === 'cancelled') return false;
      if (isExcluded(i)) return false; // 打0：不归属任何板块
      return (i.due_date_type || '') === 'continuous';
    }).sort((a, b) => {
      const o = (a.owner || '').localeCompare(b.owner || '', 'zh');
      if (o !== 0) return o;
      return (a.description || '').localeCompare(b.description || '', 'zh');
    }),
    [items]
  );

  // 持续项：已完成（仅产销会，打V 或 status=done）
  const continuousDoneItems = useMemo(
    () => items.filter(i => {
      const mt = i.meeting_type || '';
      if (mt !== '产销会') return false;
      if (isExcluded(i)) return false; // 打0：不归属任何板块
      if ((i.due_date_type || '') !== 'continuous') return false;
      return isDone(i);
    }).sort((a, b) => {
      const o = (a.owner || '').localeCompare(b.owner || '', 'zh');
      if (o !== 0) return o;
      return (a.description || '').localeCompare(b.description || '', 'zh');
    }),
    [items]
  );

  // 本周期节点到期（截止日落在本周期）的未完成项；按节点日期统计
  const lastMonthItems = useMemo(() => {
    const { start, end } = prodCycleRange(cycleOffset);
    return items.filter(i => {
      if (i.meeting_type !== '产销会') return false;
      if (i.due_date_type === 'continuous') return false; // 第一页只核算行动项台账，不含持续项
      if (i.due_date_type === 'tbd' || !i.due_date) return false; // 日期未明确的不算任务项
      const ds = getActionDisplayStatus(i.status);
      if (ds === 'cancelled') return false;
      if (isExcluded(i)) return false; // 打0：产销会不归属任何板块
      if (isDone(i)) return false; // 打 V 或状态 done = 已完成
      const dd = new Date(i.due_date.slice(0, 10));
      return dd >= start && dd <= end;
    }).sort((a, b) => {
      const o = (a.owner || '').localeCompare(b.owner || '', 'zh');
      if (o !== 0) return o;
      return (a.description || '').localeCompare(b.description || '', 'zh');
    });
  }, [items, cycleOffset]);

  // 本周期到期的已完成项（第1页「已完成项」板块展示）
  const lastMonthDoneItems = useMemo(() => {
    const { start, end } = prodCycleRange(cycleOffset);
    return items.filter(i => {
      if (i.meeting_type !== '产销会') return false;
      if (i.due_date_type === 'continuous' || i.due_date_type === 'tbd' || !i.due_date) return false;
      if (getActionDisplayStatus(i.status) === 'cancelled') return false;
      if (isExcluded(i)) return false; // 打0：不归属任何板块
      if (!isDone(i)) return false;
      const dd = new Date(i.due_date.slice(0, 10));
      return dd >= start && dd <= end;
    }).sort((a, b) => {
      const o = (a.owner || '').localeCompare(b.owner || '', 'zh');
      if (o !== 0) return o;
      return (a.description || '').localeCompare(b.description || '', 'zh');
    });
  }, [items, cycleOffset]);

  // 本周期年月标签（用于标题「N月」），取周期起始月
  const lastMonthLabel = useMemo(() => {
    const { start } = prodCycleRange(cycleOffset);
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  }, [cycleOffset]);

  // 底部统计：当前周期 N → 上一周期 N+1 → 对比周期 N+2
  // 数据周期无完整数据时回退模拟数据（待数据连续后自动替换）
  const monthStats = useMemo<WeekStats>(() => {
    // 算指定周期偏移的完成率
    const calcCycle = (off: number) => {
      const { start, end } = prodCycleRange(cycleOffset + off);
      const moItems = items.filter(i => {
        if ((i.meeting_type !== '产销会')) return false;
        if (i.due_date_type === 'continuous') return false; // 仅核算行动项台账，不含持续项
        if (i.due_date_type === 'tbd' || !i.due_date) return false; // 日期未明确的不算任务项
        if (isExcluded(i)) return false; // 打0不计入目标数与完成率
        const dd = new Date(i.due_date.slice(0, 10));
        return dd >= start && dd <= end;
      });
      const total = moItems.length;
      const cancelled = moItems.filter(i => getActionDisplayStatus(i.status) === 'cancelled').length;
      const done = moItems.filter(isDone).length;
      const valid = total - cancelled; // 目标数（去取消）
      const rate = valid > 0 ? (done / valid) * 100 : null;
      return { total, valid, done, rate, hasData: total > 0 };
    };

    const dataM = calcCycle(0);    // 当前数据周期
    const compareM = calcCycle(1); // 上一周期（对比）

    const { start } = prodCycleRange(cycleOffset);
    const dataYear = start.getFullYear();
    const dataMonth = start.getMonth() + 1;

    // 数据周期无数据 → 模拟兜底
    if (!dataM.hasData) {
      return { year: dataYear, monthNum: dataMonth, target: 12, done: 9, rate: 75, diff: 4, mock: true };
    }
    const rate = dataM.rate ?? 0;
    const diff = compareM.rate !== null ? rate - compareM.rate : 0;
    return { year: dataYear, monthNum: dataMonth, target: dataM.valid, done: dataM.done, rate, diff, mock: false };
  }, [items, cycleOffset]);

  // 幻灯片清单 —— 后续异构页在此追加
  const slides = useMemo(() => [
    { id: 'overdue', label: '未完成项通报', node: <OverdueNoticeSlide items={lastMonthItems} doneItems={lastMonthDoneItems} allItems={items} monthLabel={lastMonthLabel} stats={monthStats} onDoneClick={setDoneDetail} /> },
    { id: 'continuous-pending', label: '持续项汇报', node: <ContinuousSlide items={continuousPendingItems} mode="pending" progressMap={progressMap} onShowDetail={setContDetail} /> },
    { id: 'stats', label: '总览', node: <StatsSlide items={monthlyItems} contItems={monthlyContItems} progressMap={progressMap} cycleOffset={cycleOffset} /> },
  ], [monthlyItems, monthlyContItems, lastMonthItems, lastMonthDoneItems, lastMonthLabel, monthStats, continuousPendingItems, progressMap, cycleOffset, items]);

  const goPrev = () => api?.scrollPrev();
  const goNext = () => api?.scrollNext();

  return (
    <DashboardLayout>
      <div
        ref={deckRef}
        className={cn(
          'flex flex-col transition-all duration-300',
          immersive
            ? 'fixed inset-0 z-[200] bg-slate-900'
            : 'h-[calc(100vh-104px)] bg-slate-200/70'
        )}
      >
        {/* 顶部工具栏（沉浸模式浮于画面之上，不占版面高度） */}
        <div className={cn(
          'flex items-center justify-between gap-3',
          immersive
            ? 'absolute top-3 left-3 right-3 z-30 sm:top-4 sm:left-6 sm:right-6 rounded-xl bg-slate-900/70 backdrop-blur-md px-3 py-2 text-white'
            : 'mb-3 flex-shrink-0 text-slate-700'
        )}>
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-base font-bold px-2.5 py-1 rounded-lg',
              immersive ? 'bg-white/10' : 'bg-blue-50 text-blue-600'
            )}>
              {slides[current]?.label ?? ''}
            </span>
            {loading && <span className="text-base opacity-60">加载中…</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn(
              'flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-xs font-medium',
              immersive ? 'bg-white/10 text-white' : 'bg-white border border-slate-200 text-slate-600'
            )}>
              <button onClick={() => setCycleOffset(o => o + 1)} title="上一周期" className="px-1.5 hover:opacity-70 text-sm">‹</button>
              <span className="px-1 tabular-nums">{lastMonthLabel}</span>
              <button onClick={() => setCycleOffset(o => o - 1)} title="下一周期（可看未来）" className="px-1.5 hover:opacity-70 text-sm">›</button>
            </div>
            <ToolbarBtn onClick={load} title="刷新数据" immersive={immersive}>
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => setPlaying(v => !v)}
              title={playing ? '暂停自动播放' : '自动播放'}
              active={playing}
              immersive={immersive}
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </ToolbarBtn>
            <ToolbarBtn onClick={toggleImmersive} title="沉浸模式 (F)" immersive={immersive}>
              {immersive ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </ToolbarBtn>
            <BoardBigTextToggle immersive={immersive} />
          </div>
        </div>

        {/* 幻灯片区域 */}
        <div className={immersive ? 'absolute inset-0' : 'flex-1 min-h-0 relative'}>
          <Carousel
            opts={{ loop: false, align: 'start', containScroll: 'trimSnaps' }}
            setApi={setApi}
            className="h-full [&>div]:h-full"
          >
            <CarouselContent className="h-full">
              {slides.map(s => (
                <CarouselItem key={s.id} className="h-full">
                  <div className="h-full w-full flex items-center justify-center px-2">
                    {/* 固定 1600×900 设计稿 + 整体等比缩放：任何分辨率/电视投屏字号比例一致 */}
                    <SlideFrame>
                      {s.node}
                    </SlideFrame>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>

          {/* 左右翻页按钮 */}
          <NavArrow side="left" onClick={goPrev} disabled={!api?.canScrollPrev()} immersive={immersive} />
          <NavArrow side="right" onClick={goNext} disabled={!api?.canScrollNext()} immersive={immersive} />
        </div>

        {/* 底部页码 + 圆点 */}
        <div className={cn(
          'flex items-center justify-center gap-3',
          immersive
            ? 'absolute bottom-4 left-0 right-0 z-30 text-white'
            : 'mt-3 flex-shrink-0 text-slate-500'
        )}>
          <span className="text-base tabular-nums opacity-70 w-12 text-center">
            {current + 1} / {count}
          </span>
          <div className="flex items-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => api?.scrollTo(i)}
                title={s.label}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i === current
                    ? (immersive ? 'w-6 bg-white' : 'w-6 bg-blue-500')
                    : (immersive ? 'w-1.5 bg-white/30 hover:bg-white/50' : 'w-1.5 bg-slate-300 hover:bg-slate-400')
                )}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 已完成项详情弹窗（浮于投屏/沉浸层之上） */}
      <ActionDoneDetailDialog item={doneDetail} onClose={() => setDoneDetail(null)} />
      {/* 持续项自动取数明细弹窗 */}
      <ContinuousDetailDialog item={contDetail} onClose={() => setContDetail(null)} />
    </DashboardLayout>
  );
}

// ── 小控件 ──
function ToolbarBtn({
  children, onClick, title, active, immersive,
}: {
  children: React.ReactNode; onClick: () => void; title: string; active?: boolean; immersive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
        immersive
          ? (active ? 'bg-white text-slate-900' : 'bg-white/10 text-white hover:bg-white/20')
          : (active ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50')
      )}
    >
      {children}
    </button>
  );
}

function NavArrow({
  side, onClick, disabled, immersive,
}: {
  side: 'left' | 'right'; onClick: () => void; disabled?: boolean; immersive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? '上一页' : '下一页'}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-0 disabled:pointer-events-none',
        side === 'left' ? 'left-2' : 'right-2',
        immersive
          ? 'bg-white/15 text-white hover:bg-white/25 backdrop-blur-sm'
          : 'bg-white/90 text-slate-600 hover:bg-white shadow-md border border-slate-100'
      )}
    >
      {side === 'left' ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
    </button>
  );
}
