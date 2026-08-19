'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  pending:    { text: '待处理', color: 'bg-gray-100 text-gray-700' },
  in_progress:{ text: '进行中', color: 'bg-blue-100 text-blue-700' },
  done:       { text: '已完成', color: 'bg-green-100 text-green-700' },
  completed:  { text: '已完成', color: 'bg-green-100 text-green-700' },
  confirmed:  { text: '已确认', color: 'bg-green-100 text-green-700' },
  blocked:    { text: '已阻塞', color: 'bg-red-100 text-red-700' },
};

export default function TaskConfirmPage() {
  const { taskKey } = useParams<{ taskKey: string }>();
  const searchParams = useSearchParams();
  const sig = searchParams.get('sig') || '';

  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<any>(null);
  const [meeting, setMeeting] = useState<any>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState('');
  const [remark, setRemark] = useState('');
  const [showRemark, setShowRemark] = useState(false);
  const [pendingAction, setPendingAction] = useState('');

  useEffect(() => {
    fetch(`/api/tasks/confirm?taskKey=${encodeURIComponent(taskKey)}&sig=${sig}`)
      .then(r => r.json())
      .then(r => {
        if (r.success) {
          setTask(r.data.item);
          setMeeting(r.data.meeting);
          if (['done', 'completed', 'confirmed'].includes(r.data.item.status)) {
            setDone('already');
          }
        } else {
          setError(r.error || '链接无效或已过期');
        }
      })
      .catch(() => setError('网络错误，请重试'))
      .finally(() => setLoading(false));
  }, [taskKey, sig]);

  const handleAction = async (action: string) => {
    if (action !== 'done' && !showRemark) {
      setPendingAction(action);
      setShowRemark(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/tasks/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskKey, sig, action, remark }),
      });
      const r = await res.json();
      if (r.success) {
        setDone(action);
        setShowRemark(false);
      } else {
        alert(r.error || '操作失败');
      }
    } catch {
      alert('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-red-600 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_LABEL[task?.status] || { text: task?.status, color: 'bg-gray-100 text-gray-700' };

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-10 px-4">
      <div className="bg-white rounded-2xl shadow-md w-full max-w-md overflow-hidden">
        {/* 顶部 */}
        <div className="bg-blue-700 px-6 py-5">
          <p className="text-blue-200 text-xs mb-1">来自会议纪要系统</p>
          <h1 className="text-white text-lg font-semibold leading-snug">
            {meeting?.title}
          </h1>
          <p className="text-blue-300 text-xs mt-1">{meeting?.meetingDate?.split('T')[0]}</p>
        </div>

        {/* 任务详情 */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-start justify-between gap-3 mb-3">
            <p className="text-gray-900 font-medium leading-snug">{task?.description}</p>
            <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.color}`}>
              {statusInfo.text}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm text-gray-500">
            <span>负责人：<span className="text-gray-800">{task?.assignee || task?.owner || '-'}</span></span>
            <span>截止日期：<span className="text-gray-800">{task?.dueDate || task?.due_date || '未设定'}</span></span>
            <span>优先级：<span className="text-gray-800">{PRIORITY_LABEL[task?.priority] || task?.priority || '-'}</span></span>
            {task?.confirmedAt && (
              <span>确认时间：<span className="text-gray-800">{new Date(task.confirmedAt).toLocaleString('zh-CN')}</span></span>
            )}
          </div>
        </div>

        {/* 操作区 */}
        <div className="px-6 py-5">
          {done === 'already' || done === 'done' ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-2">✅</div>
              <p className="text-green-700 font-medium">已标记为完成，谢谢！</p>
            </div>
          ) : done === 'blocked' ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-2">🚧</div>
              <p className="text-red-700 font-medium">已标记为阻塞，请联系负责人跟进。</p>
            </div>
          ) : done === 'delay' ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-2">⏳</div>
              <p className="text-blue-700 font-medium">已标记为延期，请尽快完成。</p>
            </div>
          ) : showRemark ? (
            <div className="space-y-3">
              <label className="text-sm text-gray-600 font-medium">
                {pendingAction === 'blocked' ? '描述阻塞原因（可选）' : '填写延期原因或新截止日期（可选）'}
              </label>
              <textarea
                value={remark}
                onChange={e => setRemark(e.target.value)}
                rows={3}
                placeholder="请输入备注..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction(pendingAction)}
                  disabled={submitting}
                  className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? '提交中...' : '确认提交'}
                </button>
                <button
                  onClick={() => { setShowRemark(false); setPendingAction(''); }}
                  className="px-4 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-500 mb-3">请确认该任务的当前状态：</p>
              <button
                onClick={() => handleAction('done')}
                disabled={submitting}
                className="w-full bg-green-600 text-white rounded-lg py-3 text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                ✅ 已完成
              </button>
              <button
                onClick={() => handleAction('delay')}
                disabled={submitting}
                className="w-full bg-yellow-500 text-white rounded-lg py-3 text-sm font-medium hover:bg-yellow-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                ⏳ 需要延期
              </button>
              <button
                onClick={() => handleAction('blocked')}
                disabled={submitting}
                className="w-full bg-red-500 text-white rounded-lg py-3 text-sm font-medium hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                🚧 有阻塞
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
