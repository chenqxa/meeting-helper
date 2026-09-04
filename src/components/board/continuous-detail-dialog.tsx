'use client';

// 会议看板「持续项·自动取数」明细弹窗：点击"本周 N 单"后展示明细
// 列定义按来源 detail[0].kind 切换：
//   scrap   呆滞出库        物料代码/名称/数量/单位
//   price   采购价格维护    物料代码/名称/规格/单位 + 原价/新价/终价（表头带供应商）
//   work    工价维护        整机代码/名称 + 工序/工时/件工数/工价/人数/备注
//   supplier 新供应商评审    申请日期/供应商名称/联系人/评审产品/类别/质量分/结论
import React, { useEffect } from 'react';
import { X, FileText, Info } from 'lucide-react';
import { autoFetchSourceDesc } from '@/lib/auto-fetch-sources-meta';

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
  sourceKey?: string | null; // 取数源 key，用于显示口径说明
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
};

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
  const desc = autoFetchSourceDesc(item.sourceKey);

  const baseCols = COLS[kind] || COLS.scrap;
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
        className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1 text-xs font-semibold">
              <FileText className="w-3.5 h-3.5" /> 自动取数
            </span>
            <h3 className="text-lg font-bold text-slate-800">{item.progress}</h3>
            <span className="text-xs text-slate-400">{bills.length} 张单 / {totalLines} 条明细</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {desc && (
          <div className="px-6 py-2.5 bg-blue-50/70 border-b border-blue-100 text-xs text-slate-600 leading-relaxed flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
            <span><span className="font-semibold text-blue-700">自动取数口径：</span>{desc}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {bills.length === 0 ? (
            <div className="text-sm text-slate-300 text-center py-10">本周无明细</div>
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
