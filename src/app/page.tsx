'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { AudioRecorder } from '@/components/audio-recorder';
import {
  Mic, FileText, Upload, Clock, Sparkles,
  Search, Plus, AlertTriangle, CheckCircle2, ChevronRight,
  Users, Kanban, Radio, Trash2
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface MeetingItem {
  id: string;
  title: string;
  type: string;
  meeting_date: string;
  status: 'draft' | 'locked';
  participants: string[];
  has_low_confidence?: boolean;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-slate-100 text-slate-600' },
  locked: { label: '已锁定', color: 'bg-emerald-100 text-emerald-700' },
};

const TYPE_MAP: Record<string, string> = {
  weekly: '周会', review: '评审', retrospective: '复盘', general: '常规',
};

export default function WorkbenchPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [search, setSearch] = useState('');
  const [inputMode, setInputMode] = useState<'upload' | 'text' | 'voice'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [asrFailed, setAsrFailed] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [voiceText, setVoiceText] = useState('');

  useEffect(() => {
    fetch('/api/meetings/list')
      .then(r => r.json())
      .then(d => { if (d.success) setMeetings(d.data || []); })
      .catch(() => {});
  }, []);

  const filtered = meetings.filter((m: MeetingItem) =>
    m.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此会议？此操作不可恢复。')) return;
    try {
      const res = await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
      const r = await res.json();
      if (r.success) {
        setMeetings(prev => prev.filter(m => m.id !== id));
      } else {
        alert('删除失败: ' + (r.error || '未知错误'));
      }
    } catch (e) {
      alert('删除失败');
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleFileSelect = async (file: File) => {
    const allowed = ['.txt', '.docx', '.mp3', '.wav'];
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowed.includes(ext)) {
      alert('仅支持 .txt .docx .mp3 .wav 格式');
      return;
    }
    setUploadFile(file);
    setNewTitle(file.name.replace(/\.[^.]+$/, ''));

    // TXT / DOCX：自动提取文字内容
    if (['.txt', '.docx'].includes(ext)) {
      if (ext === '.txt') {
        // TXT 直接在浏览器读取，无需上传
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          setPasteText(text || '');
          setInputMode('text');
        };
        reader.readAsText(file, 'utf-8');
      } else {
        // DOCX 需要后端解析
        try {
          const form = new FormData();
          form.append('file', file);
          const res = await fetch('/api/parse-file', { method: 'POST', body: form });
          const data = await res.json();
          if (data.success) {
            setPasteText(data.text);
            setInputMode('text');
          } else {
            alert('DOCX 解析失败: ' + (data.error || '未知错误'));
          }
        } catch {
          alert('文件解析失败，请检查网络');
        }
      }
    }

    setShowNewForm(true);
    if (['.mp3', '.wav'].includes(ext)) setAsrFailed(false);
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) { alert('请填写会议主题'); return; }
    setIsCreating(true);
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          type: 'general',
          meetingDate: new Date().toISOString().split('T')[0],
          participants: [],
          organizer: '当前用户',
          inputType: inputMode,
          content: (inputMode === 'text' || inputMode === 'voice') ? pasteText : undefined,
        }),
      });
      const result = await res.json();
      if (result.success && result.data?.meetingId) {
        router.push(`/meeting/${result.data.meetingId}`);
      } else {
        alert(result.error || '创建失败');
      }
    } catch {
      alert('创建失败，请重试');
    } finally {
      setIsCreating(false);
    }
  };

  const pendingCount = meetings.filter(m => m.has_low_confidence && m.status === 'draft').length;

  return (
    <DashboardLayout>
      <div className="flex gap-0 h-[calc(100vh-4rem)] -m-6 overflow-hidden">

        {/* ── 左栏：会议台账列表 ── */}
        <div className="w-72 border-r border-slate-100 bg-white flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                placeholder="搜索会议..."
                value={search}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm bg-slate-50 border-slate-200"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400 text-sm gap-2">
                <FileText className="w-8 h-8 opacity-40" />
                <span>暂无会议记录</span>
              </div>
            ) : (
              filtered.map((m: MeetingItem) => (
                <div
                  key={m.id}
                  className="w-full px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => router.push(`/meeting/${m.id}`)}
                      className="flex-1 text-left"
                    >
                      <span className="text-sm font-medium text-slate-800 leading-tight line-clamp-2 group-hover:text-blue-600 transition-colors">
                        {m.title}
                      </span>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-slate-400">
                          {new Date(m.meeting_date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_MAP[m.status]?.color}`}>
                          {STATUS_MAP[m.status]?.label}
                        </span>
                        {m.type && (
                          <span className="text-xs text-slate-400">{TYPE_MAP[m.type] || m.type}</span>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                      className="p-1.5 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                      title="删除会议"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="p-3 border-t border-slate-100">
            <button
              onClick={() => { setShowNewForm(true); setInputMode('text'); }}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              新建会议
            </button>
          </div>
        </div>

        {/* ── 中栏：上传 / 输入区 ── */}
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 p-8 overflow-y-auto">
          {!showNewForm ? (
            <div className="w-full max-w-lg space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-slate-800">导入会议内容</h2>
                <p className="text-sm text-slate-500 mt-1">支持音频转写或直接粘贴文本</p>
              </div>

              {/* 拖拽上传区 */}
              <div
                onDragOver={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 scale-[1.01]'
                    : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.docx,.mp3,.wav"
                  className="hidden"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                />
                <Upload className={`w-10 h-10 mx-auto mb-3 transition-colors ${isDragging ? 'text-blue-500' : 'text-slate-400'}`} />
                <p className="text-sm font-medium text-slate-700">
                  {isDragging ? '松开即可上传' : '拖拽文件到此处，或点击选择'}
                </p>
                <p className="text-xs text-slate-400 mt-1">.txt · .docx · .mp3 · .wav</p>
                {uploadFile && (
                  <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-xs font-medium">
                    <FileText className="w-3.5 h-3.5" />
                    {uploadFile.name}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">或者</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* 音频录音转写 */}
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Radio className="w-4 h-4 text-purple-600" />
                  <label className="text-xs font-semibold text-purple-700 uppercase tracking-wide">
                    语音录音转文字
                  </label>
                </div>
                <AudioRecorder
                  onRecordingComplete={(blob, duration) => {
                    console.log('Recording completed:', duration, 'seconds');
                  }}
                  onTranscriptReceived={(text) => {
                    setPasteText(text);
                    setVoiceText(text);
                    setInputMode('voice');
                  }}
                  maxDuration={600}
                />
                {voiceText && (
                  <>
                    <div className="mt-3 p-3 bg-white border border-slate-200 rounded-lg max-h-[150px] overflow-y-auto">
                      <p className="text-sm text-slate-800 line-clamp-4">{voiceText}</p>
                    </div>
                    <button
                      onClick={() => { setShowNewForm(true); setInputMode('voice'); }}
                      className="mt-3 w-full py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      使用转写内容继续 →
                    </button>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">或者</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* 文本粘贴兜底 */}
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  {asrFailed ? '⚠ ASR转写失败 — 粘贴文本作为兜底' : '直接粘贴转写文本'}
                </label>
                <Textarea
                  placeholder="在此粘贴会议转写文本..."
                  value={pasteText}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setPasteText(e.target.value); if (e.target.value) setInputMode('text'); }}
                  rows={4}
                  className={`mt-1.5 resize-none text-sm ${asrFailed ? 'border-amber-400 bg-amber-50' : ''}`}
                />
                {pasteText && (
                  <button
                    onClick={() => { setShowNewForm(true); setInputMode('text'); }}
                    className="mt-2 text-xs text-blue-600 hover:underline font-medium"
                  >
                    继续 → 填写会议信息
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* 快速建会表单 */
            <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">完善会议信息</h3>
                <button onClick={() => setShowNewForm(false)} className="text-slate-400 hover:text-slate-600 text-xs">取消</button>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">会议主题 *</label>
                <Input
                  autoFocus
                  placeholder="例如：产品双周会 2024-W12"
                  value={newTitle}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleCreate()}
                  className="mt-1"
                />
              </div>
              {inputMode === 'text' && !pasteText && (
                <div>
                  <label className="text-xs font-medium text-slate-500">转写文本</label>
                  <Textarea
                    placeholder="粘贴会议记录..."
                    value={pasteText}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPasteText(e.target.value)}
                    rows={4}
                    className="mt-1 resize-none text-sm"
                  />
                </div>
              )}
              {uploadFile && (
                <div className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg text-xs text-slate-600 border border-slate-200">
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{uploadFile.name}</span>
                </div>
              )}
              <button
                onClick={handleCreate}
                disabled={isCreating || !newTitle.trim()}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isCreating ? (
                  <><Clock className="w-4 h-4 animate-spin" /> 生成中...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> 生成纪要</>
                )}
              </button>
            </div>
          )}
        </div>

        {/* ── 右栏：快捷操作 ── */}
        <div className="w-60 border-l border-slate-100 bg-white flex flex-col flex-shrink-0 p-4 gap-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">快捷操作</p>

          <button
            onClick={() => router.push('/kanban')}
            className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Kanban className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 group-hover:text-blue-700">行动项看板</p>
              <p className="text-xs text-slate-400">跨会议跟踪</p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto group-hover:text-blue-400" />
          </button>

          <button
            onClick={() => { setShowNewForm(true); setInputMode('upload'); }}
            className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-purple-50 border border-slate-200 hover:border-purple-300 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
              <Upload className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 group-hover:text-purple-700">上传文件</p>
              <p className="text-xs text-slate-400">音频/文档</p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto group-hover:text-purple-400" />
          </button>

          <button
            onClick={() => { setShowNewForm(true); setInputMode('text'); }}
            className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-teal-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 group-hover:text-teal-700">粘贴文本</p>
              <p className="text-xs text-slate-400">直接输入</p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto group-hover:text-teal-400" />
          </button>

          <button
            onClick={() => { setShowNewForm(true); setInputMode('upload'); }}
            className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Mic className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 group-hover:text-blue-700">实时录音</p>
              <p className="text-xs text-slate-400">开始新会议</p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300 ml-auto group-hover:text-blue-400" />
          </button>

          {/* 待确认提醒 */}
          {pendingCount > 0 && (
            <div className="mt-auto p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-semibold text-amber-700">待确认行动项</span>
              </div>
              <p className="text-xs text-amber-600">{pendingCount} 条低置信度行动项需要确认</p>
              <button
                onClick={() => router.push('/kanban')}
                className="mt-2 w-full text-xs text-amber-700 font-medium bg-amber-100 hover:bg-amber-200 px-2 py-1.5 rounded-lg transition-colors"
              >
                前往审核 →
              </button>
            </div>
          )}

          <div className="mt-auto pt-3 border-t border-slate-100 space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>{meetings.filter((m: MeetingItem) => m.status === 'locked').length} 条已锁定</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>{meetings.filter((m: MeetingItem) => m.status === 'draft').length} 条草稿中</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span>共 {meetings.length} 次会议</span>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
