'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  clearable?: boolean;
  dropdownWidth?: 'full' | 'auto';
}

export function SearchableSelect({ value, onChange, options, placeholder = '请选择', className = '', clearable = true, dropdownWidth = 'full' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 去重 options 避免重复 key
  const uniqueOptions = Array.from(new Set(options));
  const filtered = query ? uniqueOptions.filter(o => o.toLowerCase().includes(query.toLowerCase())) : uniqueOptions;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = () => {
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* 触发按钮 */}
      <div
        onClick={handleOpen}
        className="flex items-center h-9 w-full border border-slate-200 rounded-lg px-3 bg-white cursor-pointer hover:border-blue-400 transition-colors text-sm gap-2"
      >
        <span className={`flex-1 truncate ${value ? 'text-slate-700' : 'text-slate-400'}`}>
          {value || placeholder}
        </span>
        {clearable && value ? (
          <X className="w-3.5 h-3.5 text-slate-300 hover:text-slate-500 flex-shrink-0"
            onClick={e => { e.stopPropagation(); onChange(''); }} />
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </div>

      {/* 下拉面板 */}
      {open && (
        <div className={`absolute z-50 top-full mt-1 left-0 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden ${
          dropdownWidth === 'full' ? 'right-0' : 'min-w-full min-w-[200px]'
        }`}>
          {/* 搜索框 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜索..."
              className="flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder-slate-300"
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQuery(''); }
                if (e.key === 'Enter' && filtered.length === 1) handleSelect(filtered[0]);
              }}
            />
          </div>
          {/* 选项列表 */}
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-4 py-2.5 text-sm text-slate-300 text-center">无匹配结果</li>
            ) : filtered.map(o => (
              <li key={o}
                onClick={() => handleSelect(o)}
                className={`px-4 py-2 text-sm cursor-pointer transition-colors ${
                  o === value ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {o}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
