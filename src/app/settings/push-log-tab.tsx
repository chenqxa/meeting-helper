'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Send, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';

interface PushLogRow {
  id: string;
  pushType: string;
  channel: string;
  meetingType?: string | null;
  recipient?: string | null;
  success: boolean;
  error?: string | null;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  todo: '待办推送',
  due_reminder: '到期提醒',
  auto_x: '超期打X',
  continuous: '持续项',
  batch: '批次推送',
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function PushLogTab() {
  const [logs, setLogs] = useState<PushLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('');
  const [name, setName] = useState('陈巧霞');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/push/logs${type ? `?type=${type}` : ''}`).then((x) => x.json());
      if (r.success) setLogs(r.data || []);
      else toast.error(r.error || '加载推送日志失败');
    } catch {
      toast.error('加载推送日志失败');
    }
    setLoading(false);
  }, [type]);

  useEffect(() => { load(); }, [load]);

  const sendTest = async () => {
    if (!name.trim()) { toast.error('请输入接收人姓名'); return; }
    setSending(true);
    try {
      const r = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      }).then((x) => x.json());
      if (r.success) toast.success(`测试卡片已发送给 ${name.trim()}`);
      else toast.error(r.error || '发送失败（见下方日志）');
      await load();
    } catch {
      toast.error('发送失败');
    }
    setSending(false);
  };

  return (
    <div className="space-y-4">
      {/* 企微自测 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-800">企业微信推送自测</p>
          <p className="text-xs text-slate-400 mt-0.5">只发给指定的一个人，用于核验 userid 匹配与实际到达（不会群发）</p>
        </div>
        <div className="px-6 py-4 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="接收人姓名"
            className="h-9 w-56 text-sm border border-slate-200 rounded-lg px-3 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400"
          />
          <button
            onClick={sendTest}
            disabled={sending}
            className="h-9 px-4 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" /> {sending ? '发送中…' : '发送测试'}
          </button>
        </div>
      </div>

      {/* 日志 */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">推送日志</p>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-8 text-xs border border-slate-200 rounded-lg px-2 bg-white text-slate-600 focus:outline-none"
            >
              <option value="">全部类型</option>
              <option value="todo">待办推送</option>
              <option value="due_reminder">到期提醒</option>
              <option value="auto_x">超期打X</option>
              <option value="continuous">持续项</option>
              <option value="batch">批次推送</option>
            </select>
          </div>
          <button onClick={load} title="刷新"
            className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50/50">
                <th className="text-left font-semibold px-5 py-2.5">时间</th>
                <th className="text-left font-semibold px-3 py-2.5">类型</th>
                <th className="text-left font-semibold px-3 py-2.5">渠道</th>
                <th className="text-left font-semibold px-3 py-2.5">收件人</th>
                <th className="text-left font-semibold px-3 py-2.5">结果</th>
                <th className="text-left font-semibold px-3 py-2.5">失败原因</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id} className="border-b border-slate-50">
                  <td className="px-5 py-2 text-slate-600 whitespace-nowrap">{fmt(row.createdAt)}</td>
                  <td className="px-3 py-2 text-slate-700">{TYPE_LABEL[row.pushType] || row.pushType}{row.meetingType ? ` · ${row.meetingType}` : ''}</td>
                  <td className="px-3 py-2 text-slate-500">{row.channel === 'wecom' ? '企业微信' : 'OA'}</td>
                  <td className="px-3 py-2 text-slate-700">{row.recipient || '—'}</td>
                  <td className="px-3 py-2">
                    {row.success
                      ? <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" />成功</span>
                      : <span className="inline-flex items-center gap-1 text-red-500"><XCircle className="w-3.5 h-3.5" />失败</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400 max-w-[360px] truncate" title={row.error || ''}>{row.error || ''}</td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">暂无记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
