'use client';

import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { ChevronLeft, Plus, Trash2, Send, Calendar, User, Pencil } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';

const SOURCE_LABELS: Record<string, string> = {
  wechat: '企业微信',
  face_to_face: '面对面',
  phone: '电话',
  other: '其他',
};

interface BatchItem {
  id: string;
  description: string;
  owner?: string | null;
  dueDate?: string | null;
  priority: string;
  status: string;
}

interface BatchData {
  id: string;
  title: string;
  sourceChannel?: string | null;
  status: 'draft' | 'pushed';
  createdBy?: string | null;
  createdAt: string;
  oaPushedAt?: string | null;
}

export default function BatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.id as string;

  const [batch, setBatch] = useState<BatchData | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [editing, setEditing] = useState<BatchItem | null>(null);
  const [editForm, setEditForm] = useState({ description: '', owner: '', proposer: '', dueDate: '', dueDateType: 'date', priority: 'medium' });
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ description: '', owner: '', proposer: '', dueDate: '', dueDateType: 'date', priority: 'medium' });
  const [pushResult, setPushResult] = useState<{ pushed: number; failed: number; errors: string[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/actions/batch/${batchId}`).then(r => r.json());
      if (r.success) {
        setBatch(r.data.batch);
        setItems(r.data.items);
      }
    } catch { }
    setLoading(false);
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item: BatchItem) => {
    setEditing(item);
    setEditForm({
      description: item.description,
      owner: item.owner || '',
      proposer: (item as any).proposer || '',
      dueDate: item.dueDate || '',
      dueDateType: (item as any).dueDateType || 'date',
      priority: item.priority || 'medium',
    });
  };

  const submitEdit = async () => {
    if (!editing || !batch) return;
    if (batch.status === 'pushed') {
      await fetch(`/api/actions/${editing.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: editForm.description, owner: editForm.owner || null,
          proposer: editForm.proposer || null,
          due_date: editForm.dueDateType === 'date' ? (editForm.dueDate || null) : null,
          due_date_type: editForm.dueDateType, priority: editForm.priority,
        }),
      });
    } else {
      const updatedItems = items.map(i => i.id === editing.id ? {
        ...i, description: editForm.description, owner: editForm.owner || null,
        proposer: editForm.proposer || null,
        dueDate: editForm.dueDateType === 'date' ? (editForm.dueDate || null) : null,
        dueDateType: editForm.dueDateType, priority: editForm.priority,
      } : i);
      await fetch(`/api/actions/batch/${batchId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updatedItems }),
      });
    }
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!batch) return;
    if (batch.status === 'pushed') {
      await fetch(`/api/actions/${id}`, { method: 'DELETE' }).catch(() => {});
    } else {
      const remain = items.filter(i => i.id !== id);
      await fetch(`/api/actions/batch/${batchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: remain }),
      });
    }
    load();
  };

  const handleAdd = async () => {
    if (!addForm.description.trim() || !batch) return;
    if (batch.status === 'pushed') {
      await fetch('/api/actions/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `新增_${batch.title}`, sourceChannel: batch.sourceChannel || 'other',
          items: [{ description: addForm.description.trim(), owner: addForm.owner || null,
            proposer: addForm.proposer || null,
            dueDate: addForm.dueDateType === 'date' ? addForm.dueDate : null,
            dueDateType: addForm.dueDateType || 'date', priority: addForm.priority }],
        }),
      });
    } else {
      const updatedItems = [...items, {
        id: '', description: addForm.description.trim(), owner: addForm.owner || null,
        proposer: addForm.proposer || null,
        dueDate: addForm.dueDate || null, priority: addForm.priority, status: 'pending',
      }];
      await fetch(`/api/actions/batch/${batchId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updatedItems }),
      });
    }
    setAdding(false);
    setAddForm({ description: '', owner: '', proposer: '', dueDate: '', dueDateType: 'date', priority: 'medium' });
    load();
  };

  const handlePush = async () => {
    if (!confirm('确认推送到 OA？推送后不可编辑。')) return;
    setPushing(true);
    try {
      const r = await fetch(`/api/actions/batch/${batchId}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).then(r => r.json());
      if (r.success) {
        setPushResult(r.data.oaPush);
        load();
      } else {
        alert(r.error || '推送失败');
      }
    } finally { setPushing(false); }
  };

  if (loading) {
    return <DashboardLayout><div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div></DashboardLayout>;
  }

  if (!batch) {
    return <DashboardLayout><div className="text-center py-20 text-slate-400">批次不存在</div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* 顶部 */}
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/kanban')} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">{batch.title}</h1>
            <div className="flex items-center gap-3 mt-1">
              {batch.sourceChannel && (
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  {SOURCE_LABELS[batch.sourceChannel] || batch.sourceChannel}
                </span>
              )}
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${batch.status === 'pushed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {batch.status === 'pushed' ? '已推送' : '草稿'}
              </span>
              {batch.createdBy && <span className="text-xs text-slate-400 flex items-center gap-1"><User className="w-3 h-3" />{batch.createdBy}</span>}
            </div>
          </div>
          <button
            onClick={() => {
              if (batch.status === 'pushed' && !confirm('重新推送将增量更新 OA（新增/修改/作废），确认？')) return;
              handlePush();
            }}
            disabled={pushing || items.length === 0}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-all shadow-sm ${
              batch.status === 'pushed'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Send className="w-4 h-4" /> {pushing ? '推送中...' : batch.status === 'pushed' ? '重新推送OA' : '确认并推送到OA'}
          </button>
        </div>

        {pushResult && (
          <div className={`rounded-2xl p-4 ${pushResult.failed > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
            <p className="text-sm font-medium">
              OA 推送完成：成功 {pushResult.pushed} 条
              {pushResult.failed > 0 && `，失败 ${pushResult.failed} 条`}
            </p>
            {pushResult.errors?.length > 0 && (
              <p className="text-xs text-red-500 mt-1">{pushResult.errors.join('; ')}</p>
            )}
          </div>
        )}

        {/* 行动项列表 */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">行动项（{items.length}）</h2>
            {batch.status === 'draft' && (
              <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                <Plus className="w-3.5 h-3.5" /> 添加
              </button>
            )}
          </div>

          {/* 添加行 */}
          {adding && (
            <div className="px-5 py-3 border-b border-slate-50 bg-slate-50/50 flex items-center gap-3">
              <input value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} placeholder="任务描述" className="flex-1 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" autoFocus />
              <input value={addForm.owner} onChange={e => setAddForm(f => ({ ...f, owner: e.target.value }))} placeholder="责任人" className="w-28 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" />
              <input value={addForm.proposer} onChange={e => setAddForm(f => ({ ...f, proposer: e.target.value }))} placeholder="提出人" className="w-28 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" />
              {/* 三模式选择 */}
              {[{ key: 'date', label: '📅' }, { key: 'continuous', label: '🔄' }, { key: 'tbd', label: '❓' }].map(opt => (
                <button key={opt.key} title={opt.key === 'date' ? '具体日期' : opt.key === 'continuous' ? '持续执行' : '待定'}
                  onClick={() => setAddForm(f => ({ ...f, dueDateType: opt.key, dueDate: opt.key === 'date' ? new Date().toISOString().slice(0, 10) : '' }))}
                  className={`w-7 h-7 rounded text-xs flex items-center justify-center transition-all ${addForm.dueDateType === opt.key ? 'bg-blue-600 text-white shadow-sm scale-110' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                >{opt.label}</button>
              ))}
              {addForm.dueDateType === 'date' && (
                <input type="date" value={addForm.dueDate} onChange={e => setAddForm(f => ({ ...f, dueDate: e.target.value }))} className="w-32 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none" />
              )}
              <select value={addForm.priority} onChange={e => setAddForm(f => ({ ...f, priority: e.target.value }))} className="w-20 h-8 text-sm border border-slate-200 rounded-lg px-1.5 outline-none">
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
              <button onClick={handleAdd} className="h-8 px-3 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700">确认</button>
              <button onClick={() => setAdding(false)} className="h-8 px-3 text-slate-400 text-xs hover:text-slate-600">取消</button>
            </div>
          )}

          <div className="divide-y divide-slate-50">
            {items.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-sm">暂无行动项</div>
            ) : items.map(item => (
              <div key={item.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
                {editing?.id === item.id ? (
                  <>
                    <input value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className="flex-1 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" autoFocus />
                    <input value={editForm.owner} onChange={e => setEditForm(f => ({ ...f, owner: e.target.value }))} className="w-28 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" />
                    <input value={editForm.proposer} onChange={e => setEditForm(f => ({ ...f, proposer: e.target.value }))} placeholder="提出人" className="w-28 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none focus:ring-1 focus:ring-blue-300" />
                    {[{ key: 'date', label: '📅' }, { key: 'continuous', label: '🔄' }, { key: 'tbd', label: '❓' }].map(opt => (
                      <button key={opt.key} title={opt.key === 'date' ? '具体日期' : opt.key === 'continuous' ? '持续执行' : '待定'}
                        onClick={() => setEditForm(f => ({ ...f, dueDateType: opt.key, dueDate: opt.key === 'date' ? new Date().toISOString().slice(0, 10) : '' }))}
                        className={`w-7 h-7 rounded text-xs flex items-center justify-center transition-all ${editForm.dueDateType === opt.key ? 'bg-blue-600 text-white shadow-sm scale-110' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                      >{opt.label}</button>
                    ))}
                    {editForm.dueDateType === 'date' && (
                      <input type="date" value={editForm.dueDate} onChange={e => setEditForm(f => ({ ...f, dueDate: e.target.value }))} className="w-32 h-8 text-sm border border-slate-200 rounded-lg px-2.5 outline-none" />
                    )}
                    <select value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))} className="w-20 h-8 text-sm border border-slate-200 rounded-lg px-1.5 outline-none">
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                    <button onClick={submitEdit} className="h-8 px-3 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700">保存</button>
                    <button onClick={() => setEditing(null)} className="h-8 px-3 text-slate-400 text-xs hover:text-slate-600">取消</button>
                  </>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 truncate">{item.description}</p>
                    </div>
                    <span className="text-xs text-slate-500 w-20 text-right truncate">{item.owner || '未分配'}</span>
                    {((item as any).dueDateType || 'date') === 'continuous'
                      ? <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">持续</span>
                      : ((item as any).dueDateType === 'tbd'
                        ? <span className="text-xs text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded">待定</span>
                        : <span className="text-xs text-slate-400 w-24 text-right">{item.dueDate || '-'}</span>
                      )
                    }
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded w-8 text-center ${
                      item.priority === 'high' ? 'bg-red-100 text-red-600' :
                      item.priority === 'low' ? 'bg-green-100 text-green-600' :
                      'bg-slate-100 text-slate-500'
                    }`}>{item.priority === 'high' ? '高' : item.priority === 'low' ? '低' : '中'}</span>
                    {batch.status === 'draft' && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => openEdit(item)} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-blue-500" title="编辑">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-500" title="删除">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {batch.status === 'pushed' && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => openEdit(item)} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-blue-500" title="编辑（仅台账）">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => { if (confirm('确认删除此行动项？已推送的将同步作废 OA 记录。')) handleDelete(item.id); }} className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-slate-400 hover:text-red-500" title="删除并作废 OA">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
