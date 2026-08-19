'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Plus, Trash2, Tag, Pencil, CalendarClock, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { SearchableSelect } from '@/components/ui/searchable-select';

interface MeetingType { id: string; name: string; defaultDept: string; defaultOwner: string; sort: number; }
type FormData = { name: string; defaultDept: string; defaultOwner: string };
const emptyForm = (): FormData => ({ name: '', defaultDept: '', defaultOwner: '' });

interface CadenceConfig {
  id: string; meetingType: string; cadence: 'weekly' | 'monthly';
  triggerDay: number; triggerTime: string; enabled: boolean;
  lastPushedAt?: string | null; createdAt: string;
}

interface PushLog {
  id: number; meetingType: string; triggerSource: 'auto' | 'manual';
  items: number; pushed: number; failed: number; createdAt: string;
}

const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// ISO(UTC) → 本地时间显示（YYYY-MM-DD HH:mm）
function fmtLocal(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SettingsPage() {
  const [tab, setTab] = useState<'meeting-types' | 'cadence'>('meeting-types');
  const [types, setTypes] = useState<MeetingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [depts, setDepts] = useState<string[]>([]);
  const [employees, setEmployees] = useState<string[]>([]);

  // 弹窗状态
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; data: FormData; id?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // 持续项推送配置
  const [cadences, setCadences] = useState<CadenceConfig[]>([]);
  const [cadenceLoading, setCadenceLoading] = useState(true);
  const [cadenceModal, setCadenceModal] = useState<{ mode: 'add' | 'edit'; data: Partial<CadenceConfig>; id?: string } | null>(null);
  const [cadenceSaving, setCadenceSaving] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [pushHistory, setPushHistory] = useState<PushLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    fetch('/api/meeting-types').then(r => r.json()).then(d => { if (d.success) setTypes(d.data || []); }).finally(() => setLoading(false));
    fetch('/api/org/departments').then(r => r.json()).then(d => {
      if (d.success) setDepts((d.data || []).filter((x: any) => x.status !== 'inactive').map((x: any) => x.name));
    });
    fetch('/api/org/employees').then(r => r.json()).then(d => {
      if (d.success) setEmployees((d.data || []).filter((x: any) => x.status !== 'resigned').map((x: any) => x.name));
    });
    loadCadences();
    loadPushHistory();
  }, []);

  const loadCadences = () => {
    setCadenceLoading(true);
    fetch('/api/cadence').then(r => r.json()).then(d => { if (d.success) setCadences(d.data || []); }).finally(() => setCadenceLoading(false));
  };

  const loadPushHistory = () => {
    setHistoryLoading(true);
    fetch('/api/continuous/push-history?pageSize=30').then(r => r.json())
      .then(d => { if (d.success) setPushHistory(d.data || []); })
      .finally(() => setHistoryLoading(false));
  };

  const openAdd = () => setModal({ mode: 'add', data: emptyForm() });
  const openEdit = (t: MeetingType) => setModal({ mode: 'edit', id: t.id, data: { name: t.name, defaultDept: t.defaultDept, defaultOwner: t.defaultOwner } });
  const closeModal = () => { setModal(null); setSaving(false); };

  const handleSave = async () => {
    if (!modal) return;
    if (!modal.data.name.trim()) { toast.error('类别名称不能为空'); return; }
    setSaving(true);
    try {
      const isEdit = modal.mode === 'edit';
      const res = await fetch('/api/meeting-types', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: modal.id, ...modal.data } : modal.data),
      });
      const r = await res.json();
      if (r.success) {
        setTypes(r.data);
        toast.success(isEdit ? '已保存' : `已添加「${modal.data.name}」`);
        closeModal();
      } else {
        toast.error(r.error || '操作失败');
      }
    } finally { setSaving(false); }
  };

  const handleDelete = async (t: MeetingType) => {
    if (!confirm(`确认删除「${t.name}」？`)) return;
    const res = await fetch('/api/meeting-types', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: t.id }) });
    const r = await res.json();
    if (r.success) { setTypes(r.data); toast.success(`已删除「${t.name}」`); }
  };

  const setField = (k: keyof FormData, v: string) => setModal(m => m ? { ...m, data: { ...m.data, [k]: v } } : null);

  // ── 持续项推送配置操作 ──
  const openCadenceAdd = () => setCadenceModal({ mode: 'add', data: { meetingType: '', cadence: 'weekly', triggerDay: 5, triggerTime: '09:00', enabled: true } });
  const openCadenceEdit = (c: CadenceConfig) => setCadenceModal({ mode: 'edit', id: c.id, data: { ...c } });
  const closeCadenceModal = () => { setCadenceModal(null); setCadenceSaving(false); };

  const handleCadenceSave = async () => {
    if (!cadenceModal) return;
    const d = cadenceModal.data;
    if (!d.meetingType) { toast.error('请选择会议类型'); return; }
    setCadenceSaving(true);
    try {
      const isEdit = cadenceModal.mode === 'edit';
      const res = await fetch('/api/cadence', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: cadenceModal.id, ...d } : d),
      });
      const r = await res.json();
      if (r.success) { toast.success(isEdit ? '已保存' : '已添加'); closeCadenceModal(); loadCadences(); }
      else { toast.error(r.error || '操作失败'); }
    } finally { setCadenceSaving(false); }
  };

  const handleCadenceDelete = async (id: string) => {
    if (!confirm('确认删除这条配置？')) return;
    const res = await fetch(`/api/cadence?id=${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('已删除'); loadCadences(); }
  };

  const handleToggle = async (c: CadenceConfig) => {
    const res = await fetch('/api/cadence', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, enabled: !c.enabled }),
    });
    if (res.ok) loadCadences();
  };

  const handlePushNow = async (meetingType: string) => {
    setPushing(meetingType);
    try {
      const res = await fetch('/api/continuous/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_type: meetingType }),
      });
      const r = await res.json();
      if (r.success) { toast.success(`推送完成：${r.data.items} 项，OA ${r.data.pushed}`); loadCadences(); loadPushHistory(); }
      else toast.error(r.error || '推送失败');
    } catch { toast.error('推送失败'); }
    finally { setPushing(null); }
  };

  const fmtCadence = (c: CadenceConfig) => {
    if (c.cadence === 'weekly') return `每周${WEEKDAYS[c.triggerDay] || ''} ${c.triggerTime}`;
    return `每月${c.triggerDay}日 ${c.triggerTime}`;
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">

        {/* 标签切换 */}
        <div className="flex gap-2">
          <button onClick={() => setTab('meeting-types')}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${tab === 'meeting-types' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <Tag className="w-4 h-4 inline mr-1.5" /> 会议类别
          </button>
          <button onClick={() => setTab('cadence')}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${tab === 'cadence' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <CalendarClock className="w-4 h-4 inline mr-1.5" /> 持续项推送配置
          </button>
        </div>

        {/* ── 会议类别 ── */}
        {tab === 'meeting-types' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <Tag className="w-4.5 h-4.5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">会议类别</p>
                <p className="text-xs text-slate-400">选择类别后自动带入默认部门 / 负责人</p>
              </div>
            </div>
            <button onClick={openAdd} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors">
              <Plus className="w-4 h-4" /> 新增类别
            </button>
          </div>

          <div className="grid grid-cols-[auto_1fr_1fr_1fr_5rem] px-6 py-2 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-400">
            <span className="w-6 text-center mr-4">#</span>
            <span>类别名称</span>
            <span>默认负责部门</span>
            <span>默认负责人</span>
            <span />
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-slate-300">加载中…</div>
          ) : types.length === 0 ? (
            <div className="py-16 text-center">
              <Tag className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-300">暂无类别，点击「新增类别」开始配置</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-50">
              {types.map((t, i) => (
                <li key={t.id} className="grid grid-cols-[auto_1fr_1fr_1fr_5rem] items-center px-6 py-3.5 hover:bg-slate-50/60 transition-colors group">
                  <span className="w-6 text-xs text-slate-300 text-center mr-4">{i + 1}</span>
                  <span className="text-sm font-medium text-slate-800">{t.name}</span>
                  <span className="text-sm text-slate-500">{t.defaultDept || <span className="text-slate-300">未设置</span>}</span>
                  <span className="text-sm text-slate-500">{t.defaultOwner || <span className="text-slate-300">未设置</span>}</span>
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(t)} title="编辑" className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(t)} title="删除" className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}

        {/* ── 持续项推送配置 ── */}
        {tab === 'cadence' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                <CalendarClock className="w-4.5 h-4.5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">持续项推送配置</p>
                <p className="text-xs text-slate-400">配置后自动按节奏打包持续项推 OA + 企微提醒</p>
              </div>
            </div>
            <button onClick={openCadenceAdd} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-xl transition-colors">
              <Plus className="w-4 h-4" /> 新增配置
            </button>
          </div>

          {cadenceLoading ? (
            <div className="py-16 text-center text-sm text-slate-300">加载中…</div>
          ) : cadences.length === 0 ? (
            <div className="py-16 text-center">
              <CalendarClock className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-300">暂无配置，点击「新增配置」开始</p>
            </div>
          ) : (
            <div className="p-5 space-y-3">
              {cadences.map(c => (
                <div key={c.id} className={`flex items-center justify-between rounded-xl border px-4 py-3.5 transition-all gap-4 ${c.enabled ? 'border-slate-200 bg-white hover:border-slate-300' : 'border-slate-100 bg-slate-50/60 opacity-75'}`}>
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <button onClick={() => handleToggle(c)}
                      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${c.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${c.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{c.meetingType}</span>
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          <CalendarClock className="w-3 h-3" /> {fmtCadence(c)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {c.enabled ? (c.lastPushedAt ? <>上次推送 <span className="text-slate-500">{fmtLocal(c.lastPushedAt)}</span></> : '尚未推送过') : '已暂停'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => handlePushNow(c.meetingType)} disabled={pushing === c.meetingType}
                      title="立即推送" className="px-2.5 py-1.5 text-[11px] rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors flex items-center gap-1 disabled:opacity-50">
                      <Zap className="w-3 h-3" /> {pushing === c.meetingType ? '推送中' : '推送'}
                    </button>
                    <button onClick={() => openCadenceEdit(c)} title="编辑" className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleCadenceDelete(c.id)} title="删除" className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {tab === 'cadence' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <CalendarClock className="w-4.5 h-4.5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">推送记录</p>
                <p className="text-xs text-slate-400">最近 {pushHistory.length} 条（自动/手动推送）</p>
              </div>
            </div>
          </div>
          {historyLoading ? (
            <div className="py-10 text-center text-sm text-slate-300">加载中…</div>
          ) : pushHistory.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-300">暂无推送记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                    <th className="px-6 py-3 font-medium">推送时间</th>
                    <th className="px-4 py-3 font-medium">会议类型</th>
                    <th className="px-4 py-3 font-medium">来源</th>
                    <th className="px-4 py-3 font-medium text-right">条数</th>
                    <th className="px-6 py-3 font-medium text-right">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {pushHistory.map(h => (
                    <tr key={h.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-6 py-3 text-slate-600 whitespace-nowrap">{fmtLocal(h.createdAt)}</td>
                      <td className="px-4 py-3 text-slate-800">{h.meetingType}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] ${h.triggerSource === 'manual' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>
                          {h.triggerSource === 'manual' ? '手动' : '自动'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-right">{h.items}</td>
                      <td className="px-6 py-3 text-right">
                        {h.failed > 0
                          ? <span className="text-red-500">OA {h.pushed} 成功 / {h.failed} 失败</span>
                          : <span className="text-emerald-600">OA {h.pushed} 成功</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

      </div>

      {/* ── 会议类别 编辑/新增 弹窗 ── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-5 border-b border-slate-100 rounded-t-2xl">
              <h3 className="text-base font-semibold text-slate-800">{modal.mode === 'add' ? '新增会议类别' : '编辑会议类别'}</h3>
              <p className="text-xs text-slate-400 mt-0.5">配置完成后，新建会议时自动填充默认部门和负责人</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">类别名称 <span className="text-red-400">*</span></label>
                <input autoFocus value={modal.data.name} onChange={e => setField('name', e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()} placeholder="如：协调会"
                  className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">默认负责部门</label>
                <SearchableSelect value={modal.data.defaultDept} onChange={v => setField('defaultDept', v)} options={depts} placeholder="搜索或选择部门" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">默认负责人</label>
                <SearchableSelect value={modal.data.defaultOwner} onChange={v => setField('defaultOwner', v)} options={employees} placeholder="搜索或选择负责人" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2.5 rounded-b-2xl bg-white">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">取消</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl transition-colors">{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 持续项推送配置 编辑/新增 弹窗 ── */}
      {cadenceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-5 border-b border-slate-100 rounded-t-2xl">
              <h3 className="text-base font-semibold text-slate-800">{cadenceModal.mode === 'add' ? '新增推送配置' : '编辑推送配置'}</h3>
              <p className="text-xs text-slate-400 mt-0.5">配置后自动按节奏打包该类型的持续项推 OA + 企微</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* 会议类型 */}
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">会议类型 <span className="text-red-400">*</span></label>
                <select value={cadenceModal.data.meetingType || ''}
                  onChange={e => setCadenceModal(m => m ? { ...m, data: { ...m.data, meetingType: e.target.value } } : null)}
                  disabled={cadenceModal.mode === 'edit'}
                  className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 disabled:bg-slate-50">
                  <option value="">请选择</option>
                  {types.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
              {/* 频率 */}
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">推送频率</label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={cadenceModal.data.cadence === 'weekly'}
                      onChange={() => setCadenceModal(m => m ? { ...m, data: { ...m.data, cadence: 'weekly', triggerDay: 5 } } : null)}
                      className="accent-emerald-600" />
                    <span className="text-sm text-slate-600">每周</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={cadenceModal.data.cadence === 'monthly'}
                      onChange={() => setCadenceModal(m => m ? { ...m, data: { ...m.data, cadence: 'monthly', triggerDay: 25 } } : null)}
                      className="accent-emerald-600" />
                    <span className="text-sm text-slate-600">每月</span>
                  </label>
                </div>
              </div>
              {/* 触发日 */}
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">{cadenceModal.data.cadence === 'monthly' ? '每月几号' : '星期几'}</label>
                {cadenceModal.data.cadence === 'weekly' ? (
                  <select value={cadenceModal.data.triggerDay}
                    onChange={e => setCadenceModal(m => m ? { ...m, data: { ...m.data, triggerDay: parseInt(e.target.value) } } : null)}
                    className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3 bg-white text-slate-700">
                    {WEEKDAYS.slice(1).map((w, i) => <option key={i+1} value={i+1}>{w}</option>)}
                  </select>
                ) : (
                  <input type="number" min={1} max={28} value={cadenceModal.data.triggerDay}
                    onChange={e => setCadenceModal(m => m ? { ...m, data: { ...m.data, triggerDay: parseInt(e.target.value) || 1 } } : null)}
                    className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3" />
                )}
              </div>
              {/* 触发时间 */}
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">触发时间</label>
                <input type="time" value={cadenceModal.data.triggerTime || '09:00'}
                  onChange={e => setCadenceModal(m => m ? { ...m, data: { ...m.data, triggerTime: e.target.value } } : null)}
                  className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2.5 rounded-b-2xl bg-white">
              <button onClick={closeCadenceModal} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">取消</button>
              <button onClick={handleCadenceSave} disabled={cadenceSaving} className="px-5 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl transition-colors">{cadenceSaving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
