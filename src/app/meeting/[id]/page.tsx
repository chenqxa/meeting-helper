'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  Download, Search, Lock, Check, Clock, User, Calendar, FileText, Sparkles,
  AlertTriangle, Plus, Trash2, ChevronLeft, RefreshCw,
  CheckCircle2, Shield, Eye, Network, GitBranch
} from 'lucide-react';
import { MeetingMindMap } from '@/components/mindmap/meeting-mindmap';
import { SummaryActionSplit } from '@/components/summary-action-split';

interface ActionItem {
  id: string;
  description: string;
  owner?: string | null;
  due_date?: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'confirmed' | 'in_progress' | 'done' | 'blocked';
  confidence_owner: number;
  confidence_date: number;
  source_sentence?: string;
  initial_result?: string | null;  // AI预测的初步结果/交付标准
  confirmed_by?: string;
  confirmed_at?: string;
}

interface SummarySection {
  section_type: 'agenda' | 'conclusion' | 'risk' | 'decision' | 'next_step';
  content: string;
  confidence: number;
}

interface Meeting {
  id: string;
  title: string;
  type: string;
  meeting_time?: string;
  meeting_date?: string;
  meetingDate?: string;
  status: 'draft' | 'locked' | 'archived' | 'review';
  organizer?: string;
  participants?: string[];
  content?: string;
  input_content?: string;
  transcript?: string;
  locked_version?: number;
  summary?: any;
}

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
};
const SECTION_LABEL: Record<string, string> = {
  agenda: '议题', conclusion: '结论', risk: '风险', decision: '决策', next_step: '下一步',
};
const SECTION_COLOR: Record<string, string> = {
  agenda: 'text-blue-700 bg-blue-50 border-blue-200',
  conclusion: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  risk: 'text-red-700 bg-red-50 border-red-200',
  decision: 'text-purple-700 bg-purple-50 border-purple-200',
  next_step: 'text-amber-700 bg-amber-50 border-amber-200',
};

function ConfidenceBadge({ value, label }: { value: number; label: string }) {
  const color = value >= 0.7 ? 'bg-emerald-100 text-emerald-700' : value >= 0.4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${color}`}>
      {value < 0.7 && <AlertTriangle className="w-3 h-3" />}
      {label} {Math.round(value * 100)}%
    </span>
  );
}

export default function MeetingEditorPage() {
  const params = useParams();
  const meetingId = params.id as string;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [summary, setSummary] = useState<SummarySection[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'actions' | 'mindmap' | 'linked' | 'export'>('summary');
  const [searchText, setSearchText] = useState('');
  const [editingAction, setEditingAction] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<ActionItem>>({});
  const [aiTimeout, setAiTimeout] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadMeeting(); }, [meetingId]);

  const convertSummary = (raw: any): SummarySection[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const sections: SummarySection[] = [];
    if (raw.overview) sections.push({ section_type: 'agenda', content: raw.overview, confidence: 0.8 });
    raw.keyTopics?.forEach((t: any) => sections.push({ section_type: 'agenda', content: `${t.topic}: ${t.description}`, confidence: 0.7 }));
    raw.decisions?.forEach((d: any) => sections.push({ section_type: 'decision', content: `${d.decision}\n依据: ${d.rationale}\n影响: ${d.impact}`, confidence: 0.8 }));
    raw.risks?.forEach((r: any) => sections.push({ section_type: 'risk', content: `${r.risk}\n应对: ${r.mitigation}`, confidence: 0.7 }));
    raw.nextSteps?.forEach((s: any) => sections.push({ section_type: 'next_step', content: `${s.step}${s.owner ? ` (负责人: ${s.owner})` : ''}${s.timeline ? ` (时间: ${s.timeline})` : ''}`, confidence: 0.8 }));
    return sections;
  };

  const mapActionItems = (items: any[]) => items.map((item: any) => ({
    id: item.id,
    description: item.description,
    owner: item.assignee || item.owner || null,
    due_date: item.dueDate || item.due_date || null,
    priority: item.priority || 'medium',
    status: item.status || 'pending',
    confidence_owner: item.confidence?.assignee ?? item.confidence_owner ?? 0.5,
    confidence_date: item.confidence?.dueDate ?? item.confidence_date ?? 0.5,
    source_sentence: item.sourceText || item.source_sentence || '',
    initial_result: item.initialResult || item.initial_result || null,
  }));

  const loadMeeting = async () => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}`);
      const r = await res.json();
      if (r.success) {
        setMeeting(r.data.meeting);
        setSummary(convertSummary(r.data.summary));
        setActionItems(mapActionItems(r.data.actionItems || []));
      }
    } catch { /* silent */ }
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setAiTimeout(false);
    const timer = setTimeout(() => setAiTimeout(true), 120_000);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/generate`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId }),
      });
      const r = await res.json();
      clearTimeout(timer);
      if (r.success) {
        // Convert backend data to frontend format
        const summaryData = r.data.summary;
        const actionItemsData = mapActionItems(r.data.actionItems || []);

        // Convert structured summary to SummarySection format
        const summarySections: SummarySection[] = [];
        
        // Add overview
        if (summaryData.overview) {
          summarySections.push({
            section_type: 'agenda',
            content: summaryData.overview,
            confidence: 0.8
          });
        }

        // Add key topics
        summaryData.keyTopics?.forEach((topic: any) => {
          summarySections.push({
            section_type: 'agenda',
            content: `${topic.topic}: ${topic.description}`,
            confidence: 0.7
          });
        });

        // Add decisions
        summaryData.decisions?.forEach((decision: any) => {
          summarySections.push({
            section_type: 'decision',
            content: `${decision.decision}\n\nRationale: ${decision.rationale}\nImpact: ${decision.impact}`,
            confidence: 0.8
          });
        });

        // Add risks
        summaryData.risks?.forEach((risk: any) => {
          summarySections.push({
            section_type: 'risk',
            content: `${risk.risk}\n\nMitigation: ${risk.mitigation}`,
            confidence: 0.7
          });
        });

        // Add next steps
        summaryData.nextSteps?.forEach((step: any) => {
          summarySections.push({
            section_type: 'next_step',
            content: `${step.step}${step.owner ? ` (Owner: ${step.owner})` : ''}${step.timeline ? ` (Timeline: ${step.timeline})` : ''}`,
            confidence: 0.8
          });
        });

        setSummary(summarySections);
        setActionItems(actionItemsData);
        // Reload meeting info only (summary already set above)
        const mRes = await fetch(`/api/meetings/${meetingId}`);
        const mR = await mRes.json();
        if (mR.success) setMeeting(mR.data.meeting);
      } else { alert(r.error || '生成失败'); }
    } catch { alert('生成失败，请重试'); clearTimeout(timer); }
    finally { setIsGenerating(false); }
  };

  const hasUnconfirmedLow = actionItems.some(
    (a: ActionItem) => (a.confidence_owner < 0.7 || a.confidence_date < 0.7) && a.status === 'pending'
  );

  const handleLock = async () => {
    if (hasUnconfirmedLow) { alert('存在未确认的低置信度行动项，请先逐一确认后再锁定版本'); return; }
    setIsLocking(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/lock`, { method: 'POST' });
      const r = await res.json();
      if (r.success) await loadMeeting();
      else alert(r.error || '锁定失败');
    } catch { alert('锁定失败'); }
    finally { setIsLocking(false); }
  };

  const handleExport = async (format: 'word' | 'pdf') => {
    if (meeting?.status !== 'locked') { alert('请先锁定版本再导出'); return; }
    try {
      const res = await fetch(`/api/meetings/${meetingId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      const r = await res.json();
      if (r.success) {
        const a = document.createElement('a');
        a.href = r.data.fileUrl;
        a.download = r.data.filename;
        a.click();
      }
    } catch { alert('导出失败'); }
  };

  const confirmAction = useCallback(async (id: string) => {
    setActionItems((prev: ActionItem[]) => prev.map((a: ActionItem) => a.id === id ? { ...a, status: 'confirmed' as const, confirmed_by: '当前用户', confirmed_at: new Date().toISOString() } : a));
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed', confirmed_by: '当前用户' }),
    }).catch(() => {});
  }, []);

  const startEdit = (item: ActionItem) => {
    setEditingAction(item.id);
    setEditBuf({ description: item.description, owner: item.owner, due_date: item.due_date, priority: item.priority });
  };

  const saveEdit = useCallback(async (id: string) => {
    setActionItems((prev: ActionItem[]) => prev.map((a: ActionItem) => a.id === id ? { ...a, ...editBuf } : a));
    setEditingAction(null);
    await fetch(`/api/actions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editBuf),
    }).catch(() => {});
  }, [editBuf]);

  const deleteAction = useCallback(async (id: string) => {
    setActionItems((prev: ActionItem[]) => prev.filter((a: ActionItem) => a.id !== id));
    await fetch(`/api/actions/${id}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const addAction = () => {
    const newItem: ActionItem = {
      id: `new-${Date.now()}`,
      description: '新行动项',
      owner: null, due_date: null,
      priority: 'medium', status: 'confirmed',
      confidence_owner: 1, confidence_date: 1,
    };
    setActionItems((prev: ActionItem[]) => [...prev, newItem]);
    startEdit(newItem);
  };

  const transcript = meeting?.content || meeting?.input_content || meeting?.transcript || '';
  const isLocked = meeting?.status === 'locked';

  if (!meeting) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent mx-auto mb-3" />
            <p className="text-sm text-slate-500">加载中...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* ── 顶栏 ── */}
      <div className="flex items-center justify-between mb-4 -mt-2">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => window.history.back()} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0">
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900 truncate">{meeting.title}</h1>
            <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
              {meeting.meeting_time || meeting.meeting_date ? (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(meeting.meeting_time || meeting.meeting_date || '').toLocaleDateString('zh-CN')}
                </span>
              ) : null}
              {meeting.participants?.length ? (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {meeting.participants.slice(0, 3).join('、')}{meeting.participants.length > 3 ? ` 等${meeting.participants.length}人` : ''}
                </span>
              ) : null}
              {isLocked && (
                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                  <Lock className="w-3 h-3" /> 已锁定 v{meeting.locked_version}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasUnconfirmedLow && !isLocked && (
            <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5" />
              {actionItems.filter(a => (a.confidence_owner < 0.7 || a.confidence_date < 0.7) && a.status === 'pending').length} 项待确认
            </span>
          )}
          {!isLocked && (
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {isGenerating ? '生成中...' : '重新生成'}
            </button>
          )}
          <button
            onClick={handleLock}
            disabled={isLocked || isLocking || hasUnconfirmedLow}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isLocked
                ? 'bg-emerald-100 text-emerald-700 cursor-default'
                : hasUnconfirmedLow
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isLocked ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            {isLocked ? '已锁定' : isLocking ? '锁定中...' : '锁定版本'}
          </button>
        </div>
      </div>

      {/* AI超时提示 */}
      {aiTimeout && (
        <div className="mb-3 flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>AI生成超时，已返回部分结果</span>
          <button onClick={handleGenerate} className="ml-auto flex items-center gap-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> 重试
          </button>
        </div>
      )}

      {/* ── 双栏主体 ── */}
      <div className="flex gap-4 h-[calc(100vh-10rem)] overflow-hidden">

        {/* ─ 左栏：转写文本 ─ */}
        <div className="w-[42%] bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden flex-shrink-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="text-sm font-medium text-slate-700">原始转写文本</span>
            <div className="ml-auto relative flex-1 max-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                ref={searchRef}
                placeholder="搜索..."
                value={searchText}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
                className="w-full pl-7 pr-2 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {!transcript ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm gap-2">
                <FileText className="w-10 h-10 opacity-30" />
                <span>暂无转写文本</span>
              </div>
            ) : (
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                {searchText.trim()
                  ? transcript.split(new RegExp(`(${searchText})`, 'gi')).map((part: string, i: number) =>
                    part.toLowerCase() === searchText.toLowerCase()
                      ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">{part}</mark>
                      : part
                  )
                  : transcript
                }
              </div>
            )}
          </div>
        </div>

        {/* ─ 右栏：摘要/行动项/导出 ─ */}
        <div className="flex-1 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden">
          {/* Tab导航 */}
          <div className="flex border-b border-slate-100">
            {([
              { key: 'summary', label: '摘要', icon: Sparkles },
              { key: 'actions', label: `行动项 ${actionItems.length > 0 ? `(${actionItems.length})` : ''}`, icon: Check },
              { key: 'mindmap', label: '思维导图', icon: Network },
              { key: 'linked', label: '关联视图', icon: GitBranch },
              { key: 'export', label: '导出', icon: Download },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* ── Tab: 摘要 ── */}
            {activeTab === 'summary' && (
              <div className="p-5 space-y-4">
                {summary.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4">
                    <Sparkles className="w-12 h-12 opacity-30" />
                    <p className="text-sm">尚未生成摘要</p>
                    <button
                      onClick={handleGenerate}
                      disabled={isGenerating}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                    >
                      {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {isGenerating ? 'AI生成中...' : '开始生成'}
                    </button>
                  </div>
                ) : (
                  summary.map((sec: SummarySection, i: number) => (
                    <div key={i} className={`border rounded-xl p-4 ${SECTION_COLOR[sec.section_type]}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          {SECTION_LABEL[sec.section_type]}
                        </span>
                        {sec.confidence < 0.7 && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> 低置信度
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed">{sec.content}</p>
                    </div>
                  ))
                )}
                {summary.length > 0 && (
                  <p className="text-xs text-slate-400 text-center pt-2">* 内容由AI生成，仅供参考</p>
                )}
              </div>
            )}

            {/* ── Tab: 行动项 ── */}
            {activeTab === 'actions' && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-slate-500">{actionItems.length} 条行动项</p>
                  {!isLocked && (
                    <button
                      onClick={addAction}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> 新增
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {actionItems.map((item: ActionItem) => {
                    const isLow = item.confidence_owner < 0.7 || item.confidence_date < 0.7;
                    const isEditing = editingAction === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`border rounded-xl p-3 transition-all ${
                          isLow && item.status === 'pending'
                            ? 'border-red-300 bg-red-50'
                            : item.status === 'confirmed' || item.status === 'done'
                              ? 'border-emerald-200 bg-emerald-50/50'
                              : 'border-slate-200 bg-white'
                        }`}
                      >
                        {isEditing ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editBuf.description || ''}
                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditBuf((p: Partial<ActionItem>) => ({ ...p, description: e.target.value }))}
                              rows={2}
                              className="text-sm resize-none"
                            />
                            <div className="flex gap-2">
                              <Input
                                placeholder="负责人"
                                value={editBuf.owner || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditBuf((p: Partial<ActionItem>) => ({ ...p, owner: e.target.value }))}
                                className="flex-1 h-7 text-xs"
                              />
                              <Input
                                type="date"
                                value={editBuf.due_date || ''}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditBuf((p: Partial<ActionItem>) => ({ ...p, due_date: e.target.value }))}
                                className="flex-1 h-7 text-xs"
                              />
                              <select
                                value={editBuf.priority || 'medium'}
                                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEditBuf((p: Partial<ActionItem>) => ({ ...p, priority: e.target.value as ActionItem['priority'] }))}
                                className="h-7 text-xs border border-slate-200 rounded-lg px-2 bg-white"
                              >
                                <option value="high">高</option>
                                <option value="medium">中</option>
                                <option value="low">低</option>
                              </select>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => setEditingAction(null)} className="text-xs text-slate-500 px-2 py-1 hover:bg-slate-100 rounded">取消</button>
                              <button onClick={() => saveEdit(item.id)} className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-lg">保存</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start gap-2 mb-1.5">
                                {isLow && item.status === 'pending' && (
                                  <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                                )}
                                <p className="text-sm text-slate-800 leading-snug">{item.description}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {item.owner && (
                                  <span className="flex items-center gap-1 text-xs text-slate-500">
                                    <User className="w-3 h-3" />
                                    {item.owner}
                                    <ConfidenceBadge value={item.confidence_owner} label="人" />
                                  </span>
                                )}
                                {!item.owner && (
                                  <span className="text-xs text-red-500 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" /> 无负责人
                                  </span>
                                )}
                                {item.due_date && (
                                  <span className="flex items-center gap-1 text-xs text-slate-500">
                                    <Calendar className="w-3 h-3" />
                                    {item.due_date}
                                    <ConfidenceBadge value={item.confidence_date} label="期" />
                                  </span>
                                )}
                                {!item.due_date && (
                                  <span className="text-xs text-amber-500 flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> 无截止日期
                                  </span>
                                )}
                                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLOR[item.priority]}`}>
                                  {PRIORITY_LABEL[item.priority]}
                                </span>
                                {item.confirmed_by && (
                                  <span className="text-xs text-emerald-600 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> {item.confirmed_by}已确认
                                  </span>
                                )}
                              </div>
                              {item.initial_result && (
                                <div className="mt-1.5 flex items-start gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5">
                                  <span className="text-xs font-medium text-blue-600 flex-shrink-0">预期结果:</span>
                                  <span className="text-xs text-blue-700">{item.initial_result}</span>
                                </div>
                              )}
                              {item.source_sentence && (
                                <p className="mt-1.5 text-xs text-slate-400 italic border-l-2 border-slate-200 pl-2 line-clamp-1">
                                  "{item.source_sentence}"
                                </p>
                              )}
                            </div>
                            {!isLocked && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {isLow && item.status === 'pending' && (
                                  <button
                                    onClick={() => confirmAction(item.id)}
                                    title="确认此行动项"
                                    className="p-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button onClick={() => startEdit(item)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => deleteAction(item.id)} className="p-1 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {actionItems.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-40 text-slate-400 text-sm gap-2">
                      <Check className="w-8 h-8 opacity-30" />
                      <span>暂无行动项</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab: 思维导图 ── */}
            {activeTab === 'mindmap' && (
              <div className="p-5">
                {summary.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4">
                    <Network className="w-12 h-12 opacity-30" />
                    <p className="text-sm">先生成摘要，再查看思维导图</p>
                    <button
                      onClick={() => setActiveTab('summary')}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                      去生成摘要
                    </button>
                  </div>
                ) : (
                  <MeetingMindMap
                    title={meeting?.title || '会议'}
                    topics={summary
                      .filter(s => s.section_type === 'agenda')
                      .map(s => ({ topic: s.content.substring(0, 50), description: s.content }))}
                    decisions={summary
                      .filter(s => s.section_type === 'decision')
                      .map(s => ({ decision: s.content, rationale: '', stakeholders: [] }))}
                    risks={summary
                      .filter(s => s.section_type === 'risk')
                      .map(s => ({ risk: s.content, mitigation: '' }))}
                    actionItems={actionItems.map(a => ({
                      description: a.description,
                      assignee: a.owner || undefined,
                      priority: a.priority
                    }))}
                    nextSteps={summary
                      .filter(s => s.section_type === 'next_step')
                      .map(s => ({ step: s.content, owner: '' }))}
                  />
                )}
              </div>
            )}

            {/* ── Tab: 关联视图 ── */}
            {activeTab === 'linked' && (
              <div className="p-5">
                {summary.length === 0 || actionItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-4">
                    <GitBranch className="w-12 h-12 opacity-30" />
                    <p className="text-sm">需要摘要和行动项才能查看关联</p>
                    <button
                      onClick={() => setActiveTab(summary.length === 0 ? 'summary' : 'actions')}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                      {summary.length === 0 ? '去生成摘要' : '去查看行动项'}
                    </button>
                  </div>
                ) : (
                  <SummaryActionSplit
                    summary={summary}
                    actionItems={actionItems}
                    onActionClick={(actionId) => {
                      setEditingAction(actionId);
                      setActiveTab('actions');
                    }}
                  />
                )}
              </div>
            )}

            {/* ── Tab: 导出 ── */}
            {activeTab === 'export' && (
              <div className="p-6 space-y-6">
                {/* 锁定状态 */}
                <div className={`rounded-xl p-4 border ${isLocked ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center ${isLocked ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                      {isLocked ? <Shield className="w-5 h-5 text-emerald-600" /> : <Lock className="w-5 h-5 text-amber-600" />}
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${isLocked ? 'text-emerald-800' : 'text-amber-800'}`}>
                        {isLocked ? `正式版本 v${meeting.locked_version} 已锁定` : '草稿阶段'}
                      </p>
                      <p className={`text-xs ${isLocked ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {isLocked ? '版本已锁定，可以导出正式文件' : '需先锁定版本才能导出正式文件'}
                      </p>
                    </div>
                    {!isLocked && (
                      <button
                        onClick={handleLock}
                        disabled={hasUnconfirmedLow}
                        className="ml-auto flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                      >
                        <Lock className="w-3.5 h-3.5" /> 立即锁定
                      </button>
                    )}
                  </div>
                </div>

                {/* 导出格式 */}
                {isLocked && (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">选择导出格式</p>
                    {[
                      { format: 'word' as const, label: 'Word 文档', desc: '.docx 格式，可二次编辑', icon: '📄' },
                      { format: 'pdf' as const, label: 'PDF 文件', desc: '.pdf 格式，适合分享', icon: '📋' },
                    ].map(({ format, label, desc, icon }) => (
                      <button
                        key={format}
                        onClick={() => handleExport(format)}
                        className="w-full flex items-center gap-4 p-4 border border-slate-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all text-left group"
                      >
                        <span className="text-2xl">{icon}</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-700 group-hover:text-blue-700">{label}</p>
                          <p className="text-xs text-slate-400">{desc}</p>
                        </div>
                        <Download className="w-4 h-4 text-slate-400 group-hover:text-blue-500" />
                      </button>
                    ))}
                    <p className="text-xs text-slate-400 text-center pt-1">
                      文件命名：{meeting.title}_{new Date().toISOString().split('T')[0]}_v{meeting.locked_version}
                    </p>
                  </div>
                )}

                {/* 版本历史占位 */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">版本历史</p>
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-xs text-slate-500">当前版本 {isLocked ? `v${meeting.locked_version}` : '（草稿）'}</span>
                      <span className="ml-auto text-xs text-slate-400">{isLocked ? '已锁定' : '编辑中'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
