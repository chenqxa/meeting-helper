'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { ChevronLeft, ChevronRight, Trophy, RefreshCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Granularity = 'week' | 'month' | 'year';

interface PeriodStat { recv: number; done: number; x: number; overdue: number; tbd: number; }
interface PersonInfo { dept: string; proposerCnt: number; }

interface ApiData {
  granularity: Granularity;
  offset: number;
  agg: Record<string, Record<string, PeriodStat>>;
  personInfo: Record<string, PersonInfo>;
  continuous: Record<string, { total: number; filled: number }>;
}

export default function ContributionBoard() {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState('all');
  const [sortKey, setSortKey] = useState<'score' | 'done' | 'recv' | 'rate'>('score');
  const [detailPerson, setDetailPerson] = useState<string | null>(null);

  const load = useCallback(async (g: Granularity, off: number) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/contribution?granularity=${g}&offset=${off}`).then(r => r.json());
      if (r.success) setData(r.data);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(granularity, offset); }, [granularity, offset, load]);

  // 该粒度下所有周期 key，最新在前
  const periodKeys = useMemo(() => {
    if (!data) return [];
    const keys = new Set<string>();
    for (const p of Object.values(data.agg)) for (const k of Object.keys(p)) keys.add(k);
    return [...keys].sort().reverse(); // 最新在前
  }, [data]);

  // 今天所在的周期 key（与后端口径一致）
  const todayKey = useMemo(() => {
    const d = new Date();
    if (granularity === 'year') return String(d.getFullYear());
    if (granularity === 'month') {
      const y = d.getFullYear(), m = d.getMonth();
      return `${y}-${String(m + 1).padStart(2, '0')}`;
    }
    const day = (d.getDay() + 6) % 7;
    const monday = new Date(d); monday.setDate(d.getDate() - day);
    return `${monday.getFullYear()}-W${String(isoWeekNumber(monday)).padStart(2, '0')}`;
  }, [granularity]);

  // 今天所在期在 periodKeys 中的下标；本期无数据时回退到最近一个不晚于今天的期，再退无可退取最新
  const todayIndex = useMemo(() => {
    const idx = periodKeys.indexOf(todayKey);
    if (idx >= 0) return idx;
    const prev = periodKeys.findIndex(k => k < todayKey);
    return prev >= 0 ? prev : 0;
  }, [periodKeys, todayKey]);

  // offset：相对"今天所在期"的偏移，0=今天这期，+1=往回看旧期，-1=往未来翻
  const currentPeriod = periodKeys[todayIndex + offset] || '';
  const oldestOffset = periodKeys.length - 1 - todayIndex; // 往回翻的上限
  const newestOffset = -todayIndex;                        // 往未来翻的下限

  // 当前期排行榜
  const rows = useMemo(() => {
    if (!data || !currentPeriod) return [];
    const list: Array<{ name: string; dept: string; proposerCnt: number; stat: PeriodStat; rate: number; score: number }> = [];
    for (const [name, periods] of Object.entries(data.agg)) {
      const stat = periods[currentPeriod];
      if (!stat) continue;
      const info = data.personInfo[name] || { dept: '', proposerCnt: 0 };
      if (deptFilter !== 'all' && info.dept !== deptFilter) continue;
      const rate = stat.recv > 0 ? (stat.done / stat.recv) * 100 : 0;
      list.push({ name, dept: info.dept || '未分配', proposerCnt: info.proposerCnt, stat, rate, score: stat.done * rate / 100 });
    }
    list.sort((a, b) => {
      if (sortKey === 'recv') return b.stat.recv - a.stat.recv;
      if (sortKey === 'rate') return b.rate - a.rate;
      if (sortKey === 'score') return b.score - a.score;
      return b.stat.done - a.stat.done;
    });
    return list;
  }, [data, currentPeriod, deptFilter, sortKey]);

  const depts = useMemo(() => {
    if (!data) return [];
    return [...new Set(Object.values(data.personInfo).map(i => i.dept).filter(Boolean))].sort();
  }, [data]);

  // 汇总
  const totals = useMemo(() => {
    const t = { recv: 0, done: 0, x: 0, overdue: 0 };
    for (const r of rows) {
      t.recv += r.stat.recv; t.done += r.stat.done; t.x += r.stat.x; t.overdue += r.stat.overdue;
    }
    return t;
  }, [rows]);

  // 明细弹窗数据（该人当前期任务）
  const detailRows = useMemo(() => {
    if (!data || !detailPerson || !currentPeriod) return [];
    return (data as any).raw?.[detailPerson]?.[currentPeriod] || [];
  }, [data, detailPerson, currentPeriod]);

  const switchGran = (g: Granularity) => { setGranularity(g); setOffset(0); };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-4">
        {/* 顶栏 */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {([['week', '周'], ['month', '月'], ['year', '年']] as Array<[Granularity, string]>).map(([g, label]) => (
              <button key={g} onClick={() => switchGran(g)}
                className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
                  granularity === g ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setOffset(o => Math.min(oldestOffset, o + 1))} disabled={offset >= oldestOffset} title="上一期" className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            <span className="px-3 text-sm font-bold text-slate-700 tabular-nums w-24 text-center">{currentPeriod || '—'}</span>
            <button onClick={() => setOffset(o => Math.max(newestOffset, o - 1))} disabled={offset <= newestOffset} title="下一期" className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="all">全部部门</option>
            {depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={() => load(granularity, offset)} title="刷新"
            className="w-9 h-9 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-sm text-slate-400">统计中…</div>
        ) : data ? (
          <>
            {/* 汇总卡 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: '总接收任务', value: totals.recv, cls: 'text-blue-600 bg-blue-50 border-blue-100' },
                { label: '总完成', value: totals.done, cls: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
                { label: '总未完成(打X)', value: totals.x, cls: 'text-red-600 bg-red-50 border-red-100' },
                { label: '超期未完成', value: totals.overdue, cls: 'text-amber-600 bg-amber-50 border-amber-100' },
              ].map(c => (
                <div key={c.label} className={cn('rounded-2xl border p-4', c.cls)}>
                  <p className="text-xs font-medium opacity-70">{c.label}</p>
                  <p className="text-3xl font-black mt-1 tabular-nums">{c.value}</p>
                </div>
              ))}
            </div>

            {/* 排行榜 */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-bold text-slate-700">个人贡献榜 · {currentPeriod}</h3>
                </div>
                <div className="flex gap-1">
                  {([['score', '按评分'], ['done', '按完成'], ['recv', '按接收'], ['rate', '按完成率']] as Array<['score' | 'done' | 'recv' | 'rate', string]>).map(([k, label]) => (
                    <button key={k} onClick={() => setSortKey(k)}
                      className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                        sortKey === k ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50/50">
                      <th className="text-center font-semibold px-3 py-2.5 w-12">排名</th>
                      <th className="text-left font-semibold px-3 py-2.5">姓名</th>
                      <th className="text-left font-semibold px-3 py-2.5">部门</th>
                      <th className="text-center font-semibold px-3 py-2.5">接收</th>
                      <th className="text-center font-semibold px-3 py-2.5">完成</th>
                      <th className="text-center font-semibold px-3 py-2.5">完成率</th>
                      <th className="text-center font-semibold px-3 py-2.5">未完成(X)</th>
                      <th className="text-center font-semibold px-3 py-2.5">超期未完成</th>
                      <th className="text-center font-semibold px-3 py-2.5">待定(0)</th>
                      <th className="text-center font-semibold px-3 py-2.5">提出任务</th>
                      <th className="text-center font-semibold px-3 py-2.5">评分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr><td colSpan={11} className="text-center py-10 text-sm text-slate-300">本期无数据</td></tr>
                    )}
                    {rows.map((r, i) => (
                      <tr key={r.name} className="border-b border-slate-50 hover:bg-blue-50/20 cursor-pointer"
                        onClick={() => setDetailPerson(r.name)}>
                        <td className="text-center py-2.5 px-3">
                          <span className={cn('inline-flex w-6 h-6 rounded-full text-xs font-bold items-center justify-center',
                            i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'text-slate-400')}>
                            {i + 1}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-sm font-medium text-slate-700">{r.name}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">{r.dept}</td>
                        <td className="text-center py-2.5 px-3 text-sm tabular-nums">{r.stat.recv}</td>
                        <td className="text-center py-2.5 px-3 text-sm font-bold text-emerald-600 tabular-nums">{r.stat.done}</td>
                        <td className="text-center py-2.5 px-3 text-sm tabular-nums">{r.rate.toFixed(0)}%</td>
                        <td className="text-center py-2.5 px-3 text-sm text-red-500 tabular-nums">{r.stat.x}</td>
                        <td className="text-center py-2.5 px-3 text-sm text-amber-600 tabular-nums">{r.stat.overdue}</td>
                        <td className="text-center py-2.5 px-3 text-sm text-slate-400 tabular-nums">{r.stat.tbd}</td>
                        <td className="text-center py-2.5 px-3 text-sm text-slate-500 tabular-nums">{r.proposerCnt}</td>
                        <td className="text-center py-2.5 px-3 text-sm font-bold text-blue-600 tabular-nums">{r.score.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 持续项填报率 */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
                <RefreshCw className="w-4 h-4 text-blue-500" />
                <h3 className="text-sm font-bold text-slate-700">持续项填报率</h3>
                <span className="text-xs text-slate-400">应填报 = 名下持续项数；已填 = 有填报记录的（含提前填报）</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50/50">
                      <th className="text-left font-semibold px-5 py-2.5">姓名</th>
                      <th className="text-center font-semibold px-3 py-2.5">应填报</th>
                      <th className="text-center font-semibold px-3 py-2.5">已填报</th>
                      <th className="text-left font-semibold px-5 py-2.5">填报率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries((data?.continuous) || {}).sort((a, b) => (b[1].total ? b[1].filled / b[1].total : 0) - (a[1].total ? a[1].filled / a[1].total : 0)).map(([name, v]) => {
                      const rate = v.total > 0 ? (v.filled / v.total) * 100 : 0;
                      return (
                        <tr key={name} className="border-b border-slate-50">
                          <td className="px-5 py-2.5 text-sm text-slate-700">{name}</td>
                          <td className="text-center py-2.5 px-3 text-sm tabular-nums">{v.total}</td>
                          <td className="text-center py-2.5 px-3 text-sm tabular-nums">{v.filled}</td>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-40 h-2 rounded-full bg-slate-100 overflow-hidden">
                                <div className={cn('h-full rounded-full', rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-500')}
                                  style={{ width: `${rate}%` }} />
                              </div>
                              <span className="text-xs text-slate-500 tabular-nums">{rate.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="py-20 text-center text-sm text-slate-400">暂无数据</div>
        )}
      </div>

      {/* 明细弹窗 */}
      {detailPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetailPerson(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-700">{detailPerson} · {currentPeriod} 任务明细</h3>
              <button onClick={() => setDetailPerson(null)} className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3">
              {detailRows.length === 0 ? (
                <div className="text-center py-10 text-sm text-slate-300">该期无任务</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-100">
                      <th className="text-left font-semibold py-2 pr-2">内容</th>
                      <th className="text-center font-semibold py-2 px-2 w-20">节点</th>
                      <th className="text-center font-semibold py-2 px-2 w-16">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((t: any, idx: number) => (
                      <tr key={idx} className="border-b border-slate-50">
                        <td className="py-2 pr-2 text-sm text-slate-700">{t.description}</td>
                        <td className="text-center py-2 px-2 text-xs text-slate-500 tabular-nums">{t.due_date}</td>
                        <td className="text-center py-2 px-2">
                          <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                            t.status === 'done' || t.oa_score === 1 ? 'bg-emerald-50 text-emerald-600' :
                            t.status === 'blocked' || t.oa_score === -1 ? 'bg-red-50 text-red-600' :
                            t.oa_score === 0 ? 'bg-slate-50 text-slate-500' : 'bg-amber-50 text-amber-600')}>
                            {t.status === 'done' || t.oa_score === 1 ? '完成' : t.status === 'blocked' || t.oa_score === -1 ? '未完成' : t.oa_score === 0 ? '待定' : '待办'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function isoWeekNumber(d: Date): number {
  const date = new Date(d); date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7;
  const thursday = new Date(date); thursday.setDate(date.getDate() - day + 3);
  const firstThu = new Date(thursday.getFullYear(), 0, 4);
  const diff = ((firstThu.getDay() + 6) % 7);
  const firstThuAdjusted = new Date(firstThu); firstThuAdjusted.setDate(firstThu.getDate() - diff);
  return Math.floor((thursday.getTime() - firstThuAdjusted.getTime()) / (7 * 86400000)) + 1;
}
