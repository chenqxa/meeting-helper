'use client';

import React, { useCallback, useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Database, Plus, Pencil, Trash2, Save, X, RefreshCw, Info } from 'lucide-react';

interface BuiltinSource { key: string; name: string; src: string; how: string; when: string }
interface CustomSource {
  key: string; name: string; src: string; how: string; when: string;
  summarySql: string | null; detailSql: string | null; progressTpl: string | null;
  detailCols: { key: string; label: string; align?: string }[] | null;
  enabled: boolean;
}

const EMPTY: CustomSource = {
  key: '', name: '', src: '', how: '', when: '',
  summarySql: '', detailSql: '', progressTpl: '', detailCols: null, enabled: true,
};

export default function AutoFetchSourcesPage() {
  const [builtin, setBuiltin] = useState<BuiltinSource[]>([]);
  const [custom, setCustom] = useState<CustomSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [editing, setEditing] = useState<CustomSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [colsText, setColsText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await fetch('/api/auth/me').then(r => r.json()).catch(() => null);
      if (!me?.data || (me.data.role !== 'admin')) { setDenied(true); setLoading(false); return; }
      const r = await fetch('/api/auto-fetch-sources').then(r => r.json());
      if (r.success) { setBuiltin(r.data.builtin || []); setCustom(r.data.custom || []); }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing({ ...EMPTY }); setColsText(''); };
  const openEdit = (s: CustomSource) => {
    setEditing({ ...s });
    setColsText(s.detailCols ? JSON.stringify(s.detailCols, null, 2) : '');
  };

  const save = async () => {
    if (!editing) return;
    let detailCols: unknown = null;
    if (colsText.trim()) {
      try { detailCols = JSON.parse(colsText); }
      catch { alert('明细列配置不是合法 JSON'); return; }
    }
    setSaving(true);
    try {
      const isNew = !custom.some(c => c.key === editing.key);
      const res = await fetch(isNew ? '/api/auto-fetch-sources' : `/api/auto-fetch-sources/${encodeURIComponent(editing.key)}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editing, detailCols }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) { alert(j.error || '保存失败'); return; }
      setEditing(null); load();
    } finally { setSaving(false); }
  };

  const remove = async (key: string) => {
    if (!window.confirm(`确认删除取数源「${key}」？已绑定该项的持续项将不再取数。`)) return;
    const res = await fetch(`/api/auto-fetch-sources/${encodeURIComponent(key)}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) { alert(j.error || '删除失败'); return; }
    load();
  };

  const field = 'w-full text-sm rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-blue-400';
  const label = 'block text-xs font-medium text-slate-500 mb-1';

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-bold text-slate-800">取数源管理</h1>
            <span className="text-xs text-slate-400">自定义源可维护 SQL；内置源由程序实现（只读）</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-600">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={openNew} className="h-9 px-4 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> 新建自定义源
            </button>
          </div>
        </div>

        {denied ? (
          <div className="p-8 text-center text-slate-400">仅管理员可访问</div>
        ) : loading ? (
          <div className="p-8 text-center text-slate-400">加载中...</div>
        ) : (
          <div className="space-y-6">
            {/* 自定义源 */}
            <section>
              <h2 className="text-sm font-bold text-slate-700 mb-2">自定义源（可编辑 SQL）</h2>
              {custom.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                  还没有自定义源，点右上角「新建自定义源」
                </div>
              ) : (
                <div className="grid gap-3">
                  {custom.map(s => (
                    <div key={s.key} className="rounded-xl border border-slate-100 bg-white p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${s.enabled ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                            {s.enabled ? '启用' : '停用'}
                          </span>
                          <span className="font-bold text-slate-800">{s.name}</span>
                          <code className="text-[11px] text-slate-400">{s.key}</code>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(s)} className="h-8 px-3 rounded-lg border border-slate-200 text-slate-600 text-xs hover:bg-slate-50 flex items-center gap-1"><Pencil className="w-3.5 h-3.5" />编辑</button>
                          <button onClick={() => remove(s.key)} className="h-8 px-3 rounded-lg border border-red-100 text-red-500 text-xs hover:bg-red-50 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" />删除</button>
                        </div>
                      </div>
                      {s.src && <p className="text-xs text-slate-500 mt-2"><span className="text-slate-400">来源：</span>{s.src}</p>}
                      {s.how && <p className="text-xs text-slate-500 mt-0.5 whitespace-pre-wrap"><span className="text-slate-400">规则：</span>{s.how}</p>}
                      {s.summarySql && <pre className="mt-2 text-[11px] bg-slate-50 rounded-lg p-2 overflow-x-auto text-slate-600">{s.summarySql}</pre>}
                      {s.detailSql && <pre className="mt-1 text-[11px] bg-slate-50 rounded-lg p-2 overflow-x-auto text-slate-600">{s.detailSql}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 内置源 */}
            <section>
              <h2 className="text-sm font-bold text-slate-700 mb-2">内置源（程序实现，只读）</h2>
              <div className="grid gap-2">
                {builtin.map(s => (
                  <div key={s.key} className="rounded-xl border border-slate-100 bg-slate-50/40 p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-700">{s.name}</span>
                      <code className="text-[11px] text-slate-400">{s.key}</code>
                    </div>
                    <p className="text-xs text-slate-500 mt-1"><span className="text-slate-400">来源：</span>{s.src}</p>
                    <p className="text-xs text-slate-500 mt-0.5"><span className="text-slate-400">规则：</span>{s.how}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setEditing(null)}>
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800">{custom.some(c => c.key === editing.key) ? '编辑取数源' : '新建取数源'}</h3>
              <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              <div className="px-3 py-2 bg-blue-50/60 border border-blue-100 rounded-lg text-[11px] text-slate-600 leading-relaxed flex gap-1.5">
                <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div>
                  SQL 可用占位符：<code>@ws</code> 上周一、<code>@we</code> 上周日、<code>@ms</code> 上月初、<code>@me</code> 上月末（字符串比较）。
                  汇总 SQL 返回一行；文字模板里用 <code>{'{{列名}}'}</code> 取值，另有 <code>{'{{label}}'}</code>=周期标签。
                  跨库可直接写 <code>[k3sv].[AIS20161019115614].dbo.xxx</code> / <code>[FWsv].[ecology].dbo.xxx</code>。
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>key（唯一标识，小写字母数字短横线）</label><input className={field} value={editing.key} disabled={custom.some(c => c.key === editing.key)} onChange={e => setEditing({ ...editing, key: e.target.value })} placeholder="custom-kpi-1" /></div>
                <div><label className={label}>名称</label><input className={field} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="如：研发其他领料" /></div>
              </div>
              <div><label className={label}>数据来源（说明用）</label><input className={field} value={editing.src} onChange={e => setEditing({ ...editing, src: e.target.value })} placeholder="金蝶K3「xxx表」" /></div>
              <div><label className={label}>取数规则（说明用）</label><textarea className={field} rows={2} value={editing.how} onChange={e => setEditing({ ...editing, how: e.target.value })} /></div>
              <div><label className={label}>更新频率（说明用）</label><input className={field} value={editing.when} onChange={e => setEditing({ ...editing, when: e.target.value })} placeholder="每周一 00:30 自动取数" /></div>
              <div><label className={label}>汇总 SQL（返回一行，供文字模板取值）</label><textarea className={`${field} font-mono text-xs`} rows={4} value={editing.summarySql || ''} onChange={e => setEditing({ ...editing, summarySql: e.target.value })} placeholder={'SELECT COUNT(*) AS bills, SUM(amt) AS amount FROM ... WHERE ... >= @ws AND ... <= @we'} /></div>
              <div><label className={label}>明细 SQL（返回多行，弹窗表格展示）</label><textarea className={`${field} font-mono text-xs`} rows={5} value={editing.detailSql || ''} onChange={e => setEditing({ ...editing, detailSql: e.target.value })} placeholder={'SELECT ... FROM ... WHERE ... >= @ws AND ... <= @we ORDER BY ...'} /></div>
              <div><label className={label}>进度文字模板</label><input className={field} value={editing.progressTpl || ''} onChange={e => setEditing({ ...editing, progressTpl: e.target.value })} placeholder="研发其他领料 · {{label}} 出库{{bills}}单，金额¥{{amount}}" /></div>
              <div><label className={label}>明细列（可选，JSON：[&quot;key&quot;,&quot;label&quot;,&quot;align&quot;]，align=text/num/money；不填用结果列名）</label><textarea className={`${field} font-mono text-xs`} rows={4} value={colsText} onChange={e => setColsText(e.target.value)} placeholder={'[{"key":"item_no","label":"物料代码"},{"key":"qty","label":"数量","align":"num"}]'} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} /> 启用
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setEditing(null)} className="px-5 h-10 rounded-xl border border-slate-200 text-slate-500 text-sm">取消</button>
              <button onClick={save} disabled={saving} className="px-5 h-10 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 flex items-center gap-1.5">
                <Save className="w-4 h-4" /> {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
