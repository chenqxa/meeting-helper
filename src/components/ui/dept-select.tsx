'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';

// 可输入 + 下拉建议 的部门选择器
// 输入框可直接打字自定义，也可从下拉选已有部门
interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onBlur?: (value: string) => void;
}

export function DeptSelect({ value, onChange, options, onBlur }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uniqueOptions = Array.from(new Set(options));
  const filtered = draft ? uniqueOptions.filter(o => o.toLowerCase().includes(draft.toLowerCase())) : uniqueOptions;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const commit = () => {
    const finalValue = draft.trim();
    onChange(finalValue);
    setOpen(false);
    onBlur?.(finalValue);
  };

  return (
    <div ref={containerRef} className="relative w-28">
      <div className="flex items-center border border-slate-200 rounded-lg bg-white focus-within:ring-1 focus-within:ring-blue-300 focus-within:border-blue-300">
        <input
          ref={inputRef}
          value={draft}
          autoFocus
          onChange={e => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setTimeout(() => { if (!containerRef.current?.contains(document.activeElement)) commit(); }, 120); }}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setOpen(false); onBlur?.(draft.trim()); }
            if (e.key === 'Tab') commit();
          }}
          placeholder="输入或选择"
          className="flex-1 h-7 w-full text-sm px-1.5 outline-none bg-transparent text-slate-700 placeholder:text-slate-300"
        />
        <button type="button" onClick={() => setOpen(o => !o)} className="px-1 text-slate-400 hover:text-slate-600 flex-shrink-0">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="flex-1 text-xs text-slate-400 truncate">输入自定义，或从列表选择</span>
          </div>
          <ul className="max-h-40 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-slate-400">
                无匹配，回车使用「<span className="font-medium text-slate-600">{draft || '输入值'}</span>」
              </li>
            ) : filtered.map(o => (
              <li key={o}
                onClick={() => { onChange(o); setDraft(o); setOpen(false); onBlur?.(o); }}
                className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${o === value ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}
              >{o}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
