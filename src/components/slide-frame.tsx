'use client';

import React, { useEffect, useRef, useState } from 'react';

// 设计稿尺寸：字号 px 按此画布设计；画布越小 → 缩放比越大 → 同屏字号越大。
// 1600×900 相比 1920×1080 视觉放大约 1.2 倍（投屏更易读）。
const DESIGN_W = 1600;
const DESIGN_H = 900;

/**
 * 固定设计稿 + 整体等比缩放的 16:9 幻灯片容器。
 *
 * 内部按固定设计稿渲染（字号、间距全部固定 px），
 * 再按容器实际尺寸 transform: scale() 等比缩放。
 * 电脑 1080p、4K 电视、投影仪上视觉比例完全一致，字体不会"变小"。
 */
export default function SlideFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setScale(Math.min(width / DESIGN_W, height / DESIGN_H));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full h-full overflow-hidden">
      <div
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: scale ? `scale(${scale})` : 'none',
          transformOrigin: 'center center',
          position: 'absolute',
          left: '50%',
          top: '50%',
          marginLeft: -DESIGN_W / 2,
          marginTop: -DESIGN_H / 2,
          visibility: scale ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}
