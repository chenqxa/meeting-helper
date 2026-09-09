'use client';

// 看板权限校验 Hook：无权限时返回 denied=true，页面显示"无权访问"
import { useEffect, useState } from 'react';

export function useBoardPermission(boardKey: 'weekly' | 'monthly' | 'production') {
  const [denied, setDenied] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/board-permissions/check?key=${boardKey}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (!j.success || !j.data?.allowed) setDenied(true);
      })
      .catch(() => {
        if (!cancelled) setDenied(false); // 网络错误不拦截（降级放行）
      })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [boardKey]);

  return { denied, checking };
}

// 无权访问提示页
export function BoardDeniedPage({ boardName }: { boardName: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <div className="text-center space-y-1">
        <p className="text-lg font-bold text-slate-700">无权访问</p>
        <p className="text-sm text-slate-400">您没有「{boardName}」的查看权限，请联系管理员开通</p>
      </div>
    </div>
  );
}
