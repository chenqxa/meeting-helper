'use client';

import React, { useEffect, useState } from 'react';
import { Clock, User, FileText, Edit, Trash, Download, Lock, CheckCircle } from 'lucide-react';

interface OperationLog {
  id: number;
  meeting_id: string | null;
  action: string;
  operator: string;
  detail: any;
  ip_address: string | null;
  created_at: string;
}

interface OperationLogProps {
  meetingId?: string;
}

const ACTION_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  upload: { label: '上传', icon: FileText, color: 'bg-blue-100 text-blue-700' },
  transcribe: { label: '转写', icon: FileText, color: 'bg-purple-100 text-purple-700' },
  generate: { label: '生成', icon: FileText, color: 'bg-green-100 text-green-700' },
  edit: { label: '编辑', icon: Edit, color: 'bg-orange-100 text-orange-700' },
  confirm: { label: '确认', icon: CheckCircle, color: 'bg-emerald-100 text-emerald-700' },
  lock: { label: '锁定', icon: Lock, color: 'bg-red-100 text-red-700' },
  export: { label: '导出', icon: Download, color: 'bg-cyan-100 text-cyan-700' },
  delete: { label: '删除', icon: Trash, color: 'bg-red-100 text-red-700' },
  create: { label: '创建', icon: FileText, color: 'bg-green-100 text-green-700' },
};

export function OperationLog({ meetingId }: OperationLogProps) {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const url = meetingId 
          ? `/api/operations?meeting_id=${meetingId}`
          : '/api/operations';
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
          setLogs(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch operation logs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [meetingId]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return <div className="text-sm text-slate-400">加载中...</div>;
  }

  if (logs.length === 0) {
    return <div className="text-sm text-slate-400">暂无操作记录</div>;
  }

  return (
    <div className="operation-timeline">
      <div className="space-y-3">
        {logs.map((log) => {
          const actionConfig = ACTION_LABELS[log.action] || {
            label: log.action,
            icon: FileText,
            color: 'bg-slate-100 text-slate-700',
          };
          const Icon = actionConfig.icon;

          return (
            <div key={log.id} className="flex gap-3 items-start">
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${actionConfig.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-slate-700">{log.operator}</span>
                  <span className="text-xs text-slate-400">{formatTime(log.created_at)}</span>
                </div>
                <div className="text-sm text-slate-600 mb-1">
                  {actionConfig.label}
                  {log.detail?.summary && `：${log.detail.summary}`}
                </div>
                {log.detail && (
                  <div className="text-xs text-slate-400 bg-slate-50 rounded px-2 py-1">
                    {log.detail.target_type && (
                      <span className="mr-2">类型：{log.detail.target_type}</span>
                    )}
                    {log.detail.target_id && (
                      <span className="mr-2">ID：{log.detail.target_id}</span>
                    )}
                    {log.detail.changes && (
                      <pre className="mt-1 text-[10px] overflow-x-auto">
                        {JSON.stringify(log.detail.changes, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
