'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { RefreshCw, Database, Clock, AlertTriangle, CheckCircle2, History, Settings2, Mail } from 'lucide-react';

// ISO(UTC) → 本地时间显示（YYYY-MM-DD HH:mm）
function fmtLocal(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OaSyncPage() {
  // OA 回拉配置
  const [oaPull, setOaPull] = useState<{
    enabled: boolean; cronExpr: string; intervalMin: number;
    incremental: boolean; maxRetries: number; retryBaseMin: number;
    alertAfterFails: number; alertRecipients: string;
    lastRunAt: string | null; lastRunStatus: string | null; lastRunDetail: string | null;
    nextRunAt: string | null; consecutiveFails: number; lastCursorAt: string | null;
  } | null>(null);
  const [oaPullRuns, setOaPullRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/settings/oa-pull').then(r => r.json());
      if (r.success) { setOaPull(r.data.config); setOaPullRuns(r.data.runs || []); }
    } catch { /* silent */ }
    setLoading(false);
  };

  const saveOaPull = async () => {
    if (!oaPull) return;
    setSaving(true);
    try {
      const r = await fetch('/api/settings/oa-pull', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: oaPull.enabled, cronExpr: oaPull.cronExpr, intervalMin: oaPull.intervalMin,
          incremental: oaPull.incremental, maxRetries: oaPull.maxRetries, retryBaseMin: oaPull.retryBaseMin,
          alertAfterFails: oaPull.alertAfterFails, alertRecipients: oaPull.alertRecipients,
        }),
      }).then(r => r.json());
      if (r.success) {
        setOaPull(r.data);
        setMsg('已保存，调度即时生效');
      } else {
        setMsg(r.error || '保存失败');
      }
    } catch {
      setMsg('保存失败');
    } finally { setSaving(false); }
  };

  const runOaPullNow = async () => {
    setRunning(true);
    setMsg('');
    try {
      const r = await fetch('/api/settings/oa-pull', { method: 'POST' }).then(r => r.json());
      if (r.success) {
        setMsg(r.data?.message || '同步完成');
        await loadAll();
      } else {
        setMsg(r.error || '触发失败');
      }
    } catch {
      setMsg('触发失败');
    } finally { setRunning(false); }
  };

  const lastResultLabel = oaPull?.lastRunStatus === 'success' ? '成功'
    : oaPull?.lastRunStatus === 'failed' ? '失败'
    : oaPull?.lastRunStatus === 'running' ? '运行中' : '—';

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-5">
        {/* 标题栏 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">OA 同步</h2>
            <p className="text-sm text-slate-500 mt-1">定时把 OA 里填写的完成结果 / 持续项填报拉回本系统</p>
          </div>
          <button
            onClick={runOaPullNow}
            disabled={running}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
            {running ? '同步中…' : '立即回拉'}
          </button>
        </div>

        {/* ── 运行状态概览 ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center">
              <Database className="w-4.5 h-4.5 text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">运行状态</p>
              <p className="text-xs text-slate-400">最近一次同步的情况</p>
            </div>
          </div>
          <div className="px-6 py-5">
            {loading ? (
              <div className="py-8 text-center text-sm text-slate-300">加载中…</div>
            ) : oaPull ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatusCard icon={<Clock className="w-4 h-4" />} label="上次同步" value={fmtLocal(oaPull.lastRunAt)} />
                  <StatusCard icon={<Clock className="w-4 h-4" />} label="下次同步" value={oaPull.nextRunAt ? fmtLocal(oaPull.nextRunAt) : '按调度'} />
                  <StatusCard icon={<CheckCircle2 className="w-4 h-4" />} label="最近结果" value={lastResultLabel}
                    tone={oaPull.lastRunStatus === 'success' ? 'emerald' : oaPull.lastRunStatus === 'failed' ? 'red' : 'slate'} />
                  <StatusCard icon={<AlertTriangle className="w-4 h-4" />} label="连续失败" value={`${oaPull.consecutiveFails} 次`}
                    tone={oaPull.consecutiveFails > 0 ? 'red' : 'slate'} />
                </div>
                {oaPull.lastRunDetail && (
                  <div className="mt-3 text-xs px-3 py-2 rounded-lg bg-slate-50 text-slate-500 border border-slate-100">{oaPull.lastRunDetail}</div>
                )}
              </>
            ) : (
              <div className="py-8 text-center text-sm text-slate-300">配置加载失败</div>
            )}
          </div>
        </div>

        {/* ── 调度设置 ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <Settings2 className="w-4.5 h-4.5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">调度设置</p>
                <p className="text-xs text-slate-400">定时策略、增量同步、失败重试与告警</p>
              </div>
            </div>
            {/* 启用开关 */}
            {oaPull && (
              <button
                onClick={() => setOaPull(p => p ? { ...p, enabled: !p.enabled } : p)}
                className={`relative w-11 h-6 rounded-full transition-colors ${oaPull.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${oaPull.enabled ? 'translate-x-5' : ''}`} />
              </button>
            )}
          </div>
          <div className="px-6 py-6 space-y-6">
            {oaPull && (
              <>
                {/* 调度策略 */}
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4">调度策略</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">Cron 表达式 <span className="text-slate-300">（可选）</span></label>
                      <input type="text" value={oaPull.cronExpr}
                        onChange={e => setOaPull(p => p ? { ...p, cronExpr: e.target.value } : p)}
                        placeholder="例：0 0/30 9-18 * * 1-5"
                        className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
                      <p className="text-[11px] text-slate-400 mt-1">格式：分 时 日 月 周。留空则用下方间隔</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">间隔（分钟）</label>
                      <input type="number" min={1} max={1440} value={oaPull.intervalMin}
                        onChange={e => setOaPull(p => p ? { ...p, intervalMin: parseInt(e.target.value) || 30 } : p)}
                        className="w-28 h-9 text-sm border border-slate-200 rounded-lg px-3 text-center focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
                    </div>
                  </div>
                </div>

                {/* 增量同步 */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-5">
                  <div>
                    <p className="text-sm font-medium text-slate-700">增量同步</p>
                    <p className="text-xs text-slate-400 mt-0.5">只拉上次同步后修改的记录（按 OA 修改时间）</p>
                  </div>
                  <button
                    onClick={() => setOaPull(p => p ? { ...p, incremental: !p.incremental } : p)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${oaPull.incremental ? 'bg-blue-600' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${oaPull.incremental ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {/* 重试与告警 */}
                <div className="border-t border-slate-100 pt-5 space-y-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">失败重试与告警</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">最大重试次数</label>
                      <input type="number" min={0} max={10} value={oaPull.maxRetries}
                        onChange={e => setOaPull(p => p ? { ...p, maxRetries: parseInt(e.target.value) || 0 } : p)}
                        className="w-24 h-9 text-sm border border-slate-200 rounded-lg px-3 text-center" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">重试退避基数（分钟）</label>
                      <input type="number" min={1} value={oaPull.retryBaseMin}
                        onChange={e => setOaPull(p => p ? { ...p, retryBaseMin: parseInt(e.target.value) || 5 } : p)}
                        className="w-24 h-9 text-sm border border-slate-200 rounded-lg px-3 text-center" />
                      <p className="text-[11px] text-slate-400 mt-1">指数退避：N, 2N, 4N…</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 mb-1.5 block">连续失败告警阈值</label>
                      <input type="number" min={1} value={oaPull.alertAfterFails}
                        onChange={e => setOaPull(p => p ? { ...p, alertAfterFails: parseInt(e.target.value) || 3 } : p)}
                        className="w-24 h-9 text-sm border border-slate-200 rounded-lg px-3 text-center" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1.5 block flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5" /> 告警收件人（OA 姓名，逗号分隔）
                    </label>
                    <input type="text" value={oaPull.alertRecipients}
                      onChange={e => setOaPull(p => p ? { ...p, alertRecipients: e.target.value } : p)}
                      placeholder="例：陈巧霞,戎双娇"
                      className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3" />
                  </div>
                </div>
              </>
            )}
          </div>
          {oaPull && (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              {msg ? <span className="text-xs text-slate-500">{msg}</span> : <span />}
              <button
                onClick={saveOaPull}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl transition-colors"
              >
                {saving ? '保存中…' : '保存配置'}
              </button>
            </div>
          )}
        </div>

        {/* ── 执行历史 ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
              <History className="w-4.5 h-4.5 text-slate-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">执行历史</p>
              <p className="text-xs text-slate-400">最近 20 次同步记录</p>
            </div>
          </div>
          {oaPullRuns.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-300">暂无执行记录</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-500">
                  <th className="text-left px-4 py-2.5 font-semibold">开始时间</th>
                  <th className="text-left px-4 py-2.5 font-semibold">结束时间</th>
                  <th className="text-left px-4 py-2.5 font-semibold">方式</th>
                  <th className="text-left px-4 py-2.5 font-semibold">结果</th>
                  <th className="text-left px-4 py-2.5 font-semibold">同步条数</th>
                  <th className="text-left px-4 py-2.5 font-semibold">信息</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {oaPullRuns.map(run => (
                  <tr key={run.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtLocal(run.startedAt)}</td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{fmtLocal(run.finishedAt)}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px]">
                        {{ scheduled: '定时', manual: '手动', retry: '重试', startup: '启动' }[String(run.mode)] || run.mode}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] ${run.status === 'success' ? 'bg-emerald-50 text-emerald-600' : run.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                        {{ success: '成功', failed: '失败', running: '运行中' }[String(run.status)] || run.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{run.synced}</td>
                    <td className="px-4 py-2.5 text-slate-500 max-w-[260px] truncate" title={run.error || run.detail || ''}>{run.error || run.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

// 状态卡小控件
function StatusCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: 'emerald' | 'red' | 'slate' }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-600' : 'text-slate-800';
  const iconColor = tone === 'emerald' ? 'text-emerald-500' : tone === 'red' ? 'text-red-500' : 'text-slate-400';
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={iconColor}>{icon}</span>
        <span className="text-[11px] text-slate-400">{label}</span>
      </div>
      <div className={`text-sm font-bold ${color} tabular-nums`}>{value}</div>
    </div>
  );
}
