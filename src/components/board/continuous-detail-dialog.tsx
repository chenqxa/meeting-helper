'use client';

// 会议看板「持续项·自动取数」明细弹窗：点击"本周 N 单"后展示明细
// 列定义按来源 detail[0].kind 切换：
//   scrap   呆滞出库        物料代码/名称/数量/单位
//   price   采购价格维护    物料代码/名称/规格/单位 + 原价/新价/终价（表头带供应商）
//   work    工价维护        整机代码/名称 + 工序/工时/件工数/工价/人数/备注
//   supplier 新供应商评审    申请日期/供应商名称/联系人/评审产品/类别/质量分/结论
//   sample   打样及时率      单号/申请日期/预计交样/收到样品/及时
//   inspection 验货订单提前2天入库（产销会·月度） 验货申请单/申请/验货/销售订单/cp入库单/入库日期/提前情况
//   ledger-move 账随物动（月会按月/周例会按周）  逐月趋势表（月份/单数/小于2天/占比/平均天数）+ 本期高亮
//   subcontract-issue 委外按单领料（按会议类型落窗）  逐月趋势表（月份/订单数/有领料/无领料/下推率）+ 本期高亮
//   po-match 采购来料匹配（公司月会按月）  原因分布 + 逐月趋势 + 未匹配明细
import React, { useEffect } from 'react';
import { X, FileText, Info } from 'lucide-react';
import { autoFetchSourceInfo } from '@/lib/auto-fetch-sources-meta';

export interface AutoDetailBill {
  kind?: string;
  bill: string;
  date?: string;
  status?: string;
  supplier?: string;
  use?: string;
  lines: Record<string, unknown>[];
}

export interface AutoDetailRecord {
  progress: string;
  cycleDate?: string;
  sourceKey?: string | null;
  detail: any[];
}

const fmtNum = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? '' : String(Number(v)));
const fmtMoney = (v: unknown) => {
  if (v == null || v === '' || isNaN(Number(v))) return '';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
};

interface ColDef { key: string; label: string; align: 'text' | 'num' | 'money'; }

const COLS: Record<string, ColDef[]> = {
  scrap: [
    { key: 'itemNo', label: '物料代码', align: 'text' },
    { key: 'itemName', label: '物料名称', align: 'text' },
    { key: 'qty', label: '数量', align: 'num' },
    { key: 'unit', label: '单位', align: 'text' },
  ],
  price: [
    { key: 'itemNo', label: '物料代码', align: 'text' },
    { key: 'itemName', label: '物料名称', align: 'text' },
    { key: 'spec', label: '规格', align: 'text' },
    { key: 'unit', label: '单位', align: 'text' },
  ],
  work: [
    { key: 'itemNo', label: '整机编码', align: 'text' },
    { key: 'itemName', label: '整机名称', align: 'text' },
    { key: 'gx', label: '工序', align: 'text' },
    { key: 'pph', label: '工时', align: 'num' },
    { key: 'pjgs', label: '件工数', align: 'num' },
    { key: 'dj', label: '工价', align: 'money' },
    { key: 'rs', label: '人数', align: 'num' },
    { key: 'bz', label: '备注', align: 'text' },
  ],
  supplier: [
    { key: 'date', label: '申请日期', align: 'text' },
    { key: 'supplier', label: '供应商名称', align: 'text' },
    { key: 'contact', label: '联系人', align: 'text' },
    { key: 'product', label: '评审产品', align: 'text' },
    { key: 'cat', label: '类别', align: 'text' },
    { key: 'score', label: '质量分', align: 'num' },
    { key: 'verdict', label: '结论', align: 'text' },
  ],
  sample: [
    { key: 'djbh', label: '单号', align: 'text' },
    { key: 'sqrq', label: '申请日期', align: 'text' },
    { key: 'yjjyrq', label: '预计交样', align: 'text' },
    { key: 'sdyprq', label: '收到样品', align: 'text' },
    { key: 'onTime', label: '及时', align: 'text' },
  ],
  inspection: [
    { key: 'sqdh', label: '验货申请单', align: 'text' },
    { key: 'sqrq', label: '申请日期', align: 'text' },
    { key: 'yhrq', label: '验货日期', align: 'text' },
    { key: 'soNo', label: '销售订单', align: 'text' },
    { key: 'rkNo', label: 'cp入库单', align: 'text' },
    { key: 'rkDate', label: '入库日期', align: 'text' },
    { key: 'dyText', label: '提前情况', align: 'text' },
  ],
};

// 账期改善：第二层=汇总卡+条件表(+取数说明)，第三层=点击卡片看按月明细(不显示取数说明)
function PaymentTermsDetail({ bill, info }: { bill: AutoDetailBill & { summary?: any; suppliers?: Record<string, { number: string; name: string; amt: number }[]>; monthlyTrend?: any[]; changePeriod?: string; changesWeek?: { djbh: string; gysdm: string; gysmc: string; from: string; to: string; date: string }[]; changesTrend?: { ym: string; cnt: number; current: string }[] }; info?: { name: string; src: string; how: string; when: string } | null }) {
  const [expandedTerm, setExpandedTerm] = React.useState<string | null>(null);
  const [drillMetric, setDrillMetric] = React.useState<'sup' | 'amt' | null>(null);
  const s = bill.summary || {};
  const lines = bill.lines || [];
  const suppliers = bill.suppliers || {};
  const trend = (bill.monthlyTrend || []).filter((t: any) => t.supCnt > 0);
  const fmtWan = (v: unknown) => (v == null || isNaN(Number(v))) ? '—' : `${(Number(v) / 10000).toFixed(0)}万`;
  const rateKey = drillMetric === 'amt' ? 'amtRate' : 'supRate';
  const target = drillMetric === 'amt' ? 75 : 65;
  const label = drillMetric === 'amt' ? '金额占比' : '家数占比';
  const maxRate = Math.max(...trend.map((t: any) => t[rateKey] || 0), target);
  const yearRate = drillMetric === 'amt' ? s.amtRate : s.supRate;

  // ─── 第三层：管理层视图（仪表盘 + 红绿灯 + 结论） ───
  if (drillMetric) {
    const isSup = drillMetric === 'sup';
    const yearRateNum = Number(yearRate);
    const gap = target - yearRateNum;
    const statusColor = yearRateNum >= target ? '#059669' : yearRateNum >= target * 0.6 ? '#d97706' : '#dc2626';
    const statusBg = yearRateNum >= target ? 'bg-emerald-500' : yearRateNum >= target * 0.6 ? 'bg-amber-500' : 'bg-red-500';
    const statusLabel = yearRateNum >= target ? '🟢 达标' : yearRateNum >= target * 0.6 ? '🟡 有差距' : '🔴 严重落后';

    // 仪表盘参数（SVG 圆环）
    const R = 80, C = 2 * Math.PI * R;
    const rateAngle = Math.min(yearRateNum / 100, 1);
    const targetAngle = target / 100;

    // 分析
    const insights: string[] = [];
    insights.push(`${isSup
      ? `${Number(s.total60Sup)}/${Number(s.totalSup)} 家供应商有60天以上账期`
      : `${fmtWan(s.total60Amt)}/${fmtWan(s.totalAmt)} 的采购额来自60天以上账期供应商`}，年累计占比 <b>${yearRate}%</b>`);
    if (trend.length >= 2) {
      const last = trend[trend.length - 1];
      const prev = trend[trend.length - 2];
      const dir = Number(last[rateKey]) >= Number(prev[rateKey]) ? '↑' : '↓';
      insights.push(`最近月份（${last.month}）${label}为 <b>${last[rateKey]}%</b>（${isSup ? `${last.sup60}/${last.supCnt}家` : `${fmtWan(last.amt60)}/${fmtWan(last.totalAmt)}`}），环比${dir === '↑' ? '<b style="color:#059669">上升</b>' : '<b style="color:#dc2626">下降</b>'}`);
      const best = trend.reduce((a: any, b: any) => b[rateKey] > a[rateKey] ? b : a);
      insights.push(`年内最好水平在 <b>${best.month}</b>（${best[rateKey]}%）`);
    }
    if (gap > 0) {
      insights.push(`<b style="color:#dc2626;font-size:14px">距目标还差 ${gap.toFixed(1)} 个百分点</b>，${isSup ? `需要再推动约 <b>${Math.ceil(Number(s.totalSup) * gap / 100)}</b> 家供应商转为60天以上` : '需要推动更多大额供应商改善账期'}`);
    }

    return (
      <div className="space-y-5">
        {/* 返回 */}
        <div className="flex items-center gap-3">
          <button onClick={() => setDrillMetric(null)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">← 返回汇总</button>
          <span className="text-sm font-bold text-slate-700">{isSup ? '👥 家数占比' : '💰 金额占比'} · 月度分析</span>
        </div>

        {/* 仪表盘 + 状态 */}
        <div className="flex items-center gap-6 bg-slate-50 rounded-2xl p-5">
          {/* SVG 圆环仪表盘 */}
          <div className="relative flex-shrink-0">
            <svg width="180" height="180" viewBox="0 0 180 180">
              {/* 背景圆环 */}
              <circle cx="90" cy="90" r={R} fill="none" stroke="#e2e8f0" strokeWidth="16" />
              {/* 当前值弧 */}
              <circle cx="90" cy="90" r={R} fill="none" stroke={statusColor} strokeWidth="16"
                strokeDasharray={`${C * rateAngle} ${C}`} strokeLinecap="round"
                transform="rotate(-90 90 90)" />
              {/* 目标标记 */}
              <line x1="90" y1="10" x2="90" y2="26" stroke="#334155" strokeWidth="3"
                transform={`rotate(${targetAngle * 360} 90 90)`} />
              <text x="90" y="20" textAnchor="middle" fontSize="9" fill="#334155" transform={`rotate(${targetAngle * 360} 90 90) translate(0 -2)`}>{target}%</text>
            </svg>
            {/* 中心数字 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-black tabular-nums" style={{ color: statusColor }}>{yearRate}%</span>
              <span className="text-[10px] text-slate-400">{label}</span>
            </div>
          </div>
          {/* 状态 + 差距 */}
          <div className="flex-1 space-y-3">
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-lg font-bold text-white ${statusBg}`}>
              {statusLabel}
            </div>
            <div className="text-sm text-slate-600">
              当前 <b className="text-2xl tabular-nums" style={{ color: statusColor }}>{yearRate}%</b>
              <span className="mx-2 text-slate-300">|</span>
              目标 <b className="text-xl tabular-nums text-slate-700">{target}%</b>
              <span className="mx-2 text-slate-300">|</span>
              {gap > 0
                ? <span className="text-red-600 font-bold">差 {gap.toFixed(1)} pt</span>
                : <span className="text-emerald-600 font-bold">已达标 ✓</span>}
            </div>
            {isSup && (
              <div className="text-xs text-slate-500">
                {isSup ? `${s.total60Sup}/${s.totalSup} 家` : `${fmtWan(s.total60Amt)}/${fmtWan(s.totalAmt)}`} · 2026年累计
              </div>
            )}
          </div>
        </div>

        {/* 月度红绿灯卡片 */}
        <div>
          <div className="text-xs font-bold text-slate-600 mb-2">📅 逐月{label}（颜色：🟢达标 🟡接近 🔴落后）</div>
          <div className="grid grid-cols-5 sm:grid-cols-9 gap-2">
            {trend.map((t: any, i: number) => {
              const val = t[rateKey];
              const prev = i > 0 ? trend[i - 1][rateKey] : null;
              const dir = prev !== null ? (val >= prev ? '↑' : '↓') : '';
              const dirColor = prev !== null ? (val >= prev ? 'text-emerald-500' : 'text-red-500') : '';
              const bg = val >= target ? 'bg-emerald-50 border-emerald-300' : val >= target * 0.6 ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-300';
              const txtColor = val >= target ? 'text-emerald-700' : val >= target * 0.6 ? 'text-amber-700' : 'text-red-700';
              return (
                <div key={i} className={`rounded-xl border p-2.5 text-center ${bg}`}>
                  <div className="text-[10px] text-slate-500 font-medium">{t.month?.slice(5)}月</div>
                  <div className={`text-xl font-black tabular-nums ${txtColor}`}>{val}%</div>
                  <div className="text-[10px] text-slate-500 tabular-nums">{isSup ? `${t.sup60}/${t.supCnt}家` : `${fmtWan(t.amt60)}/${fmtWan(t.totalAmt)}`}</div>
                  <div className={`text-[10px] ${dirColor} font-bold`}>{dir}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 一句话结论 */}
        <div className="rounded-2xl p-5" style={{ backgroundColor: yearRateNum >= target ? '#ecfdf5' : '#fef2f2', border: `1px solid ${yearRateNum >= target ? '#a7f3d0' : '#fecaca'}` }}>
          <div className="text-sm font-bold text-slate-800 mb-2">📌 核心结论</div>
          <ul className="space-y-2">
            {insights.map((text, i) => (
              <li key={i} className="text-sm text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: text }} />
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // ─── 第二层：汇总卡 + 付款条件分布表 ───
  return (
    <div className="space-y-4">
      {info && (
        <div className="px-4 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-blue-700">
            <Info className="w-3.5 h-3.5" /> 自动取数说明
          </div>
          <p className="text-slate-700"><span className="text-slate-400">数据来源：</span>{info.src}</p>
          <p className="text-slate-700"><span className="text-slate-400">取数规则：</span>{info.how}</p>
          <p className="text-slate-700"><span className="text-slate-400">更新：</span>{info.when}</p>
        </div>
      )}
      {(bill.changesWeek || bill.changesTrend) && (
        <div className={`rounded-xl border p-4 ${(bill.changesWeek?.length || 0) > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs font-bold text-slate-700">
              🔄 {bill.changePeriod || '本期'}变更至60天以上
            </span>
            <span className={`text-sm font-black tabular-nums ${(bill.changesWeek?.length || 0) > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
              {(bill.changesWeek?.length || 0)} 家
            </span>
            <span className="text-[10px] text-slate-400">（来源：OA 供应商变更申请单，已批准/归档）</span>
          </div>
          {bill.changesWeek && bill.changesWeek.length > 0 ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-200">
                  <th className="text-left font-medium py-1.5 px-2">单号</th>
                  <th className="text-left font-medium py-1.5 px-2 w-24">日期</th>
                  <th className="text-left font-medium py-1.5 px-2">供应商</th>
                  <th className="text-left font-medium py-1.5 px-2 w-40">付款条件变更</th>
                </tr>
              </thead>
              <tbody>
                {bill.changesWeek.map((x, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 px-2 text-slate-500 tabular-nums">{x.djbh || '—'}</td>
                    <td className="py-1.5 px-2 text-slate-500 tabular-nums">{x.date}</td>
                    <td className="py-1.5 px-2 text-slate-700">{x.gysmc}</td>
                    <td className="py-1.5 px-2 text-slate-600">{x.from || '—'} <span className="text-emerald-600 font-semibold">→ {x.to}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-slate-400">本期无变更至60天以上的申请</div>
          )}
          {bill.changesTrend && bill.changesTrend.length > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-200">
              <div className="text-[10px] text-slate-400 mb-1">逐月变更家数</div>
              <div className="flex flex-wrap gap-1.5">
                {bill.changesTrend.map((t, i) => (
                  <span key={i} className={`text-[11px] px-2 py-0.5 rounded-full tabular-nums ${t.current ? 'bg-amber-100 text-amber-700 font-semibold' : 'bg-white text-slate-500 border border-slate-200'}`}>
                    {t.ym.slice(2)} {t.cnt}家{t.current ? ' ◀' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setDrillMetric('sup')}
          className={`text-left rounded-xl p-4 border transition-all hover:shadow-md hover:scale-[1.01] ${Number(s.supRate) >= 65 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="text-[10px] text-slate-500 flex items-center justify-between">
            <span>👥 60天以上 · 家数占比</span>
            <span className="text-blue-500 font-medium">月度明细 ›</span>
          </div>
          <div className={`text-4xl font-black tabular-nums mt-1 ${Number(s.supRate) >= 65 ? 'text-emerald-600' : 'text-red-600'}`}>{s.supRate}%</div>
          <div className="text-[10px] text-slate-400 mt-1">{s.total60Sup}/{s.totalSup} 家 · 目标65%</div>
          <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden relative">
            <div className={`h-full rounded-full ${Number(s.supRate) >= 65 ? 'bg-emerald-500' : 'bg-red-400'}`} style={{ width: `${Math.min(Number(s.supRate), 100)}%` }} />
            <div className="absolute top-0 bottom-0 w-0.5 bg-slate-600" style={{ left: '65%' }} />
          </div>
        </button>
        <button onClick={() => setDrillMetric('amt')}
          className={`text-left rounded-xl p-4 border transition-all hover:shadow-md hover:scale-[1.01] ${Number(s.amtRate) >= 75 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="text-[10px] text-slate-500 flex items-center justify-between">
            <span>💰 60天以上 · 金额占比</span>
            <span className="text-blue-500 font-medium">月度明细 ›</span>
          </div>
          <div className={`text-4xl font-black tabular-nums mt-1 ${Number(s.amtRate) >= 75 ? 'text-emerald-600' : 'text-amber-600'}`}>{s.amtRate}%</div>
          <div className="text-[10px] text-slate-400 mt-1">{fmtWan(s.total60Amt)}/{fmtWan(s.totalAmt)} · 目标75%</div>
          <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden relative">
            <div className={`h-full rounded-full ${Number(s.amtRate) >= 75 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(Number(s.amtRate), 100)}%` }} />
            <div className="absolute top-0 bottom-0 w-0.5 bg-slate-600" style={{ left: '75%' }} />
          </div>
        </button>
      </div>

      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">📋 付款条件分布（点击行展开供应商明细）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
              <th className="text-left font-medium py-2 px-3">付款条件</th>
              <th className="text-right font-medium py-2 px-3 w-14">家数</th>
              <th className="text-right font-medium py-2 px-3 w-14">占比</th>
              <th className="text-right font-medium py-2 px-3 w-20">金额</th>
              <th className="text-right font-medium py-2 px-3 w-16">金额占比</th>
              <th className="text-center font-medium py-2 px-3 w-14">60天+</th>
              <th className="text-center font-medium py-2 px-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((ln: any, i: number) => {
              const term = String(ln.termName || '');
              const isExpanded = expandedTerm === term;
              const hasSuppliers = (suppliers[term] || []).length > 0;
              const pct = s.totalSup > 0 ? ((ln.supCnt / s.totalSup) * 100).toFixed(1) : '0';
              const amtPct = s.totalAmt > 0 ? ((ln.amt / s.totalAmt) * 100).toFixed(1) : '0';
              return (
                <React.Fragment key={i}>
                  <tr className={`border-b border-slate-50 ${hasSuppliers ? 'cursor-pointer hover:bg-blue-50/30' : ''}`}
                    onClick={() => hasSuppliers && setExpandedTerm(isExpanded ? null : term)}>
                    <td className="py-2 px-3 text-slate-700 font-medium">{term}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.supCnt}家</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-500">{pct}%</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-600">{fmtWan(ln.amt)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-500">{amtPct}%</td>
                    <td className="py-2 px-3 text-center">{ln.days60 ? <span className="text-emerald-500 font-bold">✓</span> : <span className="text-slate-300">✗</span>}</td>
                    <td className="py-2 px-3 text-center text-slate-300">{hasSuppliers ? (isExpanded ? '▲' : '▼') : ''}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={7} className="bg-slate-50/50 px-4 py-2">
                        <div className="text-[10px] text-slate-400 mb-1.5">{term} · 供应商明细（Top {(suppliers[term] || []).length}家）</div>
                        <table className="w-full text-[11px]">
                          <thead><tr className="text-slate-400 border-b border-slate-200">
                            <th className="text-left font-medium py-1.5 px-2">编码</th>
                            <th className="text-left font-medium py-1.5 px-2">供应商名称</th>
                            <th className="text-right font-medium py-1.5 px-2 w-24">金额</th>
                          </tr></thead>
                          <tbody>
                            {(suppliers[term] || []).map((sup: any, j: number) => (
                              <tr key={j} className="border-b border-slate-100">
                                <td className="py-1.5 px-2 text-slate-500 font-mono">{sup.number}</td>
                                <td className="py-1.5 px-2 text-slate-700">{sup.name}</td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{fmtWan(sup.amt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 账随物动：逐月趋势 + 未命中/无领料明细（kind='ledger-move'）
function LedgerMoveDetail({ bill, info }: { bill: AutoDetailBill & { lines?: any[]; missRows?: any[]; noLlRows?: any[] }; info?: { name: string; src: string; how: string; when: string } | null }) {
  const lines = (bill.lines || []) as any[];
  const missRows = (bill.missRows || []) as any[];
  const noLlRows = (bill.noLlRows || []) as any[];
  return (
    <div className="space-y-4">
      {info && (
        <div className="px-4 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-blue-700">
            <Info className="w-3.5 h-3.5" /> 自动取数说明
          </div>
          <p className="text-slate-700"><span className="text-slate-400">数据来源：</span>{info.src}</p>
          <p className="text-slate-700"><span className="text-slate-400">取数规则：</span>{info.how}</p>
          <p className="text-slate-700"><span className="text-slate-400">更新：</span>{info.when}</p>
        </div>
      )}
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">逐月账随物动（命中率 = 开工±3天内有领料 / 有领料任务单）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
              <th className="text-left font-medium py-2 px-3">月份</th>
              <th className="text-right font-medium py-2 px-3 w-28">有领料任务单</th>
              <th className="text-right font-medium py-2 px-3 w-28">±3天有领料</th>
              <th className="text-right font-medium py-2 px-3 w-20">命中率</th>
              <th className="text-left font-medium py-2 px-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, i) => (
              <tr key={i} className={ln.current ? 'bg-amber-50 font-semibold' : 'border-b border-slate-50'}>
                <td className={`py-2 px-3 tabular-nums ${ln.current ? 'text-amber-700' : 'text-slate-700'}`}>{ln.ym}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.n}</td>
                <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{ln.hit}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-700">{ln.pct}%</td>
                <td className="py-2 px-3 text-amber-600">{ln.current || ''}</td>
              </tr>
            ))}
            {lines.length === 0 && (<tr><td colSpan={5} className="text-center py-4 text-slate-300">暂无数据</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">本期有领料、但开工±3天内无领料 Top {missRows.length}</div>
        <div className="max-h-[40vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 sticky top-0">
                <th className="text-left font-medium py-2 px-3">任务单</th>
                <th className="text-left font-medium py-2 px-3 w-24">开工日期</th>
                <th className="text-left font-medium py-2 px-3 w-24">首次领料</th>
                <th className="text-left font-medium py-2 px-3 w-24">末次领料</th>
              </tr>
            </thead>
            <tbody>
              {missRows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{r.no}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{r.start}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{r.first}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{r.last}</td>
                </tr>
              ))}
              {missRows.length === 0 && (<tr><td colSpan={4} className="text-center py-3 text-slate-300">本期无未命中</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">本期开工日但全程无领料 Top {noLlRows.length}</div>
        <div className="max-h-[40vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 sticky top-0">
                <th className="text-left font-medium py-2 px-3">任务单</th>
                <th className="text-left font-medium py-2 px-3 w-24">开工日期</th>
              </tr>
            </thead>
            <tbody>
              {noLlRows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{r.no}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{r.start}</td>
                </tr>
              ))}
              {noLlRows.length === 0 && (<tr><td colSpan={2} className="text-center py-3 text-slate-300">本期全部有领料</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 委外按单领料：逐月趋势表 + 本期高亮（kind='subcontract-issue'）
function SubcontractDetail({ bill, info }: { bill: AutoDetailBill & { lines?: any[] }; info?: { name: string; src: string; how: string; when: string } | null }) {
  const lines = (bill.lines || []) as any[];
  return (
    <div className="space-y-4">
      {info && (
        <div className="px-4 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-blue-700">
            <Info className="w-3.5 h-3.5" /> 自动取数说明
          </div>
          <p className="text-slate-700"><span className="text-slate-400">数据来源：</span>{info.src}</p>
          <p className="text-slate-700"><span className="text-slate-400">取数规则：</span>{info.how}</p>
          <p className="text-slate-700"><span className="text-slate-400">更新：</span>{info.when}</p>
        </div>
      )}
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">逐月委外按单领料（下推率 = 有领料 / 委外订单数）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
              <th className="text-left font-medium py-2 px-3">月份</th>
              <th className="text-right font-medium py-2 px-3 w-20">订单数</th>
              <th className="text-right font-medium py-2 px-3 w-20">有领料</th>
              <th className="text-right font-medium py-2 px-3 w-20">无领料</th>
              <th className="text-right font-medium py-2 px-3 w-20">下推率</th>
              <th className="text-left font-medium py-2 px-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, i) => (
              <tr key={i} className={ln.current ? 'bg-amber-50 font-semibold' : 'border-b border-slate-50'}>
                <td className={`py-2 px-3 tabular-nums ${ln.current ? 'text-amber-700' : 'text-slate-700'}`}>{ln.ym}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.total}</td>
                <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{ln.hasll}</td>
                <td className="py-2 px-3 text-right tabular-nums text-red-500">{ln.noll}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-700">{ln.pct}%</td>
                <td className="py-2 px-3 text-amber-600">{ln.current || ''}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={6} className="text-center py-4 text-slate-300">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 采购来料匹配：原因分布 + 逐月趋势(本期高亮) + 未匹配明细（kind='po-match'）
function PoMatchDetail({ bill, info }: { bill: AutoDetailBill & { lines?: any[]; reasons?: any[]; rows?: any[] }; info?: { name: string; src: string; how: string; when: string } | null }) {
  const trend = (bill.lines || []) as any[];
  const reasons = (bill.reasons || []) as any[];
  const rows = (bill.rows || []) as any[];
  return (
    <div className="space-y-4">
      {info && (
        <div className="px-4 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-blue-700">
            <Info className="w-3.5 h-3.5" /> 自动取数说明
          </div>
          <p className="text-slate-700"><span className="text-slate-400">数据来源：</span>{info.src}</p>
          <p className="text-slate-700"><span className="text-slate-400">取数规则：</span>{info.how}</p>
          <p className="text-slate-700"><span className="text-slate-400">更新：</span>{info.when}</p>
        </div>
      )}
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">未匹配原因分布（本期）</div>
        <table className="w-full text-xs">
          <tbody>
            {reasons.map((x, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-2 px-3 text-slate-700">{x.reason}</td>
                <td className="py-2 px-3 text-right tabular-nums text-red-500 w-24">{x.cnt} 条</td>
              </tr>
            ))}
            {reasons.length === 0 && (<tr><td colSpan={2} className="text-center py-3 text-slate-300">本期无未匹配</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">逐月（外购入库 / 未匹配 / 未匹配率）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
              <th className="text-left font-medium py-2 px-3">月份</th>
              <th className="text-right font-medium py-2 px-3 w-24">外购入库</th>
              <th className="text-right font-medium py-2 px-3 w-20">未匹配</th>
              <th className="text-right font-medium py-2 px-3 w-24">未匹配率</th>
              <th className="text-left font-medium py-2 px-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {trend.map((ln, i) => (
              <tr key={i} className={ln.current ? 'bg-amber-50 font-semibold' : 'border-b border-slate-50'}>
                <td className={`py-2 px-3 tabular-nums ${ln.current ? 'text-amber-700' : 'text-slate-700'}`}>{ln.ym}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.total}</td>
                <td className="py-2 px-3 text-right tabular-nums text-red-500">{ln.unmatched}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-700">{ln.pct}%</td>
                <td className="py-2 px-3 text-amber-600">{ln.current || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">未匹配明细（本期 Top {rows.length}）</div>
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 sticky top-0">
                <th className="text-left font-medium py-2 px-3">入库单号</th>
                <th className="text-left font-medium py-2 px-3 w-24">入库日期</th>
                <th className="text-left font-medium py-2 px-3">物料代码</th>
                <th className="text-left font-medium py-2 px-3">物料名称</th>
                <th className="text-right font-medium py-2 px-3 w-20">数量</th>
                <th className="text-left font-medium py-2 px-3 w-32">原因</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ln, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{ln.wgNo}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{ln.date}</td>
                  <td className="py-1.5 px-3 text-slate-700">{ln.itemNo}</td>
                  <td className="py-1.5 px-3 text-slate-500 truncate max-w-[220px]" title={ln.itemName}>{ln.itemName}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">{ln.qty == null ? '' : Number(ln.qty)}</td>
                  <td className="py-1.5 px-3 text-red-500">{ln.reason}</td>
                </tr>
              ))}
              {rows.length === 0 && (<tr><td colSpan={6} className="text-center py-3 text-slate-300">本期无未匹配明细</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 生产退料：逐月趋势表 + 本期物料明细（kind='material-return'）
function MaterialReturnDetail({ bill, info }: { bill: AutoDetailBill & { lines?: any[]; rows?: any[] }; info?: { name: string; src: string; how: string; when: string } | null }) {
  const trend = (bill.lines || []) as any[];
  const rows = (bill.rows || []) as any[];
  const fmtAmt = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
  return (
    <div className="space-y-4">
      {info && (
        <div className="px-4 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-blue-700">
            <Info className="w-3.5 h-3.5" /> 自动取数说明
          </div>
          <p className="text-slate-700"><span className="text-slate-400">数据来源：</span>{info.src}</p>
          <p className="text-slate-700"><span className="text-slate-400">取数规则：</span>{info.how}</p>
          <p className="text-slate-700"><span className="text-slate-400">更新：</span>{info.when}</p>
        </div>
      )}
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">逐月退料（单数 / 条数 / 数量 / 金额）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
              <th className="text-left font-medium py-2 px-3">月份</th>
              <th className="text-right font-medium py-2 px-3 w-20">退料单数</th>
              <th className="text-right font-medium py-2 px-3 w-20">退料条数</th>
              <th className="text-right font-medium py-2 px-3 w-24">退料数量</th>
              <th className="text-right font-medium py-2 px-3 w-28">退料金额</th>
              <th className="text-left font-medium py-2 px-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {trend.map((ln, i) => (
              <tr key={i} className={ln.current ? 'bg-amber-50 font-semibold' : 'border-b border-slate-50'}>
                <td className={`py-2 px-3 tabular-nums ${ln.current ? 'text-amber-700' : 'text-slate-700'}`}>{ln.ym}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.bills}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.lines}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.qty}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-700">{fmtAmt(ln.amt)}</td>
                <td className="py-2 px-3 text-amber-600">{ln.current || ''}</td>
              </tr>
            ))}
            {trend.length === 0 && (
              <tr><td colSpan={6} className="text-center py-4 text-slate-300">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">本期退料明细 Top {rows.length}</div>
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 sticky top-0">
                <th className="text-left font-medium py-2 px-3">退料单号</th>
                <th className="text-left font-medium py-2 px-3 w-24">日期</th>
                <th className="text-left font-medium py-2 px-3 w-16">车间</th>
                <th className="text-left font-medium py-2 px-3">物料代码</th>
                <th className="text-left font-medium py-2 px-3">物料名称</th>
                <th className="text-right font-medium py-2 px-3 w-20">数量</th>
                <th className="text-right font-medium py-2 px-3 w-20">单价</th>
                <th className="text-right font-medium py-2 px-3 w-24">金额</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ln, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{ln.no}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{ln.date}</td>
                  <td className="py-1.5 px-3 text-slate-500">{ln.ws}</td>
                  <td className="py-1.5 px-3 text-slate-700">{ln.itemNo}</td>
                  <td className="py-1.5 px-3 text-slate-500 truncate max-w-[220px]" title={ln.itemName}>{ln.itemName}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">{ln.qty == null ? '' : Number(ln.qty)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">{fmtAmt(ln.price)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{fmtAmt(ln.amt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (<tr><td colSpan={8} className="text-center py-3 text-slate-300">本期无退料明细</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 物料来料3天入库：逐月达标率趋势 + 超3天未及时入库明细（kind='material-inbound'）
function MaterialInboundDetail({ bill, info }: { bill: AutoDetailBill & { lines?: any[]; rows?: any[] }; info?: { name: string; src: string; how: string; when: string } | null }) {
  const trend = (bill.lines || []) as any[];
  const rows = (bill.rows || []) as any[];
  const fmtAvg = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? '—' : Number(v).toFixed(1));
  return (
    <div className="space-y-4">
      {info && (
        <div className="px-4 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-blue-700">
            <Info className="w-3.5 h-3.5" /> 自动取数说明
          </div>
          <p className="text-slate-700"><span className="text-slate-400">数据来源：</span>{info.src}</p>
          <p className="text-slate-700"><span className="text-slate-400">取数规则：</span>{info.how}</p>
          <p className="text-slate-700"><span className="text-slate-400">更新：</span>{info.when}</p>
        </div>
      )}
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">逐月来料3天入库（达标率 = 3天内入库 / 收料通知数）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
              <th className="text-left font-medium py-2 px-3">月份</th>
              <th className="text-right font-medium py-2 px-3 w-24">收料通知</th>
              <th className="text-right font-medium py-2 px-3 w-24">3天内入库</th>
              <th className="text-right font-medium py-2 px-3 w-20">达标率</th>
              <th className="text-right font-medium py-2 px-3 w-24">平均天数</th>
              <th className="text-left font-medium py-2 px-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {trend.map((ln, i) => (
              <tr key={i} className={ln.current ? 'bg-amber-50 font-semibold' : 'border-b border-slate-50'}>
                <td className={`py-2 px-3 tabular-nums ${ln.current ? 'text-amber-700' : 'text-slate-700'}`}>{ln.ym}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.total}</td>
                <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{ln.within3}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-700">{ln.pct}%</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{fmtAvg(ln.avg)}</td>
                <td className="py-2 px-3 text-amber-600">{ln.current || ''}</td>
              </tr>
            ))}
            {trend.length === 0 && (
              <tr><td colSpan={6} className="text-center py-4 text-slate-300">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">超3天未及时入库明细 Top {rows.length}</div>
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 sticky top-0">
                <th className="text-left font-medium py-2 px-3">收料通知</th>
                <th className="text-left font-medium py-2 px-3 w-24">收料日期</th>
                <th className="text-left font-medium py-2 px-3">入库单</th>
                <th className="text-left font-medium py-2 px-3 w-24">入库日期</th>
                <th className="text-right font-medium py-2 px-3 w-20">间隔天数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ln, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{ln.ddNo}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{ln.ddDate}</td>
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{ln.wgNo}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{ln.wgDate}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-red-500 font-semibold">{ln.dy}</td>
                </tr>
              ))}
              {rows.length === 0 && (<tr><td colSpan={5} className="text-center py-3 text-slate-300">本期全部在3天内入库</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 研发其他领料：逐月趋势 + 部门汇总 + 本期物料明细（kind='rd-issue'）
function RdIssueDetail({ bill, info }: { bill: AutoDetailBill & { lines?: any[]; deptLines?: any[]; rows?: any[] }; info?: { name: string; src: string; how: string; when: string } | null }) {
  const trend = (bill.lines || []) as any[];
  const depts = (bill.deptLines || []) as any[];
  const rows = (bill.rows || []) as any[];
  const fmtAmt = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));
  return (
    <div className="space-y-4">
      {info && (
        <div className="px-4 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-blue-700">
            <Info className="w-3.5 h-3.5" /> 自动取数说明
          </div>
          <p className="text-slate-700"><span className="text-slate-400">数据来源：</span>{info.src}</p>
          <p className="text-slate-700"><span className="text-slate-400">取数规则：</span>{info.how}</p>
          <p className="text-slate-700"><span className="text-slate-400">更新：</span>{info.when}</p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-100 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">逐月（单数 / 条数 / 金额）</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
                <th className="text-left font-medium py-2 px-3">月份</th>
                <th className="text-right font-medium py-2 px-3 w-16">单数</th>
                <th className="text-right font-medium py-2 px-3 w-16">条数</th>
                <th className="text-right font-medium py-2 px-3 w-24">金额</th>
                <th className="text-left font-medium py-2 px-3 w-14"></th>
              </tr>
            </thead>
            <tbody>
              {trend.map((ln, i) => (
                <tr key={i} className={ln.current ? 'bg-amber-50 font-semibold' : 'border-b border-slate-50'}>
                  <td className={`py-2 px-3 tabular-nums ${ln.current ? 'text-amber-700' : 'text-slate-700'}`}>{ln.ym}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.bills}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.lines}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-700">{fmtAmt(ln.amt)}</td>
                  <td className="py-2 px-3 text-amber-600">{ln.current || ''}</td>
                </tr>
              ))}
              {trend.length === 0 && (<tr><td colSpan={5} className="text-center py-4 text-slate-300">暂无数据</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-slate-100 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">本期按部门汇总</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
                <th className="text-left font-medium py-2 px-3">部门</th>
                <th className="text-right font-medium py-2 px-3 w-16">条数</th>
                <th className="text-right font-medium py-2 px-3 w-24">金额</th>
              </tr>
            </thead>
            <tbody>
              {depts.map((d, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-2 px-3 text-slate-700">{d.dept}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-600">{d.lines}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-700">{fmtAmt(d.amt)}</td>
                </tr>
              ))}
              {depts.length === 0 && (<tr><td colSpan={3} className="text-center py-3 text-slate-300">本期无出库</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">本期明细 Top {rows.length}</div>
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 sticky top-0">
                <th className="text-left font-medium py-2 px-3">单据编号</th>
                <th className="text-left font-medium py-2 px-3 w-24">日期</th>
                <th className="text-left font-medium py-2 px-3 w-28">部门</th>
                <th className="text-left font-medium py-2 px-3">物料代码</th>
                <th className="text-left font-medium py-2 px-3">物料名称</th>
                <th className="text-right font-medium py-2 px-3 w-20">数量</th>
                <th className="text-right font-medium py-2 px-3 w-20">单价</th>
                <th className="text-right font-medium py-2 px-3 w-24">金额</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ln, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{ln.no}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{ln.date}</td>
                  <td className="py-1.5 px-3 text-slate-500">{ln.dept}</td>
                  <td className="py-1.5 px-3 text-slate-700">{ln.itemNo}</td>
                  <td className="py-1.5 px-3 text-slate-500 truncate max-w-[200px]" title={ln.itemName}>{ln.itemName}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">{ln.qty == null ? '' : Number(ln.qty)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">{fmtAmt(ln.price)}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-700">{fmtAmt(ln.amt)}</td>
                </tr>
              ))}
              {rows.length === 0 && (<tr><td colSpan={8} className="text-center py-3 text-slate-300">本期无出库明细</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// 成品送检2天入库：逐月趋势 + 超2天未及时入库明细（kind='inspect-inbound'）
function InspectInboundDetail({ bill, info }: { bill: AutoDetailBill & { lines?: any[]; rows?: any[] }; info?: { name: string; src: string; how: string; when: string } | null }) {
  const trend = (bill.lines || []) as any[];
  const rows = (bill.rows || []) as any[];
  const fmtAvg = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? '—' : Number(v).toFixed(1));
  return (
    <div className="space-y-4">
      {info && (
        <div className="px-4 py-2.5 bg-blue-50/60 border border-blue-100 rounded-xl space-y-1 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold text-blue-700">
            <Info className="w-3.5 h-3.5" /> 自动取数说明
          </div>
          <p className="text-slate-700"><span className="text-slate-400">数据来源：</span>{info.src}</p>
          <p className="text-slate-700"><span className="text-slate-400">取数规则：</span>{info.how}</p>
          <p className="text-slate-700"><span className="text-slate-400">更新：</span>{info.when}</p>
        </div>
      )}
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">逐月成品送检2天入库（占比 = 2天内入库 / 合格汇报单）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-slate-400">
              <th className="text-left font-medium py-2 px-3">月份</th>
              <th className="text-right font-medium py-2 px-3 w-24">汇报单</th>
              <th className="text-right font-medium py-2 px-3 w-24">2天内入库</th>
              <th className="text-right font-medium py-2 px-3 w-20">占比</th>
              <th className="text-right font-medium py-2 px-3 w-24">平均天数</th>
              <th className="text-left font-medium py-2 px-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {trend.map((ln, i) => (
              <tr key={i} className={ln.current ? 'bg-amber-50 font-semibold' : 'border-b border-slate-50'}>
                <td className={`py-2 px-3 tabular-nums ${ln.current ? 'text-amber-700' : 'text-slate-700'}`}>{ln.ym}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{ln.total}</td>
                <td className="py-2 px-3 text-right tabular-nums text-emerald-600">{ln.within2}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-700">{ln.pct}%</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-600">{fmtAvg(ln.avg)}</td>
                <td className="py-2 px-3 text-amber-600">{ln.current || ''}</td>
              </tr>
            ))}
            {trend.length === 0 && (<tr><td colSpan={6} className="text-center py-4 text-slate-300">暂无数据</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 text-xs font-bold text-slate-600 border-b border-slate-100">超2天未及时入库明细 Top {rows.length}</div>
        <div className="max-h-[45vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 sticky top-0">
                <th className="text-left font-medium py-2 px-3">汇报单</th>
                <th className="text-left font-medium py-2 px-3 w-24">汇报日期</th>
                <th className="text-left font-medium py-2 px-3">入库单</th>
                <th className="text-left font-medium py-2 px-3 w-24">入库日期</th>
                <th className="text-right font-medium py-2 px-3 w-20">间隔天数</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ln, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{ln.rptNo}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{ln.rptDate}</td>
                  <td className="py-1.5 px-3 text-slate-600 tabular-nums">{ln.cpNo}</td>
                  <td className="py-1.5 px-3 text-slate-500 tabular-nums">{ln.cpDate}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-red-500 font-semibold">{ln.dy}</td>
                </tr>
              ))}
              {rows.length === 0 && (<tr><td colSpan={5} className="text-center py-3 text-slate-300">本期全部在2天内入库</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function cellValue(def: ColDef, ln: Record<string, unknown>): string {
  const v = ln[def.key];
  if (v == null || v === '') return '—';
  if (def.align === 'money') return fmtMoney(v);
  if (def.align === 'num') return fmtNum(v);
  return String(v);
}

export default function ContinuousDetailDialog({ item, onClose }: { item: AutoDetailRecord | null; onClose: () => void }) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;
  const bills = (Array.isArray(item.detail) ? item.detail : []) as AutoDetailBill[];
  const kind = bills[0]?.kind || 'scrap';
  const totalLines = bills.reduce((s, b) => s + (b.lines?.length || 0), 0);
  const info = autoFetchSourceInfo(item.sourceKey);

  const baseCols = kind === 'custom'
    ? (((bills[0] as any)?.cols as ColDef[] | null)
        || (bills[0]?.lines?.[0]
          ? Object.keys(bills[0].lines[0]).map(k => ({
              key: k, label: k,
              align: typeof (bills[0].lines[0] as any)[k] === 'number' ? ('num' as const) : ('text' as const),
            }))
          : COLS.scrap))
    : (COLS[kind] || COLS.scrap);
  const hasPrice = kind === 'price' && bills.some(b => (b.lines || []).some((ln: any) => ln.priceOld != null || ln.priceNew != null || ln.final != null));
  const priceCols = hasPrice ? [
    { key: 'priceOld', label: '原价', align: 'money' as const },
    { key: 'priceNew', label: '新价', align: 'money' as const },
    { key: 'final', label: '终价', align: 'money' as const },
  ] : [];
  const cols = kind === 'price' ? [...baseCols, ...priceCols] : baseCols;

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className={kind === 'payment-terms' || kind === 'ledger-move' || kind === 'subcontract-issue' || kind === 'po-match' || kind === 'material-return' || kind === 'material-inbound' || kind === 'rd-issue' || kind === 'inspect-inbound'
          ? 'bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden'
          : 'bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden'}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1 text-xs font-semibold">
              <FileText className="w-3.5 h-3.5" /> 自动取数
            </span>
            <h3 className="text-lg font-bold text-slate-800">{item.progress}</h3>
            <span className="text-xs text-slate-400">{kind === 'ledger-move' || kind === 'subcontract-issue' ? `${(bills[0] as any)?.lines?.length || 0} 个月` : kind === 'po-match' ? `${(bills[0] as any)?.rows?.length || 0} 条未匹配明细` : kind === 'material-return' ? `${(bills[0] as any)?.rows?.length || 0} 条退料明细` : kind === 'material-inbound' ? `${(bills[0] as any)?.rows?.length || 0} 条超期明细` : kind === 'rd-issue' ? `${(bills[0] as any)?.rows?.length || 0} 条出库明细` : kind === 'inspect-inbound' ? `${(bills[0] as any)?.rows?.length || 0} 条超期明细` : `${bills.length} 张单 / ${totalLines} 条明细`}</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {kind === 'payment-terms' ? (
          <PaymentTermsDetail bill={bills[0] as any} info={info} />
        ) : kind === 'ledger-move' ? (
          <LedgerMoveDetail bill={bills[0] as any} info={info} />
        ) : kind === 'subcontract-issue' ? (
          <SubcontractDetail bill={bills[0] as any} info={info} />
        ) : kind === 'po-match' ? (
          <PoMatchDetail bill={bills[0] as any} info={info} />
        ) : kind === 'material-return' ? (
          <MaterialReturnDetail bill={bills[0] as any} info={info} />
        ) : kind === 'material-inbound' ? (
          <MaterialInboundDetail bill={bills[0] as any} info={info} />
        ) : kind === 'rd-issue' ? (
          <RdIssueDetail bill={bills[0] as any} info={info} />
        ) : kind === 'inspect-inbound' ? (
          <InspectInboundDetail bill={bills[0] as any} info={info} />
        ) : bills.length === 0 ? (
            <div className="text-sm text-slate-300 text-center py-10">本期无明细</div>
          ) : bills.map((b, bi) => (
            <div key={b.bill + bi} className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-700 tabular-nums">{b.bill}</span>
                {b.date && <span className="text-xs text-slate-500 tabular-nums">{b.date}</span>}
                {b.status && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">{b.status}</span>
                )}
                {kind === 'price' && b.supplier && <span className="text-xs text-slate-600">供应商：{b.supplier}</span>}
                {b.use && <span className="text-xs text-slate-400 truncate max-w-[46%]" title={b.use}>{b.use}</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100 bg-white">
                      <th className="text-center font-medium py-2 px-3 w-10">No.</th>
                      {cols.map(c => (
                        <th key={c.key} className={`font-medium py-2 px-3 ${c.align === 'text' ? 'text-left min-w-[96px]' : 'text-right w-24'}`}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(b.lines || []).map((ln, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="text-center py-2 px-3 text-slate-300 tabular-nums">{i + 1}</td>
                        {cols.map(c => (
                          <td key={c.key} className={`py-2 px-3 ${c.align === 'text' ? 'text-left text-slate-700' : 'text-right tabular-nums text-slate-700'}`}>
                            {cellValue(c, ln)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {(b.lines || []).length === 0 && (
                      <tr><td colSpan={cols.length + 1} className="text-center py-3 text-slate-300">（该单无明细行）</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 h-9 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
