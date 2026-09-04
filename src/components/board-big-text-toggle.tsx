'use client';

import React, { useEffect, useState } from 'react';
import { MonitorUp } from 'lucide-react';
import { isSlideBoostOn, toggleSlideBoost } from '@/components/slide-frame';
import { cn } from '@/lib/utils';

/**
 * 看板「大屏模式」切换按钮（电视投屏用）。
 * 开启后幻灯片整体放大 1.25 倍，状态 localStorage 记忆、三个看板页共享。
 * immersive 属性用于沉浸模式下配反色。
 */
export default function BoardBigTextToggle({ immersive }: { immersive?: boolean }) {
  const [on, setOn] = useState(false);

  useEffect(() => { setOn(isSlideBoostOn()); }, []);

  return (
    <button
      onClick={() => setOn(toggleSlideBoost())}
      title={on ? '大屏模式已开启（放大1.25倍），点击恢复' : '大屏模式：电视投屏放大显示'}
      className={cn(
        'flex items-center justify-center w-7 h-7 rounded-lg transition-colors',
        on
          ? 'bg-amber-500 text-white'
          : immersive
            ? 'bg-white/10 text-white hover:bg-white/20'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
      )}
    >
      <MonitorUp className="w-3.5 h-3.5" />
    </button>
  );
}
