'use client';

import React, { useState } from 'react';
import { Users, Check } from 'lucide-react';

interface SpeakerLabelDialogProps {
  speakers: string[];          // ['角色1', '角色2', ...]
  labeledText: string;         // 带角色标注的原始转写文本
  onConfirm: (mapping: Record<string, string>, finalText: string) => void;
  onSkip: (text: string) => void;
}

export function SpeakerLabelDialog({
  speakers,
  labeledText,
  onConfirm,
  onSkip,
}: SpeakerLabelDialogProps) {
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(speakers.map(s => [s, '']))
  );

  const handleConfirm = () => {
    // 将 "角色1: xxx" 替换为 "张三: xxx"
    let finalText = labeledText;
    Object.entries(names).forEach(([role, name]) => {
      if (name.trim()) {
        finalText = finalText.replaceAll(role + ':', name.trim() + ':');
      }
    });
    onConfirm(names, finalText);
  };

  const allFilled = speakers.every(s => names[s]?.trim());

  // 预览文本（替换后）
  const previewText = () => {
    let preview = labeledText;
    Object.entries(names).forEach(([role, name]) => {
      if (name.trim()) {
        preview = preview.replaceAll(role + ':', name.trim() + ':');
      }
    });
    return preview;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* 头部 */}
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">识别到 {speakers.length} 位说话人</h2>
              <p className="text-sm text-slate-500">请填写每位说话人的姓名，方便任务分配</p>
            </div>
          </div>
        </div>

        {/* 说话人姓名填写 */}
        <div className="p-6 space-y-4">
          {speakers.map((role) => (
            <div key={role} className="flex items-center gap-4">
              <div className="w-24 text-sm font-medium text-slate-600 bg-slate-100 px-3 py-2 rounded-lg text-center flex-shrink-0">
                {role}
              </div>
              <span className="text-slate-400">→</span>
              <input
                type="text"
                placeholder="请输入姓名"
                value={names[role] || ''}
                onChange={e => setNames(prev => ({ ...prev, [role]: e.target.value }))}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-100"
                autoFocus={role === speakers[0]}
              />
            </div>
          ))}
        </div>

        {/* 转写预览 */}
        <div className="px-6 pb-4">
          <p className="text-xs font-medium text-slate-500 mb-2">转写预览</p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-32 overflow-y-auto">
            <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans">
              {previewText().slice(0, 400)}{previewText().length > 400 ? '...' : ''}
            </pre>
          </div>
        </div>

        {/* 按钮 */}
        <div className="p-6 pt-2 flex gap-3">
          <button
            onClick={() => onSkip(labeledText)}
            className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
          >
            跳过，不标注姓名
          </button>
          <button
            onClick={handleConfirm}
            disabled={!allFilled}
            className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" />
            确认，使用标注后的文本
          </button>
        </div>
      </div>
    </div>
  );
}
