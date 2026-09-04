'use client';

import React, { useEffect, useRef, useState } from 'react';

// 设计稿尺寸：字号 px 按此画布设计；画布越小 → 缩放比越大 → 同屏字号越大。
// 1200×675（2026-08-31，用户要求默认（非 📺 放大）模式下字也要够大、看全）：
//   1080p 缩放比 1.6（vs 原 1600×900 的 1.2，放大 1.33 倍；vs 中间档 1360×765 的 1.41，再大 1.14 倍）。
// 副作用：单屏可见内容约比 1600×900 少 25%、比 1360×765 少 12%（表格少几行），
// 属"字大↔信息多"的正常取舍；如需看全可点 ‹/› 翻页或 F 沉浸。
// 另：📺 大屏模式额外 ×1.25 放大，复制模式投屏应急用，四周约裁 10%。
const DESIGN_W = 1200;
const DESIGN_H = 675;

// 大屏模式：整体 ×1.25 强行放大（四周约裁 10%，复制模式投屏应急用）。
// 正解是"扩展模式投屏 + F 全屏"：视口=电视原生分辨率，等比自动放大且零裁剪。
export const BOOST_STORAGE_KEY = 'slide_frame_boost';
export const BOOST_CHANGE_EVENT = 'slide-frame-boost-change';

export function isSlideBoostOn(): boolean {
  try { return localStorage.getItem(BOOST_STORAGE_KEY) === '1'; } catch { return false; }
}

export function toggleSlideBoost(): boolean {
  const next = !isSlideBoostOn();
  try { localStorage.setItem(BOOST_STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(BOOST_CHANGE_EVENT, { detail: next }));
  return next;
}

/**
 * 固定设计稿 + 整体等比缩放的 16:9 幻灯片容器。
 *
 * 内部按固定设计稿渲染（字号、间距全部固定 px），
 * 再按容器实际尺寸 transform: scale() 等比缩放。
 * 电脑 1080p、4K 电视、投影仪上视觉比例完全一致，字体不会"变小"。
 *
 * 大屏模式（📺）：scale × 1.25，适配电视投屏远距离观看；状态存 localStorage、
 * 通过自定义事件跨组件同步，三个看板页共享同一切换。
 */
export default function SlideFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [boost, setBoost] = useState(false);

  useEffect(() => {
    setBoost(isSlideBoostOn());
    const onToggle = (e: Event) => setBoost((e as CustomEvent<boolean>).detail);
    window.addEventListener(BOOST_CHANGE_EVENT, onToggle);
    return () => window.removeEventListener(BOOST_CHANGE_EVENT, onToggle);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        // 等比缩放：短板决定（任何容器比例都不变形）。
        // 大屏模式在此基础上 ×1.25 强行放大（复制模式投屏应急用，四周约裁 10%）；
        // 注：不裁剪的放大只能靠增大视口——扩展模式投屏 + F 全屏（视口=电视原生分辨率时自动放大 1.2~2.4 倍）
        setScale(Math.min(width / DESIGN_W, height / DESIGN_H) * (boost ? 1.25 : 1));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [boost]);

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
