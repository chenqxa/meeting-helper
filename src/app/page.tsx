'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { AudioRecorder } from '@/components/audio-recorder';
import {
  Mic, FileText, Upload, Clock, RefreshCw,
  Plus, AlertTriangle, CheckCircle2, ChevronRight,
  Users, Kanban, Radio, Trash2, CheckSquare, FolderOpen, ClipboardList,
  FileEdit, LockIcon, X, Sparkles, User, Calendar
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ProjectItem {
  id: string;
  name: string;
  status: 'planning' | 'active' | 'at_risk' | 'completed' | 'archived';
  owner?: string | null;
  targetDate?: string | null;
  createdAt: string;
}

interface MeetingItem {
  id: string;
  title: string;
  type: string;
  meeting_date: string;
  status: 'draft' | 'review' | 'locked';
  participants: string[];
  department?: string;
  organizer?: string;
  organizerLoginId?: string;
  has_minutes?: boolean;
  has_low_confidence?: boolean;
}

interface MyActionItem {
  id: string;
  description: string;
  owner?: string | null;
  proposer?: string | null;
  due_date?: string | null;
  due_date_type?: 'date' | 'continuous' | 'tbd' | null;
  status: string;
  meeting_id: string;
  meeting_title?: string;
  oa_result?: string | null;
  oa_attachments?: string[];
  oa_score?: number | null;
}

const normalizeName = (name?: string | null) => {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const garbledMap: Record<string, string> = {
    '褰撳墠鐢ㄦ埛': '当前用户',
  };
  return garbledMap[trimmed] ?? trimmed;
};

const normalizeMeetingItem = (meeting: MeetingItem): MeetingItem => {
  if (!meeting) return {} as MeetingItem;
  return {
    ...meeting,
    organizer: normalizeName(meeting.organizer) || undefined,
    participants: (Array.isArray(meeting.participants) ? meeting.participants : []).map(normalizeName).filter(Boolean),
  };
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft:  { label: '草稿',   color: 'bg-blue-50 text-blue-600 border border-blue-100' },
  review: { label: '待确认', color: 'bg-amber-50 text-amber-700 border border-amber-100' },
  locked: { label: '已归档', color: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
};

const TYPE_MAP: Record<string, string> = {
  weekly: '周会', review: '评审', retrospective: '复盘', general: '普通',
};

const PROJECT_STATUS_META: Record<ProjectItem['status'], { label: string; cls: string }> = {
  planning: { label: '规划中', cls: 'bg-slate-100 text-slate-600' },
  active: { label: '进行中', cls: 'bg-blue-100 text-blue-600' },
  at_risk: { label: '有风险', cls: 'bg-amber-100 text-amber-700' },
  completed: { label: '已完成', cls: 'bg-emerald-100 text-emerald-600' },
  archived: { label: '已归档', cls: 'bg-slate-200 text-slate-500' },
};

const DUE_TYPE_META: Record<string, { label: string; icon: string; cls: string; bar: string }> = {
  date:       { label: '具体日期', icon: '📅', cls: '', bar: 'bg-blue-500' },
  continuous: { label: '持续项',   icon: '🔄', cls: 'bg-violet-50 text-violet-700 border border-violet-100', bar: 'bg-violet-500' },
  tbd:        { label: '待定',     icon: '❓', cls: 'bg-slate-100 text-slate-500 border border-slate-200', bar: 'bg-slate-300' },
};

function DueTypeBadge({ type }: { type?: string | null }) {
  const meta = DUE_TYPE_META[type || 'date'] || DUE_TYPE_META.date;
  if (!type || type === 'date') return null;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded ${meta.cls}`}>
      <span>{meta.icon}</span>{meta.label}
    </span>
  );
}


export default function WorkbenchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [search, setSearch] = useState('');
  const [meetingFilter, setMeetingFilter] = useState<'all' | 'organized' | 'participated' | 'completed'>('all');
  const [inputMode, setInputMode] = useState<'upload' | 'text' | 'voice' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [asrFailed, setAsrFailed] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newProjectId, setNewProjectId] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const [currentUser, setCurrentUser] = useState<{ name: string; dept: string; role?: string } | null>(null);
  const [meetingTypes, setMeetingTypes] = useState<{ id: string; name: string; defaultDept: string; defaultOwner: string }[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [deptEmployees, setDeptEmployees] = useState<string[]>([]);
  const [allOrgEmployeeNames, setAllOrgEmployeeNames] = useState<string[]>([]);
  const [addPersonValue, setAddPersonValue] = useState('');
  const [myActions, setMyActions] = useState<MyActionItem[]>([]);
  const [showMoreInputOptions, setShowMoreInputOptions] = useState(false);
  const newMeetingParam = searchParams.get('newMeeting');
  const [resultItem, setResultItem] = useState<MyActionItem | null>(null);
  const [resultForm, setResultForm] = useState<{ text: string; status: 'done' | 'blocked' }>({ text: '', status: 'done' });
  const [nextDueDate, setNextDueDate] = useState('');
  const [resultImages, setResultImages] = useState<File[]>([]);
  const [resultSubmitting, setResultSubmitting] = useState(false);

  // 从URL参数自动打开新建会议弹窗
  useEffect(() => {
    if (newMeetingParam === 'true') {
      setShowNewForm(true);
      setInputMode(null);
      setShowMoreInputOptions(false);
      // 清除URL参数
      router.replace('/', { scroll: false });
    }
  }, [newMeetingParam]);


  // 相对时间格式化（兜底Invalid Date）
  const formatRelativeTime = (dateStr: string | undefined): string => {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      // 无效日期，返回阶段替代
      return '草稿创建于今天';
    }
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    // 超过7天显示具体日期
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  const fetchData = useCallback(() => {
    fetch('/api/meetings/list')
      .then(r => r.json())
      .then(d => { 
        if (d.success) {
          const list = Array.isArray(d.data) ? d.data : [];
          setMeetings(list.map(normalizeMeetingItem)); 
        }
      })
      .catch(() => {});
    fetch('/api/actions/mine')
      .then(r => r.json())
      .then(d => { 
        if (d.success) {
          setMyActions(Array.isArray(d.data) ? d.data : []); 
        }
      })
      .catch(() => {});
    fetch('/api/projects')
      .then(r => r.json())
      .then(d => { 
        if (d.success) {
          setProjects(Array.isArray(d.data) ? d.data : []); 
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      fetchData();
    };
    window.addEventListener('refresh-data', handleRefresh);
    return () => window.removeEventListener('refresh-data', handleRefresh);
  }, [fetchData]);

  useEffect(() => {
    // 从 sessionStorage 获取 currentUser（DashboardLayout 已缓存）
    try {
      const cached = sessionStorage.getItem('auth_me');
      if (cached) {
        setCurrentUser(JSON.parse(cached));
      }
    } catch {}

    fetchData();

    // auth/me 由 DashboardLayout 处理，这里不再重复请求
    fetch('/api/org/employees')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setAllOrgEmployeeNames((d.data || []).filter((e: any) => e.status !== 'resigned').map((e: any) => e.name as string));
        }
      })
      .catch(() => {});
    fetch('/api/meeting-types')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data?.length > 0) {
          setMeetingTypes(d.data);
          setNewType(d.data[0].name);
          if (d.data[0].defaultDept) setNewDept(d.data[0].defaultDept);
        }
      })
      .catch(() => {});
    fetch('/api/org/departments')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setDepartments((d.data || []).filter((dep: any) => dep.status !== 'inactive').map((dep: any) => ({ id: dep.id, name: dep.name })));
        }
      })
      .catch(() => {});
  }, []);

  // Handle project_id URL param to pre-select project
  useEffect(() => {
    const projectId = searchParams.get('project_id');
    if (projectId && projects.length > 0) {
      setNewProjectId(projectId);
      setShowNewForm(true);
    }
  }, [searchParams, projects]);

  useEffect(() => {
    if (!newDept || departments.length === 0) { setDeptEmployees([]); setParticipants([]); return; }
    const deptObj = departments.find(d => d.name === newDept);
    if (!deptObj) return;
    fetch('/api/org/employees')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const names: string[] = (d.data || [])
            .filter((e: any) => e.status !== 'resigned' && e.departmentId === deptObj.id)
            .map((e: any) => e.name as string);
          setDeptEmployees(names);
          setParticipants(names);
        }
      })
      .catch(() => {});
  }, [newDept, departments]);

  // 鏍规嵁鍘嗗彶浼氳璁板綍鑷姩鍖归厤绫诲埆銆侀儴闂ㄥ拰鍙備細浜哄憳
  useEffect(() => {
    // 娓呯┖鏍囬鏃舵竻绌烘墍鏈夎嚜鍔ㄥ～鍏呯殑瀛楁
    if (!newTitle) {
      setNewType('');
      setNewDept('');
      setParticipants([]);
      return;
    }

    if (meetings.length === 0) return;

    const titleLower = newTitle.toLowerCase();

    // 鍦ㄥ巻鍙蹭細璁腑鏌ユ壘鐩镐技搴︽渶楂樼殑浼氳
    let bestMatch: MeetingItem | null = null;
    let maxScore = 0;

    for (const m of meetings) {
      const mTitle = m.title.toLowerCase();
      let score = 0;

      // 瀹屽叏鍖归厤
      if (mTitle === titleLower) {
        score = 100;
      }
      // 鍖呭惈鍖归厤锛堜竴涓寘鍚彟涓€涓級
      else if (mTitle.includes(titleLower) || titleLower.includes(mTitle)) {
        score = 70;
      }
    // 关键词匹配：检查是否有共同的关键词（如"周例会"、"AI"等）
      else {
    // 提取标题中的中文词组（2字以上）
        const extractWords = (text: string) => {
          const words: string[] = [];
          for (let i = 0; i < text.length - 1; i++) {
            if (/[\u4e00-\u9fa5]/.test(text[i])) {
              // 鎻愬彇2-4瀛楃殑璇嶇粍
              for (let len = 2; len <= 4 && i + len <= text.length; len++) {
                const word = text.substring(i, i + len);
                if (/[\u4e00-\u9fa5]{2,}/.test(word)) {
                  words.push(word);
                }
              }
            }
          }
          return [...new Set(words)];
        };

        const words1 = extractWords(titleLower);
        const words2 = extractWords(mTitle);
        const commonWords = words1.filter(w => words2.includes(w));

        if (commonWords.length > 0) {
          score = (commonWords.length / Math.max(words1.length, words2.length)) * 60;
        }
      }

      if (score > maxScore && score > 20) { // 闄嶄綆闃堝€煎埌20%
        maxScore = score;
        bestMatch = m;
      }
    }

    if (bestMatch) {
      console.log('[Auto-match] 匹配到历史会议', bestMatch.title, '相似度', maxScore.toFixed(1) + '%')
      // 鑷姩濉厖绫诲埆
      if (bestMatch.type) {
        setNewType(bestMatch.type);
      }
      // 鑷姩濉厖閮ㄩ棬
      if (bestMatch.department) {
        setNewDept(bestMatch.department);
      }
      // 鑷姩濉厖鍙備細浜哄憳
      if (bestMatch.participants && bestMatch.participants.length > 0) {
        setParticipants(bestMatch.participants);
      }
    }
  }, [newTitle, meetings]);

  const openResult = (action: MyActionItem) => {
    setResultItem(action);
    setResultForm({
      text: action.oa_result || '',
      // 与待办中心口径一致：默认未完成视角待选，已完成的回看默认已完成
      status: action.status === 'done' ? 'done' : 'blocked',
    });
    setNextDueDate('');
    setResultImages([]);
  };

  // 汇报弹窗打开时：document 级粘贴监听，任意位置 Ctrl+V 微信/QQ 截图都能进附件
  useEffect(() => {
    if (!resultItem) return;
    const handlePaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items || []).filter(i => i.kind === 'file').map(i => i.getAsFile()).filter((f): f is File => f !== null);
      if (files.length > 0) {
        e.preventDefault();
        setResultImages(prev => [...prev, ...files.filter(f => f.type.startsWith('image/'))]);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [resultItem]);

  const filtered = meetings.filter((m: MeetingItem) => {
    // 鎼滅储杩囨护
    if (!m.title.toLowerCase().includes(search.toLowerCase())) return false;

    // 筛选过滤
    if (meetingFilter === 'all') return true;

    const userName = currentUser?.name || '';
    const userLoginId = (currentUser as any)?.loginid || '';

    if (meetingFilter === 'organized') {
      // 鎴戜富鎸佺殑锛歰rganizer鍖归厤褰撳墠鐢ㄦ埛
      return m.organizer === userName || (m as any).organizerLoginId === userLoginId;
    }

    if (meetingFilter === 'participated') {
      // 鎴戝弬浼氱殑锛歱articipants鍖呭惈褰撳墠鐢ㄦ埛
      return m.participants.includes(userName) || m.participants.includes(userLoginId);
    }

    if (meetingFilter === 'completed') {
      // 已完成：locked状态
      return m.status === 'locked';
    }

    return true;
  });

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
        // TXT 鐩存帴鍦ㄦ祻瑙堝櫒璇诲彇锛屾棤闇€涓婁紶
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
            alert('DOCX 瑙ｆ瀽澶辫触: ' + (data.error || '鏈煡閿欒'));
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
          type: newType || 'general',
          meetingDate: newDate || new Date().toISOString().split('T')[0],
          department: newDept,
          participants,
          organizer: currentUser?.name || '',
          inputType: inputMode,
          content: (inputMode === 'text' || inputMode === 'voice') ? pasteText : undefined,
          projectId: newProjectId || null,
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

  const today = new Date().toISOString().split('T')[0];
  const activeActions = myActions.filter(a => a.oa_score == null && !['done', 'cancelled'].includes(a.status));
  const urgentActions = activeActions.filter(a => (a.due_date_type || 'date') !== 'continuous');
  const continuousActions = activeActions.filter(a => a.due_date_type === 'continuous');

  return (
    <DashboardLayout>
      {/* ── 数字化驾驶舱顶部 ── */}
      <div className="relative mb-12">
        {/* 背景装饰 */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -top-12 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/20">
                Workbench 2.0
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <p className="text-[10px] font-bold uppercase tracking-[0.2em]">
                  {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
                </p>
              </div>
            </div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight leading-tight">
              {currentUser?.name ? (
                <>你好，<span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 animate-gradient-x">{currentUser.name}</span> 👋</>
              ) : '我的数字化驾驶舱'}
            </h1>
            <p className="text-sm text-slate-500 font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              AI 扫描发现：今天有 <span className="text-slate-900 font-bold underline decoration-blue-500/30 decoration-2 underline-offset-4">{urgentActions.length} 项</span> 待办需要优先处理，建议从“技术联调”开始。
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowNewForm(true)}
              className="group relative flex items-center gap-2 px-8 py-4 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800 hover:shadow-2xl hover:-translate-y-1 active:scale-95 shadow-xl shadow-slate-200"
            >
              <Plus className="w-5 h-5 transition-transform group-hover:rotate-90" />
              发起协同会议
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* 左侧主要区域 */}
        <div className="lg:col-span-8 space-y-10">
          
          {/* 核心待办看板 */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-3">
                <span className="w-1.5 h-6 bg-blue-600 rounded-full" />
                今日重点待办
              </h2>
              <div className="flex items-center gap-2">
                {urgentActions.length > 4 && (
                  <button
                    onClick={() => router.push('/kanban?view=my')}
                    className="hidden sm:inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    另有 {urgentActions.length - 4} 条
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
                <button onClick={() => router.push('/kanban?view=my')} className="group flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors">
                  进入待办中心 <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {urgentActions.length === 0 ? (
                <div className="col-span-full bg-slate-50/50 rounded-3xl border border-dashed border-slate-200 p-12 text-center">
                  <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  </div>
                  <p className="text-base font-bold text-slate-900">太棒了！暂无紧急待办</p>
                  <p className="text-sm text-slate-400 mt-1">你可以利用这段时间整理文档或进行深度思考。</p>
                </div>
              ) : urgentActions.slice(0, 4).filter(Boolean).map(a => {
                const due = a.due_date?.slice(0, 10) || '';
                const dueType = a.due_date_type || 'date';
                const isOverdue = due && dueType === 'date' && due < today;
                const isToday = dueType === 'date' && due === today;
                const isTbd = dueType === 'tbd';
                const statusInfo = isOverdue
                  ? { bar: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', label: '已逾期' }
                  : isToday ? { bar: 'bg-orange-500', text: 'text-orange-600', bg: 'bg-orange-50', label: '今天截止' }
                  : isTbd ? { bar: 'bg-slate-300', text: 'text-slate-500', bg: 'bg-slate-50', label: '待定' }
                  : { bar: 'bg-blue-500', text: 'text-blue-600', bg: 'bg-blue-50', label: due ? due.slice(5) : '待定' };

                return (
                  <div
                    key={a.id}
                    className="bg-white rounded-2xl border border-slate-100 p-5 flex flex-col gap-4 hover:shadow-xl hover:border-blue-100 transition-all group cursor-pointer relative overflow-hidden"
                    onClick={() => a.meeting_id ? router.push(`/meeting/${a.meeting_id}`) : null}
                  >
                    <div className={`absolute top-0 left-0 w-1 h-full ${statusInfo.bar}`} />
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-slate-800 leading-snug line-clamp-2 group-hover:text-blue-600 transition-colors">{a.description}</p>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter ${statusInfo.bg} ${statusInfo.text}`}>
                          {statusInfo.label}
                        </span>
                        {dueType === 'tbd' && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
                            ❓ 待定
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                        <User className="w-3 h-3" />
                        <span>{a.owner || '待分配'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); if (a.meeting_id) router.push(`/meeting/${a.meeting_id}`); }}
                          className="h-8 px-3 rounded-lg text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100"
                        >
                          查看会议
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openResult(a as MyActionItem); }}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold transition-all ${
                            a.status === 'done'
                              ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                              : 'border-blue-200 bg-white text-blue-600 hover:bg-blue-50'
                          }`}
                        >
                          {a.status === 'done' ? '查看 / 修改汇报' : '汇报进展'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

          </section>

          {/* 数字化会议中心 */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-3">
                <span className="w-1.5 h-6 bg-indigo-600 rounded-full" />
                数字化会议中心
              </h2>
              <button onClick={() => router.push('/meetings')} className="group flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
                进入会议中心 <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
            
            <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">会议主题</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">状态</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">日期</th>
                    <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {meetings.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-8 py-16 text-center">
                        <FileText className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                        <p className="text-sm font-medium text-slate-400">暂无会议记录</p>
                      </td>
                    </tr>
                  ) : meetings.slice(0, 6).filter(Boolean).map((m: MeetingItem) => {
                    const statusInfo = STATUS_MAP[m.status] || STATUS_MAP.draft;
                    return (
                      <tr key={m.id} className="hover:bg-slate-50/80 transition-all group cursor-pointer" onClick={() => router.push(`/meeting/${m.id}`)}>
                        <td className="px-8 py-5">
                          <p className="text-sm font-bold text-slate-800 truncate max-w-[280px] group-hover:text-blue-600 transition-colors">{m.title}</p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase">{TYPE_MAP[m.type] || '会议'}</span>
                            <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                              <Users className="w-3 h-3" />
                              {m.participants?.length || 0}
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5 text-center">
                          <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tight border ${statusInfo.color}`}>
                            {statusInfo.label}
                          </span>
                        </td>
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-2 text-[12px] font-medium text-slate-500">
                            <Calendar className="w-3.5 h-3.5 text-slate-300" />
                            {formatRelativeTime((m as any).meetingDate || m.meeting_date)}
                          </div>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
                              title="删除会议"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all">
                              <ChevronRight className="w-4 h-4" />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        {/* 右侧侧边栏 */}
        <div className="lg:col-span-4 space-y-10">
          {continuousActions.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black text-slate-900 flex items-center gap-3">
                  <span className="w-1.5 h-6 bg-violet-500 rounded-full" />
                  持续跟踪事项
                </h2>
                <button onClick={() => router.push('/continuous')} className="text-xs font-bold text-violet-600 hover:text-violet-700 hover:underline">
                  查看全部 →
                </button>
              </div>
              <div className="bg-white rounded-3xl border border-slate-100 p-5 shadow-sm">
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                  <span>📌</span>
                  共{continuousActions.length}项，无固定截止日期，长期执行
                </div>
                <div className="space-y-1">
                  {continuousActions.slice(0, 5).map(a => (
                    <label
                      key={a.id}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer group"
                    >
                      <span className="w-4 h-4 rounded border border-slate-300 flex items-center justify-center flex-shrink-0 group-hover:border-slate-400 transition-colors" />
                      <span className="text-[13px] text-slate-600 group-hover:text-slate-800 transition-colors">{a.description}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          )}
          {/* 效能洞察 */}
          <section>
            <h2 className="text-xl font-black text-slate-900 mb-6 flex items-center gap-3">
              <span className="w-1.5 h-6 bg-amber-500 rounded-full" />
              效能洞察
            </h2>
            <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm relative overflow-hidden group">
              {/* 装饰背景 - 极淡的色块 */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-full -mr-16 -mt-16 transition-transform duration-700 group-hover:scale-110" />
              
              <div className="grid grid-cols-2 gap-8 relative z-10">
                <div className="space-y-1">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">累计会议</p>
                  <div className="flex items-baseline gap-1">
                    <p className="text-3xl font-black text-slate-900 tracking-tight">{meetings.length}</p>
                    <span className="text-xs font-bold text-slate-300 uppercase">Sessions</span>
                  </div>
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">数字化沉淀</p>
                  <div className="flex items-baseline gap-1 justify-end">
                    <p className="text-3xl font-black text-blue-600 tracking-tight">{meetings.filter(m => m.status === 'locked').length}</p>
                    <span className="text-xs font-bold text-slate-300 uppercase">Docs</span>
                  </div>
                </div>
              </div>
              
              <div className="mt-10 pt-8 border-t border-slate-50 relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">纪要转化效能</span>
                    <div className="group/hint relative">
                      <AlertTriangle className="w-3 h-3 text-slate-300 cursor-help" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 text-[10px] text-white rounded-lg opacity-0 group-hover/hint:opacity-100 transition-opacity pointer-events-none z-20">
                        转化率 = 已归档纪要 / 总会议数。反映了会议共识的数字化效率。
                      </div>
                    </div>
                  </div>
                  <span className="text-lg font-black text-blue-600">{meetings.length ? Math.round(meetings.filter(m => m.status === 'locked').length / meetings.length * 100) : 0}%</span>
                </div>
                
                <div className="h-2 bg-slate-50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-1000 ease-out shadow-[0_0_8px_rgba(59,130,246,0.3)]" 
                    style={{ width: `${meetings.length ? Math.round(meetings.filter(m => m.status === 'locked').length / meetings.length * 100) : 0}%` }}
                  />
                </div>
                
                <div className="mt-6 flex items-start gap-3 p-4 rounded-2xl bg-slate-50/50 border border-slate-100">
                  <Sparkles className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                    {meetings.length ? (
                      Math.round(meetings.filter(m => m.status === 'locked').length / meetings.length * 100) >= 80 
                        ? "团队的数字化沉淀效率极高，共识落地情况良好。" 
                        : "当前的转化率还有提升空间，建议及时对会议进行归档整理。"
                    ) : "暂无会议数据，开始发起会议并整理纪要吧。"}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>


      {/* ── 新建会议 Modal ── */}
      {showNewForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            style={{ boxShadow: '0 25px 80px rgba(0,0,0,0.2)' }}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <span className="w-1 h-5 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full" />
                <h3 className="font-bold text-slate-800">新建会议记录</h3>
              </div>
              <button onClick={() => setShowNewForm(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">会议主题 *</label>
                  <Input autoFocus placeholder="例如：产品双周会 2024-W12" value={newTitle}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)} className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-500">会议类别</label>
                    <div className="mt-1">
                      <SearchableSelect value={newType} onChange={v => { setNewType(v); const mt = meetingTypes.find(t => t.name === v); if (mt?.defaultDept) setNewDept(mt.defaultDept); }}
                        options={meetingTypes.map(t => t.name)} placeholder="选择类别" clearable={false} dropdownWidth="full" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-500">会议日期</label>
                    <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                      className="mt-1 w-full h-9 text-sm border border-slate-200 rounded-lg px-2.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">所属部门</label>
                  <div className="mt-1"><SearchableSelect value={newDept} onChange={setNewDept} options={departments.map(d => d.name)} placeholder="搜索或选择部门" /></div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">所属项目</label>
                  <div className="mt-1">
                    <SearchableSelect value={projects.find(p => p.id === newProjectId)?.name || ''}
                      onChange={(name) => { setNewProjectId(projects.find(p => p.name === name)?.id || ''); }}
                      options={projects.map(p => p.name)} placeholder="可选，关联到项目" clearable={true} />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-500">参会人员</label>
                    <span className="text-[11px] text-slate-400">{participants.length} 人已选</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 p-2.5 border border-slate-200 rounded-lg bg-slate-50 min-h-[44px]">
                    {deptEmployees.length === 0 && participants.length === 0 ? (
                      <span className="text-[11px] text-slate-300 self-center">请先选择所属部门</span>
                    ) : (
                      <>
                        {deptEmployees.map(name => {
                          const selected = participants.includes(name);
                          return (
                            <button key={name} type="button"
                              onClick={() => setParticipants(prev => selected ? prev.filter(p => p !== name) : [...prev, name])}
                              className={`px-2.5 py-1 text-xs rounded-full border transition-all ${selected ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-white text-slate-400 border-slate-300 hover:border-slate-400'}`}
                            >{name}</button>
                          );
                        })}
                        {participants.filter(p => !deptEmployees.includes(p)).map(name => (
                          <span key={name} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-purple-600 text-white border border-purple-600">
                            {name}<button type="button" onClick={() => setParticipants(prev => prev.filter(p => p !== name))} className="hover:opacity-70 leading-none">×</button>
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                  {allOrgEmployeeNames.length > 0 && (
                    <SearchableSelect value={addPersonValue}
                      onChange={name => { if (name && !participants.includes(name)) setParticipants(prev => [...prev, name]); setAddPersonValue(''); }}
                      options={allOrgEmployeeNames.filter(n => !participants.includes(n))}
                      placeholder="搜索添加其他人员（可跨部门）" clearable={false} />
                  )}
                </div>
              </div>
              {/* 内容来源（折叠，默认收起，放表单底部） */}
              <div className="border-t border-slate-100 pt-3">
                <button onClick={() => { setShowMoreInputOptions(!showMoreInputOptions); if (showMoreInputOptions) setInputMode(null); }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs hover:bg-slate-100 transition-colors">
                  <span className="font-medium text-slate-600">📎 添加会议内容来源（可选）</span>
                  <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showMoreInputOptions ? 'rotate-90' : ''}`} />
                </button>
                {showMoreInputOptions && (
                  <div className="mt-2 space-y-3">
                    <div className="flex gap-2">
                      <button onClick={() => setInputMode(inputMode === 'upload' ? null : 'upload')} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-all ${inputMode === 'upload' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Upload className="w-3.5 h-3.5" /> 上传文件</button>
                      <button onClick={() => setInputMode(inputMode === 'voice' ? null : 'voice')} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-all ${inputMode === 'voice' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><Radio className="w-3.5 h-3.5" /> 上传录音</button>
                      <button onClick={() => setInputMode(inputMode === 'text' ? null : 'text')} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg transition-all ${inputMode === 'text' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}><FileText className="w-3.5 h-3.5" /> 粘贴文本</button>
                    </div>
                    {inputMode === 'upload' && !uploadFile && (
                      <div onDragOver={(e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${isDragging ? 'border-blue-500 bg-blue-50 scale-[1.02]' : 'border-slate-200 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/30'}`}>
                        <input ref={fileInputRef} type="file" accept=".txt,.docx,.mp3,.wav" className="hidden"
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
                        <Upload className={`w-6 h-6 mx-auto mb-2 transition-colors ${isDragging ? 'text-blue-500' : 'text-slate-400'}`} />
                        <p className="text-sm font-medium text-slate-600">{isDragging ? '松开即可上传' : '拖拽或点击选择文件'}</p>
                        <p className="text-xs text-slate-400 mt-1">.txt · .docx · .mp3 · .wav</p>
                      </div>
                    )}
                    {uploadFile && inputMode === 'upload' && (
                      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-xs font-medium">
                        <FileText className="w-4 h-4 flex-shrink-0" /><span className="flex-1 truncate">{uploadFile.name}</span>
                        <button onClick={() => setUploadFile(null)} className="text-blue-400 hover:text-blue-600"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                    {inputMode === 'voice' && (
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                        <AudioRecorder onRecordingComplete={(blob, duration) => { console.log('Recording completed:', duration, 'seconds'); }}
                          onTranscriptReceived={(text) => { setPasteText(text); setVoiceText(text); }} maxDuration={600} />
                        {voiceText && (
                          <div className="mt-3 p-3 bg-white border border-slate-100 rounded-xl max-h-[100px] overflow-y-auto">
                            <p className="text-xs text-slate-600 leading-relaxed">{voiceText}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {inputMode === 'text' && (
                      <div>
                        {asrFailed && <div className="mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">ASR 转写失败，请手动粘贴会议文本</div>}
                        <Textarea placeholder="在此粘贴会议转写文本或会议纪要…" value={pasteText}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setPasteText(e.target.value); if (e.target.value) setInputMode('text'); }}
                          rows={4} className="resize-none text-sm bg-slate-50" />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button onClick={handleCreate} disabled={isCreating || !newTitle.trim()}
                className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-blue-500/30">
                {isCreating ? <><Clock className="w-4 h-4 animate-spin" /> 生成中…</> : <><Sparkles className="w-4 h-4" /> 确认并生成纪要</>}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {resultItem && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setResultItem(null); }}
        >
          <div className="bg-white w-full sm:w-[540px] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            <div className={`h-1.5 w-full ${resultForm.status === 'done' ? 'bg-gradient-to-r from-emerald-400 to-green-500' : resultForm.status === 'blocked' ? 'bg-gradient-to-r from-red-400 to-rose-500' : 'bg-gradient-to-r from-blue-400 to-indigo-500'}`} />

            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">汇报进展</h2>
                <p className="text-xs text-slate-400 mt-0.5">填写后自动同步到行动项台账</p>
              </div>
              <button onClick={() => setResultItem(null)} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mx-6 mb-4 p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">事项内容</div>
                <div className="text-xs text-slate-700 leading-relaxed line-clamp-3">{resultItem.description}</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 space-y-5 pb-2">
              <div>
                <div className="text-xs font-medium text-slate-500 mb-2.5">处理结果</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'done', label: '已完成', emoji: '✅', activeBg: 'bg-emerald-500', border: 'border-emerald-300', bg: 'bg-emerald-50', text: 'text-emerald-700' },
                    { value: 'blocked', label: '未完成', emoji: '🚫', activeBg: 'bg-red-500', border: 'border-red-300', bg: 'bg-red-50', text: 'text-red-700' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setResultForm(f => ({ ...f, status: opt.value as 'done' | 'blocked' }))}
                      className={`py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                        resultForm.status === opt.value
                          ? `${opt.activeBg} border-transparent text-white shadow-lg scale-105 ring-2 ring-black/10`
                          : `${opt.bg} ${opt.border} ${opt.text} opacity-60 hover:opacity-100 hover:scale-[1.02]`
                      }`}
                    >
                      <span className="text-lg">{opt.emoji}</span>
                      <span className="text-xs font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {resultForm.status === 'blocked' && (
                <div>
                  <div className="text-xs font-medium text-slate-500 mb-2.5">下次完成时间 <span className="text-red-400">*</span></div>
                  <input
                    type="date"
                    value={nextDueDate}
                    onChange={e => setNextDueDate(e.target.value)}
                    className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">选择后系统将自动生成一条带新截止时间的新任务</p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-slate-500">{resultForm.status === 'blocked' ? '未完成理由' : '处理说明'} <span className="text-red-400">*</span></div>
                  <div className="text-[10px] text-slate-300">{resultForm.text.length}/500</div>
                </div>
                <textarea
                  rows={4}
                  autoFocus
                  value={resultForm.text}
                  onChange={e => setResultForm(f => ({ ...f, text: e.target.value.slice(0, 500) }))}
                  className="w-full text-sm border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 resize-none placeholder:text-slate-300 transition-all"
                  placeholder={resultForm.status === 'done' ? '描述完成情况、成果...' : '说明未完成原因、需要的支持...'}
                />
              </div>

              <div>
                <div className="text-xs font-medium text-slate-500 mb-2">
                  图片附件 {resultItem.due_date_type === 'continuous'
                    ? <span className="text-slate-300 font-normal">（可选，有进展证据时上传）</span>
                    : <><span className="text-red-400">*</span> <span className="text-slate-300 font-normal">（截图、证明材料等，至少上传 1 张）</span></>}
                </div>
                <div
                  className="border-2 border-dashed border-slate-200 rounded-xl p-5 text-center hover:border-blue-300 hover:bg-blue-50/30 transition-all cursor-pointer group"
                  onClick={() => document.getElementById('home-action-img-upload')?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
                    setResultImages(prev => [...prev, ...files]);
                  }}
                >
                  <input
                    id="home-action-img-upload"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => setResultImages(prev => [...prev, ...Array.from(e.target.files || [])])}
                  />
                  <div className="text-2xl mb-1">🖼️</div>
                  <div className="text-xs text-slate-400 group-hover:text-blue-500 transition-colors">点击上传 / 拖拽图片 / <b>Ctrl+V 粘贴微信QQ截图</b></div>
                  <div className="text-[10px] text-slate-300 mt-0.5">支持 JPG · PNG · GIF · WebP</div>
                </div>
                {resultImages.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {resultImages.map((file, index) => (
                      <div key={`${file.name}-${index}`} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group">
                        <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                        <button
                          onClick={() => setResultImages(prev => prev.filter((_, idx) => idx !== index))}
                          className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <div
                      className="aspect-square rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all"
                      onClick={() => document.getElementById('home-action-img-upload')?.click()}
                    >
                      <span className="text-slate-300 text-xl">+</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 mt-2">
              <button
                onClick={() => setResultItem(null)}
                className="px-5 h-10 border border-slate-200 text-slate-500 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  // 未完成必须填下次完成时间
                  if (resultForm.status === 'blocked' && !nextDueDate) {
                    alert('请选择下次完成时间');
                    return;
                  }
                  // 说明必填
                  if (!resultForm.text.trim()) {
                    alert(resultForm.status === 'blocked' ? '请填写未完成理由' : '请填写处理说明');
                    return;
                  }
                  // 图片附件必填（至少 1 张）——持续项周期汇报可选（"无进展"为合法状态，无图可传）
                  if (resultItem.due_date_type !== 'continuous' && resultImages.length === 0) {
                    alert('请至少上传 1 张图片附件（截图、证明材料等）');
                    return;
                  }
                  setResultSubmitting(true);
                  try {
                    const imageUrls: string[] = [];
                    for (const file of resultImages) {
                      const fd = new FormData();
                      fd.append('file', file);
                      fd.append('type', 'image');
                      const uploadResult = await fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());
                      if (uploadResult.success) imageUrls.push(uploadResult.url);
                    }
                    const res = await fetch(`/api/actions/${resultItem.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        _meetingId: resultItem.meeting_id,
                        oa_result: resultForm.text,
                        oa_result_at: new Date().toISOString(),
                        // 已完成=V(+1)；未完成=X(-1)+下次日期自动重派新任务
                        oa_score: resultForm.status === 'done' ? 1 : -1,
                        oa_auto_detected: false,
                        status: resultForm.status,
                        next_due_date: resultForm.status === 'blocked' ? nextDueDate : undefined,
                        block_reason: resultForm.status === 'blocked' ? resultForm.text : null,
                        oa_attachments: imageUrls.length > 0 ? imageUrls : (resultItem.oa_attachments || []),
                      }),
                    });
                    if (res.ok) {
                      setResultItem(null);
                      fetchData();
                    }
                  } finally {
                    setResultSubmitting(false);
                  }
                }}
                disabled={resultSubmitting}
                className={`flex-1 h-10 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  resultForm.status === 'done'
                    ? 'bg-emerald-500 hover:bg-emerald-600'
                    : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {resultSubmitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> 提交中...
                  </span>
                ) : (
                  resultForm.status === 'done' ? '✅ 标记完成' : '🚫 标记未完成'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
