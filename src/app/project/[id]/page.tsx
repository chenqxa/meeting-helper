'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getActionDisplayLabel, getActionDisplayStatus } from '@/lib/action-status';
import { getDisplayOaResult } from '@/lib/oa-result-display';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { ImagePreview } from '@/components/ui/image-preview';
import { FilePreview } from '@/components/ui/file-preview';
import {
  FolderOpen, FileText, Users, Calendar, CheckSquare,
  AlertTriangle, ChevronLeft, Plus, Edit2, Check, X,
  Sparkles, Clock, TrendingUp, BookOpen, Search, Flag,
  RefreshCw,
  Lightbulb, ListChecks, ArrowUpRight, Send, Eye
} from 'lucide-react';

interface Project {
  id: string;
  name: string;
  description?: string | null;
  status: 'planning' | 'active' | 'at_risk' | 'completed' | 'archived';
  phase?: string | null;
  owner?: string | null;
  members?: string[];
  targetDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActionItem {
  id: string;
  description: string;
  owner?: string | null;
  due_date?: string | null;
  due_date_type?: string | null;
  priority: string;
  status: string;
  meeting_id: string;
  meeting_title: string;
  oa_result?: string | null;
  oa_result_at?: string | null;
  oa_score?: number | null;
  oa_attachments?: string[];
  block_reason?: string | null;
}

interface Artifact {
  id: string;
  artifactType: string;
  title: string;
  parseStatus: string;
  createdAt: string;
  createdBy?: string | null;
  content?: string | null;
  sourceRef?: string | null;
}

interface DocumentParagraph {
  id: string;
  text: string;
}

interface Requirement {
  id: string;
  title: string;
  description?: string | null;
  status: 'draft' | 'in_review' | 'approved' | 'live';
  priority: 'low' | 'medium' | 'high';
  owner?: string | null;
  ownerLoginId?: string | null;
  relatedArtifactId?: string | null;
  tags: string[];
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProjectRisk {
  id: string;
  title: string;
  description?: string | null;
  level: 'low' | 'medium' | 'high';
  status: 'open' | 'mitigated' | 'closed';
  owner?: string | null;
  ownerLoginId?: string | null;
  relatedActionId?: string | null;
  detectedBy?: 'manual' | 'ai' | null;
  mitigationPlan?: string | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  meetingCount: number;
  artifactCount: number;
  requirementCount: number;
  requirementLive: number;
  actionTotal: number;
  actionDone: number;
  actionBlocked: number;
  riskOpen: number;
}

interface PushPreviewCardItem {
  text: string;
  status?: string;
  priority?: string;
  dueDate?: string;
}

interface PushPreviewCard {
  title: string;
  text?: string;
  items?: PushPreviewCardItem[];
}

interface PushPreviewDetail {
  oaUserId: string;
  ownerName: string;
  sent: boolean;
  skipped?: string;
  count: number;
  error?: string;
  previewContent?: string;
  previewEx?: string;
}

interface PushPreviewResult {
  message: string;
  dryRun: boolean;
  totalRecipients: number;
  recipientsWithTodos: number;
  sent: number;
  skipped: number;
  failures: number;
  details: PushPreviewDetail[];
}

const formatZhDate = (dateStr: string | undefined | null, includeTime = false) => {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return typeof dateStr === 'string' ? dateStr : '--';
  
  if (includeTime) {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const estimateMilestoneDate = (
  createdAt: string | undefined | null,
  targetDate: string | undefined | null,
  index: number,
  total: number
) => {
  if (index === total - 1 && targetDate) return targetDate;
  const start = createdAt ? new Date(createdAt).getTime() : NaN;
  const end = targetDate ? new Date(targetDate).getTime() : NaN;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start || total <= 1) return null;
  return new Date(start + ((end - start) * index) / (total - 1)).toISOString();
};

const parsePushPreviewCard = (content?: string | null): PushPreviewCard | null => {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  planning: { label: '规划中', color: 'text-slate-600', bg: 'bg-slate-100' },
  active: { label: '进行中', color: 'text-blue-700', bg: 'bg-blue-100' },
  at_risk: { label: '有风险', color: 'text-amber-700', bg: 'bg-amber-100' },
  completed: { label: '已完成', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  archived: { label: '已归档', color: 'text-slate-400', bg: 'bg-slate-100' },
};

const ARTIFACT_TYPE_MAP: Record<string, string> = {
  meeting: '会议', document: '文档', research: '调研', proposal: '立项书', email: '邮件', other: '其他',
};

const PARSE_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: '待解析', cls: 'text-amber-600 bg-amber-50 border border-amber-200' },
  processing: { label: '处理中', cls: 'text-blue-600 bg-blue-50 border border-blue-200' },
  done: { label: '已完成', cls: 'text-emerald-600 bg-emerald-50 border border-emerald-200' },
};

const ACTION_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  done: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-500',
};

const REQUIREMENT_STATUS_OPTIONS: { value: Requirement['status']; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'in_review', label: '评审中' },
  { value: 'approved', label: '已通过' },
  { value: 'live', label: '已上线' },
];

const REQUIREMENT_PRIORITY_LABEL: Record<Requirement['priority'], { label: string; color: string; bg: string }> = {
  high: { label: '高', color: 'text-red-600', bg: 'bg-red-50' },
  medium: { label: '中', color: 'text-amber-600', bg: 'bg-amber-50' },
  low: { label: '低', color: 'text-slate-500', bg: 'bg-slate-50' },
};

const RISK_LEVEL_STYLE: Record<ProjectRisk['level'], { label: string; ring: string; dot: string }> = {
  high: { label: '高', ring: 'border-red-500', dot: 'bg-red-500' },
  medium: { label: '中', ring: 'border-amber-500', dot: 'bg-amber-500' },
  low: { label: '低', ring: 'border-emerald-500', dot: 'bg-emerald-500' },
};

const RISK_STATUS_COLOR: Record<ProjectRisk['status'], string> = {
  open: 'bg-red-50 text-red-600',
  mitigated: 'bg-amber-50 text-amber-600',
  closed: 'bg-emerald-50 text-emerald-600',
};

const ACTION_STATUS_LABEL: Record<string, string> = {
  pending: '未处理',
  done: '已处理',
  cancelled: '已取消',
};

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const searchParams = useSearchParams();

  const [project, setProject] = useState<Project | null>(null);
  const [currentUser, setCurrentUser] = useState<{ name: string; loginid: string } | null>(null);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [risks, setRisks] = useState<ProjectRisk[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'meetings' | 'docs' | 'actions' | 'requirements' | 'risks'>('overview');
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameBuf, setNameBuf] = useState('');
  const [weeklyReport, setWeeklyReport] = useState<any>(null);
  const [creatingRequirement, setCreatingRequirement] = useState(false);
  const [creatingRisk, setCreatingRisk] = useState(false);
  const [creatingArtifact, setCreatingArtifact] = useState(false);
  const [resultItem, setResultItem] = useState<ActionItem | null>(null);
  const [resultForm, setResultForm] = useState({ text: '', status: 'done' });
  const [nextDueDate, setNextDueDate] = useState('');
  const [resultImages, setResultImages] = useState<File[]>([]);
  const [selPreviewOpen, setSelPreviewOpen] = useState(false);
  const [selPreviewIdx, setSelPreviewIdx] = useState(0);
  const [selFilePreview, setSelFilePreview] = useState<File | null>(null);
  const [resultSubmitting, setResultSubmitting] = useState(false);
  const [pushPreviewOpen, setPushPreviewOpen] = useState(false);
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);
  const [pushSending, setPushSending] = useState(false);
  const [pushPreviewResult, setPushPreviewResult] = useState<PushPreviewResult | null>(null);
  const [pushSendResult, setPushSendResult] = useState<PushPreviewResult | null>(null);
  const [artifactForm, setArtifactForm] = useState<Partial<Artifact>>({
    artifactType: 'other',
  });
  const [requirementForm, setRequirementForm] = useState<Partial<Requirement>>({
    status: 'draft',
    priority: 'medium',
    tags: [],
  });
  const [riskForm, setRiskForm] = useState<Partial<ProjectRisk>>({
    level: 'medium',
    status: 'open',
    detectedBy: 'manual',
  });
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [docSearch, setDocSearch] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState<'all' | 'meeting' | 'document' | 'research' | 'proposal' | 'email' | 'other'>('all');
  const [requirementTagText, setRequirementTagText] = useState('');

  const docTypeOptions = useMemo(() => (
    [['all', '全部'], ...Object.entries(ARTIFACT_TYPE_MAP)] as Array<[string, string]>
  ), []);

  const filteredDocs = useMemo(() => {
    const keyword = docSearch.trim().toLowerCase();
    return artifacts
      .filter(doc => docTypeFilter === 'all' || doc.artifactType === docTypeFilter)
      .filter(doc => {
        if (!keyword) return true;
        const target = `${doc.title || ''} ${(doc.content || '')}`.toLowerCase();
        return target.includes(keyword);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [artifacts, docSearch, docTypeFilter]);

  const selectedDoc = useMemo(() => {
    if (!selectedDocId) return filteredDocs[0] || artifacts[0] || null;
    return artifacts.find(doc => doc.id === selectedDocId) || filteredDocs[0] || artifacts[0] || null;
  }, [artifacts, filteredDocs, selectedDocId]);

  const selectedDocParagraphs = useMemo<DocumentParagraph[]>(() => {
    if (!selectedDoc?.content) return [];
    return selectedDoc.content
      .split(/[\n\r]+/)
      .map(c => c.trim())
      .filter(Boolean)
      .map((para, idx) => ({ id: `${selectedDoc.id}-p-${idx}`, text: para }));
  }, [selectedDoc]);

  const docRelatedRequirements = useMemo(() => {
    if (!selectedDoc) return [] as Requirement[];
    const related = requirements.filter(r => r.relatedArtifactId === selectedDoc.id);
    if (related.length > 0) return related.slice(0, 4);
    return requirements
      .filter(r => r.priority !== 'low')
      .slice(0, 4);
  }, [requirements, selectedDoc]);

  const docSuggestedActions = useMemo(() => (
    actionItems
      .filter(item => item.status !== 'done')
      .slice(0, 4)
  ), [actionItems]);

  const docRiskAlerts = useMemo(() => (
    risks
      .filter(r => r.status === 'open')
      .slice(0, 3)
  ), [risks]);

  const docCompletionStats = useMemo(() => {
    const total = requirements.length;
    if (total === 0) return { percent: 0, completed: 0 };
    const completed = requirements.filter(r => r.status === 'live').length;
    return {
      percent: Math.round((completed / total) * 100),
      completed,
    };
  }, [requirements]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {};
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {};
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [projectId]);

  const fetchProjectDetail = () => {
    setLoading(true);
    return fetch(`/api/projects/${projectId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setProject(d.data.project);
          setMeetings(Array.isArray(d.data.meetings) ? d.data.meetings : []);
          setArtifacts(Array.isArray(d.data.artifacts) ? d.data.artifacts : []);
          setActionItems(Array.isArray(d.data.actionItems) ? d.data.actionItems : []);
          setRequirements(Array.isArray(d.data.requirements) ? d.data.requirements : []);
          setRisks(Array.isArray(d.data.risks) ? d.data.risks : []);
          setStats(d.data.stats || null);
        } else {
          console.error('Failed to fetch project detail:', d.error);
        }
      })
      .catch(error => {
        console.error('Error fetching project detail:', error);
      })
      .finally(() => setLoading(false));
  };

  // 监听全局刷新事件
  useEffect(() => {
    const handleRefresh = () => {
      fetchProjectDetail();
    };
    window.addEventListener('refresh-data', handleRefresh);
    return () => window.removeEventListener('refresh-data', handleRefresh);
  }, [projectId]);

  useEffect(() => {
    fetchProjectDetail();
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => { if (d.success) setCurrentUser(d.data); });
    fetch(`/api/projects/${projectId}/weekly-report`)
      .then(r => r.json())
      .then(d => { if (d.success) setWeeklyReport(d.data); })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['overview', 'meetings', 'docs', 'actions', 'requirements', 'risks'].includes(tabParam)) {
      setActiveTab(tabParam as typeof activeTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeTab === 'docs' && !selectedDocId && filteredDocs.length > 0) {
      setSelectedDocId(filteredDocs[0].id);
    }
  }, [activeTab, filteredDocs, selectedDocId]);

  useEffect(() => {
  }, [activeTab, actionItems.length, artifacts.length, loading, meetings.length, project, projectId, requirements.length, risks.length]);

  const updateStatus = async (status: string) => {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const r = await res.json();
    if (r.success) setProject(r.data);
  };

  const saveName = async () => {
    if (!nameBuf.trim()) return;
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameBuf.trim() }),
    });
    const r = await res.json();
    if (r.success) { setProject(r.data); setEditingName(false); }
  };

  const openResult = (action: ActionItem) => {
    setResultItem(action);
    setResultForm({
      // 预填过滤导入元数据（{"y":..,"w":..,"d":..}），避免混入新一轮汇报
      text: getDisplayOaResult(action.oa_result),
      // 与待办中心口径一致：两选一，未完成视角待选
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
        setResultImages(prev => [...prev, ...files]);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [resultItem]);

  const handleOpenPushPreview = async () => {
    setPushPreviewOpen(true);
    setPushPreviewLoading(true);
    setPushSendResult(null);
    try {
      const res = await fetch('/api/chat/push-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, dryRun: true }),
      });
      const data = await res.json();
      if (data.success) {
        setPushPreviewResult(data.data);
      } else {
        alert(`预览失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      alert('预览请求失败，请检查网络');
    } finally {
      setPushPreviewLoading(false);
    }
  };

  const handleSendPushNow = async () => {
    if (!confirm('当前将正式发送给责任人，是否继续？')) return;
    setPushSending(true);
    try {
      const res = await fetch('/api/chat/push-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, dryRun: false }),
      });
      const data = await res.json();
      if (data.success) {
        setPushSendResult(data.data);
      } else {
        alert(`推送失败: ${data.error || '未知错误'}`);
      }
    } catch (error) {
      alert('推送请求失败，请检查网络');
    } finally {
      setPushSending(false);
    }
  };

  const submitRequirement = async () => {
    if (!requirementForm.title?.trim()) return;
    const tags = requirementTagText
      .split(/[，,\s]+/)
      .map(t => t.trim())
      .filter(Boolean);
    const res = await fetch(`/api/projects/${projectId}/requirements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: requirementForm.title,
        description: requirementForm.description,
        status: requirementForm.status,
        priority: requirementForm.priority,
        owner: requirementForm.owner,
        ownerLoginId: requirementForm.ownerLoginId,
        relatedArtifactId: requirementForm.relatedArtifactId,
        tags,
        dueDate: requirementForm.dueDate,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setCreatingRequirement(false);
      setRequirementForm({ status: 'draft', priority: 'medium', tags: [] });
      setRequirementTagText('');
      await fetchProjectDetail();
    }
  };

  const updateRequirementStatus = async (id: string, payload: Partial<Requirement>) => {
    await fetch(`/api/projects/${projectId}/requirements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await fetchProjectDetail();
  };

  const deleteRequirementItem = async (id: string) => {
    await fetch(`/api/projects/${projectId}/requirements/${id}`, { method: 'DELETE' });
    await fetchProjectDetail();
  };

  const submitRisk = async () => {
    if (!riskForm.title?.trim()) return;
    const res = await fetch(`/api/projects/${projectId}/risks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: riskForm.title,
        description: riskForm.description,
        level: riskForm.level,
        status: riskForm.status,
        owner: riskForm.owner,
        ownerLoginId: riskForm.ownerLoginId,
        relatedActionId: riskForm.relatedActionId,
        detectedBy: riskForm.detectedBy,
        mitigationPlan: riskForm.mitigationPlan,
        dueDate: riskForm.dueDate,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setCreatingRisk(false);
      setRiskForm({ level: 'medium', status: 'open', detectedBy: 'manual' });
      await fetchProjectDetail();
    }
  };

  const updateRisk = async (id: string, payload: Partial<ProjectRisk>) => {
    await fetch(`/api/projects/${projectId}/risks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await fetchProjectDetail();
  };

  const submitArtifact = async () => {
    if (!artifactForm.title?.trim()) return;
    const res = await fetch('/api/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...artifactForm,
        projectId,
        createdBy: currentUser?.name || '用户',
      }),
    });
    const data = await res.json();
    if (data.success) {
      setCreatingArtifact(false);
      setArtifactForm({ artifactType: 'other' });
      await fetchProjectDetail();
    }
  };

  const deleteRisk = async (id: string) => {
    await fetch(`/api/projects/${projectId}/risks/${id}`, { method: 'DELETE' });
    await fetchProjectDetail();
  };

  const statusInfo = project ? (STATUS_MAP[project.status] || STATUS_MAP.planning) : STATUS_MAP.planning;
  const doneRate = stats && stats.actionTotal > 0 ? Math.round((stats.actionDone / stats.actionTotal) * 100) : 0;
  const activeActions = useMemo(() => actionItems.filter(a => getActionDisplayStatus(a.status) === 'pending'), [actionItems]);
  const blockedActions = useMemo(() => actionItems.filter(a => getActionDisplayStatus(a.status) === 'pending'), [actionItems]);
  const pendingActions = useMemo(() => actionItems.filter(a => getActionDisplayStatus(a.status) === 'pending'), [actionItems]);
  const openRisks = useMemo(() => risks.filter(r => r.status === 'open'), [risks]);
  const reviewRequirements = useMemo(() => requirements.filter(r => r.status === 'draft' || r.status === 'in_review'), [requirements]);
  const highPriorityRequirements = useMemo(() => requirements.filter(r => r.priority === 'high'), [requirements]);
  const overdueActions = useMemo(() => actionItems.filter(item => item.due_date && getActionDisplayStatus(item.status) === 'pending' && new Date(item.due_date) < new Date()), [actionItems]);
  
  const healthScore = useMemo(() => (
    stats && stats.actionTotal > 0
      ? Math.max(0, Math.round(100 - (stats.actionBlocked / stats.actionTotal) * 40 - overdueActions.length * 5))
      : null
  ), [stats, overdueActions.length]);

  const focusItems = useMemo(() => [
    ...(openRisks || []).slice(0, 2).filter(Boolean).map(risk => ({
      id: `risk-${risk.id}`,
      type: 'risk',
      title: risk.title,
      desc: `风险等级 ${RISK_LEVEL_STYLE[risk.level]?.label || risk.level}${risk.owner ? ` · 责任人 ${risk.owner}` : ''}`,
      action: () => setActiveTab('risks'),
      actionLabel: '查看风险',
      tone: 'border-amber-200 bg-amber-50/70',
    })),
    ...(blockedActions || []).slice(0, 2).filter(Boolean).map(action => ({
      id: `action-${action.id}`,
      type: 'action',
      title: action.description,
      desc: `${getActionDisplayLabel(action.status)}${action.owner ? ` · ${action.owner}` : ''}`,
      action: () => setActiveTab('actions'),
      actionLabel: '查看事项',
      tone: 'border-red-200 bg-red-50/70',
    })),
    ...(reviewRequirements || []).slice(0, 2).filter(Boolean).map(req => ({
      id: `req-${req.id}`,
      type: 'requirement',
      title: req.title,
      desc: `${REQUIREMENT_STATUS_OPTIONS.find(opt => opt.value === req.status)?.label || req.status}${req.owner ? ` · ${req.owner}` : ''}`,
      action: () => setActiveTab('requirements'),
      actionLabel: '查看需求',
      tone: 'border-blue-200 bg-blue-50/70',
    })),
  ].slice(0, 4), [openRisks, blockedActions, reviewRequirements]);

  const recentActivities = useMemo(() => [
    ...(Array.isArray(meetings) ? meetings : []).slice(0, 5).filter(Boolean).map((meeting: any) => ({
      id: `meeting-${meeting.id}`,
      title: `新增会议：${meeting.title || '无标题会议'}`,
      time: meeting.meetingDate || meeting.meeting_date || meeting.createdAt,
      detail: '会议纪要、行动项和讨论内容会在这里沉淀',
      action: () => router.push(`/meeting/${meeting.id}`),
      actionLabel: '查看会议',
    })),
    ...(Array.isArray(requirements) ? requirements : []).slice(0, 5).filter(Boolean).map(req => ({
      id: `requirement-${req.id}`,
      title: `需求更新：${req.title || '无标题需求'}`,
      time: req.updatedAt,
      detail: `${REQUIREMENT_STATUS_OPTIONS.find(opt => opt.value === req.status)?.label || req.status}${req.owner ? ` · ${req.owner}` : ''}`,
      action: () => setActiveTab('requirements'),
      actionLabel: '查看需求',
    })),
    ...(Array.isArray(risks) ? risks : []).slice(0, 5).filter(Boolean).map(risk => ({
      id: `risk-feed-${risk.id}`,
      title: `风险变化：${risk.title || '未命名风险'}`,
      time: risk.updatedAt,
      detail: `${risk.status === 'open' ? '处理中' : risk.status === 'mitigated' ? '已缓解' : '已关闭'}${risk.owner ? ` · ${risk.owner}` : ''}`,
      action: () => setActiveTab('risks'),
      actionLabel: '查看风险',
    })),
  ]
    .sort((a, b) => {
      const timeA = new Date(a.time || 0).getTime() || 0;
      const timeB = new Date(b.time || 0).getTime() || 0;
      return timeB - timeA;
    })
    .slice(0, 6), [meetings, requirements, risks, router]);

  const aiInsight = useMemo(() => {
    if (openRisks.length > 0) {
      return {
        eyebrow: '风险优先',
        title: `检测到 ${openRisks.length} 项开放风险需要同步处理`,
        desc: `优先收敛 ${openRisks[0]?.title || '关键风险'}，避免会议结论停留在纪要层。`,
        actionLabel: '查看风险清单',
        action: () => setActiveTab('risks'),
      };
    }
    if (blockedActions.length > 0) {
      return {
        eyebrow: '阻塞预警',
        title: `当前有 ${blockedActions.length} 项阻塞事项影响推进节奏`,
        desc: `建议先拆解 ${blockedActions[0]?.description || '关键阻塞事项'}，并同步责任人和时间点。`,
        actionLabel: '查看阻塞事项',
        action: () => setActiveTab('actions'),
      };
    }
    if (highPriorityRequirements.length > 0) {
      return {
        eyebrow: '需求聚焦',
        title: `有 ${highPriorityRequirements.length} 项高优需求值得优先推进`,
        desc: `从 ${highPriorityRequirements[0]?.title || '当前高优需求'} 开始，建立会议结论到交付动作的闭环。`,
        actionLabel: '查看高优需求',
        action: () => setActiveTab('requirements'),
      };
    }
    if (meetings.length === 0) {
      return {
        eyebrow: '待启动',
        title: '项目还没有会议沉淀，建议先关联一次核心会议',
        desc: '先把会议纪要接入项目，后续的需求、事项和风险才能自动形成上下文。',
        actionLabel: '去关联会议中心',
        action: () => setActiveTab('meetings'),
      };
    }
    return {
      eyebrow: '节奏稳定',
      title: '当前项目推进顺畅，会议和执行节奏保持一致',
      desc: '可以继续把新增决策沉淀为资料、需求和事项，保持项目脉动连续。',
      actionLabel: '查看会议中心脉动',
      action: () => setActiveTab('overview'),
    };
  }, [blockedActions, highPriorityRequirements, meetings.length, openRisks]);

  const aiStats = useMemo(() => ([
    { label: '待推进', value: pendingActions.length, tone: 'bg-blue-50 text-blue-700 border-blue-100' },
    { label: '开放风险', value: openRisks.length, tone: 'bg-amber-50 text-amber-700 border-amber-100' },
    { label: '关联会议', value: meetings.length, tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  ]), [meetings.length, openRisks.length, pendingActions.length]);

  const projectTabs = [
    { key: 'overview', label: '项目驾驶舱', icon: TrendingUp },
  { key: 'meetings', label: `会议中心`, icon: FileText },
  { key: 'docs', label: `资料库`, icon: BookOpen },
  { key: 'requirements', label: `需求`, icon: Users },
  { key: 'actions', label: `待办中心`, icon: CheckSquare },
  { key: 'risks', label: `风险`, icon: AlertTriangle },
] as const;

  const PROJECT_STAGES = [
    { key: 'analysis', label: '需求分析', desc: '提炼会议共识，输出需求文档', icon: Search },
    { key: 'design', label: '方案设计', desc: '技术方案评审，交互UI设计', icon: Lightbulb },
    { key: 'dev', label: '研发实现', desc: '代码编写，功能开发，接口对接', icon: FileText },
    { key: 'test', label: '测试验证', desc: '质量保证，冒烟测试，缺陷修复', icon: ListChecks },
    { key: 'live', label: '交付上线', desc: '版本发布，上线运营，项目结项', icon: Check },
  ];

  const currentStageIndex = useMemo(() => {
    // 简单模拟：根据进度或状态映射阶段
    if (project?.status === 'completed') return 4;
    if (doneRate >= 80) return 3;
    if (doneRate >= 30) return 2;
    if (requirements.length > 0) return 1;
    return 0;
  }, [project?.status, doneRate, requirements.length]);

  const milestoneItems = PROJECT_STAGES.map((stage, idx) => {
    const status = idx < currentStageIndex ? 'done' : idx === currentStageIndex ? 'current' : 'pending';
    const eta = estimateMilestoneDate(project?.createdAt, project?.targetDate, idx, PROJECT_STAGES.length);
    const stageProgressText =
      idx === 0 ? `${meetings.length} 场会议沉淀` :
      idx === 1 ? `${requirements.length} 项需求流转` :
      idx === 2 ? `${pendingActions.length} 项事项推进` :
      idx === 3 ? `${openRisks.length} 项风险待验证` :
      project?.targetDate ? `目标交付 ${formatZhDate(project.targetDate)}` : '待确认交付时间';

    return {
      ...stage,
      status,
      eta,
      progressText: stageProgressText,
    };
  });

  const currentMilestone = milestoneItems[currentStageIndex];
  const nextMilestone = milestoneItems.find(item => item.status === 'pending') || milestoneItems[milestoneItems.length - 1];
  const pulseSeries = useMemo(() => {
    const total = 36;
    const meetingCount = Array.isArray(meetings) ? meetings.length : 0;
    const positions = meetingCount > 0
      ? Array.from({ length: meetingCount }, (_, idx) => Math.round(((idx + 1) * (total - 1)) / (meetingCount + 1)))
      : [];

    return Array.from({ length: total }, (_, i) => {
      const wave = 28 + Math.sin(i * 0.42) * 11 + Math.cos(i * 0.24) * 6;
      const stageBoost = currentStageIndex * 2.5;
      const nearestMeetingDistance = positions.length > 0 ? Math.min(...positions.map(pos => Math.abs(pos - i))) : 99;
      const meetingBoost = nearestMeetingDistance < 2 ? 28 : nearestMeetingDistance < 4 ? 16 : nearestMeetingDistance < 6 ? 7 : 0;
      const height = Math.max(18, Math.min(88, Math.round(wave + stageBoost + meetingBoost)));
      const meetingIndex = positions.indexOf(i);
      const currentMeeting = meetingIndex !== -1 ? meetings[meetingIndex] : null;
      return {
        id: `pulse-${i}`,
        height,
        currentMeeting,
        hasMeeting: !!currentMeeting,
        isRecent: i > total - 8,
      };
    });
  }, [currentStageIndex, meetings]);

  const currentMilestoneAction = useMemo(() => {
    if (currentMilestone.key === 'analysis') {
      return {
        label: '查看会议中心',
        go: () => setActiveTab('meetings'),
      };
    }
    if (currentMilestone.key === 'design') {
      return {
        label: '查看方案资料',
        go: () => setActiveTab('docs'),
      };
    }
    if (currentMilestone.key === 'dev') {
      return {
        label: '进入待办中心',
        go: () => setActiveTab('actions'),
      };
    }
    if (currentMilestone.key === 'test') {
      return {
        label: '查看验证与风险',
        go: () => setActiveTab(openRisks.length > 0 ? 'risks' : 'actions'),
      };
    }
    return {
      label: '查看项目概览',
      go: () => setActiveTab('overview'),
    };
  }, [currentMilestone.key, openRisks.length]);

  if (loading) return (
    <DashboardLayout>
      <div className="flex items-center justify-center h-64 text-slate-400">加载中...</div>
    </DashboardLayout>
  );

  if (!project) return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <FolderOpen className="w-12 h-12 opacity-30" />
        <p>项目不存在</p>
        <button onClick={() => router.push('/')} className="text-sm text-blue-600 hover:underline">返回工作台</button>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-12">
        {/* ── 顶层信息栏 (更紧凑) ── */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 px-1">
          <div className="flex items-start gap-3 text-sm">
            <button 
              onClick={() => router.push('/projects')} 
              className="mt-1 p-2 rounded-xl bg-slate-100 text-slate-500 hover:text-blue-600 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Project Space</span>
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${statusInfo.bg} ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
                {project.phase && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter bg-slate-100 text-slate-500">
                    {project.phase}
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">{project.name}</h1>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500">
                {project.owner && <span className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-100">负责人 {project.owner}</span>}
                <span className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-100">{meetings.length} 场关联会议</span>
                {project.targetDate && <span className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-100">目标交付 {formatZhDate(project.targetDate)}</span>}
              </div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex items-center gap-1.5 p-1.5 rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
              <div className="flex items-center px-3 py-1.5 gap-3">
                <div className="text-right">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Healthy</p>
                  <p className={`mt-1 text-sm font-black ${healthScore !== null && healthScore >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>{healthScore ?? '--'}</p>
                </div>
                <div className="w-px h-6 bg-slate-100" />
                <div className="text-right">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Progress</p>
                  <p className="mt-1 text-sm font-black text-slate-900">{doneRate}%</p>
                </div>
                <div className="w-px h-6 bg-slate-100" />
                <div className="text-right min-w-[60px]">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Milestone</p>
                  <p className="mt-1 text-sm font-black text-blue-600 truncate">{currentMilestone.label}</p>
                </div>
              </div>

              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={handleOpenPushPreview}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-indigo-50 border border-indigo-100 px-3 text-xs font-bold text-indigo-600 hover:bg-indigo-100 transition-all"
                  title="预览推送内容"
                >
                  <Eye className="w-3.5 h-3.5" />
                  推送预览
                </button>
                <button
                  onClick={() => {
                    setCreatingArtifact(true);
                    setArtifactForm({ artifactType: 'other' });
                  }}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 text-xs font-bold text-slate-600 hover:text-blue-600 hover:border-blue-200 transition-all"
                  title="添加文档"
                >
                  <Plus className="w-3.5 h-3.5" />
                  资料
                </button>
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/projects/${projectId}/weekly-report`);
                    const d = await res.json();
                    if (d.success) {
                      alert(`周报生成成功！\n\n本周完成: ${d.data.summary.completedThisWeek}\n新增行动项: ${d.data.summary.addedThisWeek}\n风险: ${d.data.risks.join(', ')}`);
                    } else {
                      alert('生成失败: ' + d.error);
                    }
                  }}
                  className="inline-flex h-9 items-center gap-1.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold hover:shadow-lg hover:shadow-blue-200 transition-all active:scale-[0.98]"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  智能周报
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── 导航 Tabs & 视图切换 (合并大厂风格) ── */}
        <div className="flex items-center justify-between border-b border-slate-100 px-1 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-6">
            {projectTabs.map(({ key, label, icon: Icon }) => {
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`
                    flex items-center gap-2 py-4 text-sm font-bold transition-all relative whitespace-nowrap
                    ${isActive ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}
                  `}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-600' : 'text-slate-300'}`} />
                  {label}
                  {isActive && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center -space-x-1.5 mr-2">
              {(project?.members || []).slice(0, 3).map((m, i) => (
                <div key={i} className="w-6 h-6 rounded-lg border-2 border-white bg-slate-100 flex items-center justify-center text-[8px] font-black text-slate-500 shadow-sm" title={m || 'Unknown'}>
                  {m ? m[0].toUpperCase() : 'U'}
                </div>
              ))}
              <button className="w-6 h-6 rounded-lg border-2 border-white bg-slate-50 flex items-center justify-center text-[10px] text-slate-300 shadow-sm hover:bg-blue-50 hover:text-blue-500 transition-colors">
                +
              </button>
            </div>
            <div className="hidden lg:flex items-center gap-1 p-1 bg-slate-50 rounded-xl">
              <button className="p-1.5 rounded-lg bg-white shadow-sm text-blue-600"><TrendingUp className="w-3.5 h-3.5" /></button>
              <button className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"><CheckSquare className="w-3.5 h-3.5" /></button>
              <button className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"><FileText className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>

        {/* ── 内容区域 ── */}
        <div className="min-h-[400px]">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
              
              {/* 左侧主要区域：会议脉动与关键路径 */}
              <div className="lg:col-span-8 space-y-8">
                
                {/* 1. 会议脉动 & Roadmap (视觉中心) */}
                <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm relative overflow-hidden group">
                  {/* 背景装饰：极淡的径向渐变，增加深度感 */}
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(59,130,246,0.03),transparent_70%)] pointer-events-none" />
                  
                  <div className="flex items-start justify-between mb-8 relative z-10 gap-4">
                    <div className="space-y-2">
                      <h3 className="text-xl font-black text-slate-900 tracking-tight">项目脉动</h3>
                      <p className="text-xs text-slate-400 font-medium">Meeting-Driven Execution Rhythm</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-[10px] font-black text-blue-600 uppercase tracking-wider">
                          当前：{currentMilestone.label}
                        </span>
                        <span className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                          下一步：{nextMilestone.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">决策脉冲</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">执行基座</span>
                          </div>
                        </div>
                        <div className="w-px h-3 bg-slate-100" />
                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-50/50 border border-blue-100/50">
                          <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                          <span className="text-[9px] font-black text-blue-600 uppercase tracking-wider">Active Pulse</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 脉动可视化图表 - 升级为平滑节奏感设计 */}
                  <div className="mb-8 h-40 flex items-end gap-[3px] px-1 relative z-10">
                    {/* 背景网格线 */}
                    <div className="absolute inset-0 flex flex-col justify-between py-2 pointer-events-none opacity-40">
                      {[1, 2, 3].map(i => <div key={i} className="w-full h-[0.5px] bg-slate-100" />)}
                    </div>
                    
                    {pulseSeries.map((bar, i) => {
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 group/bar relative h-full justify-end">
                          {bar.hasMeeting && (
                            <div 
                              className="absolute -top-10 left-1/2 -translate-x-1/2 z-20 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/meeting/${bar.currentMeeting.id}`);
                              }}
                            >
                              <div className="relative">
                                <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20 scale-150" />
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center border-2 border-white shadow-xl relative z-10 transform group-hover/bar:scale-110 transition-transform">
                                  <Sparkles className="w-3.5 h-3.5 text-white" />
                                </div>
                              </div>
                              <div className="w-px h-5 bg-gradient-to-b from-blue-300 to-transparent mx-auto mt-0.5" />
                            </div>
                          )}
                          
                          <div 
                            className={`
                              w-full rounded-t-full transition-all duration-700 ease-out
                              ${bar.hasMeeting 
                                ? 'bg-gradient-to-t from-blue-600/80 to-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                                : bar.isRecent 
                                  ? 'bg-gradient-to-t from-slate-200 to-slate-100 group-hover/bar:from-blue-200 group-hover/bar:to-blue-100'
                                  : 'bg-slate-100/80 group-hover/bar:bg-slate-200'}
                            `} 
                            style={{ 
                              height: `${bar.height}%`,
                              opacity: bar.hasMeeting ? 1 : 0.6 + (bar.height / 200)
                            }} 
                          />
                          
                          <div className="absolute bottom-full mb-3 hidden group-hover/bar:block z-30 pointer-events-none">
                            <div className="bg-slate-900/90 backdrop-blur-md text-white text-[9px] font-bold px-2.5 py-1.5 rounded-lg shadow-2xl whitespace-nowrap text-center">
                              {bar.hasMeeting ? (bar.currentMeeting?.title || '关键决策会议') : `执行密度: ${bar.height}%`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mb-6 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>启动</span>
                    <span>当前阶段 {currentMilestone.label}</span>
                    <span>{project.targetDate ? `目标 ${formatZhDate(project.targetDate)}` : '持续推进'}</span>
                  </div>

                  {/* 阶段指示器 (采用胶囊式设计) */}
                  <div className="relative pt-6 px-2 border-t border-slate-50 flex items-center justify-between z-10">
                    <div className="flex items-center gap-1">
                      {PROJECT_STAGES.map((stage, idx) => {
                        const isPast = idx < currentStageIndex;
                        const isCurrent = idx === currentStageIndex;
                        return (
                          <div key={stage.key} className="flex items-center">
                            <div 
                              className={`
                                h-1.5 rounded-full transition-all duration-500
                                ${isPast ? 'w-8 bg-emerald-400' : isCurrent ? 'w-12 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.4)]' : 'w-4 bg-slate-100'}
                              `} 
                              title={stage.label}
                            />
                            {idx < PROJECT_STAGES.length - 1 && <div className="w-1" />}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      Phase: <span className="text-slate-900">{PROJECT_STAGES[currentStageIndex].label}</span>
                    </p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
                    <div className="space-y-3 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Flag className="w-4.5 h-4.5 text-blue-500" />
                        <h3 className="text-base font-black text-slate-900">项目里程碑</h3>
                        <span className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-[10px] font-black text-blue-600 uppercase tracking-wider">
                          {currentMilestone.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">当前里程碑</p>
                          <div className="mt-1 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-black text-slate-800 truncate">{currentMilestone.label}</p>
                              <p className="mt-1 text-[11px] text-slate-500 truncate">{currentMilestone.progressText}</p>
                            </div>
                            <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">
                              {currentMilestone.eta ? formatZhDate(currentMilestone.eta) : '待排期'}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">下一里程碑</p>
                          <div className="mt-1 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-black text-slate-800 truncate">{nextMilestone.label}</p>
                              <p className="mt-1 text-[11px] text-slate-500 truncate">{nextMilestone.desc}</p>
                            </div>
                            <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">
                              {nextMilestone.eta ? formatZhDate(nextMilestone.eta) : '待排期'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="lg:w-[260px] xl:w-[300px]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Milestone Track</span>
                        <button
                          onClick={currentMilestoneAction.go}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700"
                        >
                          {currentMilestoneAction.label}
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        {milestoneItems.map((milestone, idx) => {
                          const Icon = milestone.icon;
                          const isDone = milestone.status === 'done';
                          const isCurrent = milestone.status === 'current';
                          return (
                            <React.Fragment key={milestone.key}>
                              <div
                                title={`${milestone.label} · ${milestone.eta ? formatZhDate(milestone.eta) : '待排期'}`}
                                className={`w-9 h-9 rounded-2xl flex items-center justify-center border transition-all ${
                                  isDone
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                    : isCurrent
                                      ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm'
                                      : 'bg-slate-50 border-slate-200 text-slate-400'
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5" />
                              </div>
                              {idx < milestoneItems.length - 1 && (
                                <div className={`flex-1 h-1 rounded-full ${idx < currentStageIndex ? 'bg-emerald-300' : idx === currentStageIndex ? 'bg-blue-300' : 'bg-slate-200'}`} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. 关键阻塞与风险 (只在有内容时显著显示) */}
                <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-500" /> 关键阻塞与路径
                    </h3>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      {focusItems.length} Items Need Attention
                    </span>
                  </div>
                  
                  <div className="space-y-4">
                    {focusItems.length === 0 ? (
                      <div className="py-12 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-100">
                        <p className="text-sm font-bold text-slate-400">目前关键路径畅通，暂无阻塞事项</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {focusItems.map(item => (
                          <div key={item.id} className="p-5 rounded-2xl border border-slate-100 bg-slate-50/30 hover:bg-white hover:shadow-xl transition-all group cursor-pointer" onClick={item.action}>
                            <div className="flex items-start justify-between mb-3">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-widest ${
                                item.type === 'risk' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {item.type === 'risk' ? '风险' : '阻塞'}
                              </span>
                              <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-500 transition-colors" />
                            </div>
                            <h4 className="text-sm font-bold text-slate-800 leading-tight mb-2 group-hover:text-blue-600 transition-colors">{item.title}</h4>
                            <p className="text-[11px] text-slate-400 font-medium">{item.desc}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 右侧边栏：AI 助手与动态 */}
              <div className="lg:col-span-4 space-y-8">
                
                {/* AI 决策捕获 */}
                <div className="bg-gradient-to-br from-blue-50/50 via-white to-indigo-50/50 rounded-3xl p-6 text-slate-800 shadow-xl shadow-blue-100/40 border border-blue-100/60 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-indigo-500/15 transition-colors duration-700" />
                  
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-6">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
                            <Sparkles className="w-4 h-4 text-white" />
                          </div>
                          <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">AI 决策捕获</h3>
                        </div>
                        <p className="text-[11px] text-slate-400 font-medium">从会议纪要中自动提取执行建议</p>
                      </div>
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-50 border border-blue-100">
                        <span className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-[9px] font-black uppercase tracking-wider text-blue-600">Auto</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mb-5">
                      {aiStats.map(stat => (
                        <div key={stat.label} className="rounded-2xl border border-slate-100 px-3 py-2.5 bg-white/60 hover:bg-white transition-colors">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-none">{stat.label}</p>
                          <p className="mt-1.5 text-base font-black text-slate-900">{stat.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-4">
                      <div className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer group/item relative overflow-hidden" onClick={aiInsight.action}>
                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-600" />
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[9px] font-bold text-blue-600 uppercase tracking-tighter">{aiInsight.eyebrow}</p>
                          <ArrowUpRight className="w-3 h-3 text-slate-300 group-hover/item:text-blue-600 transition-colors" />
                        </div>
                        <p className="text-xs font-bold leading-relaxed text-slate-800">{aiInsight.title}</p>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{aiInsight.desc}</p>
                      </div>

                      <div className="rounded-2xl border border-blue-100/50 bg-blue-50/30 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">下一步建议</p>
                            <p className="mt-1 text-xs font-bold text-slate-700 truncate">{aiInsight.actionLabel}</p>
                          </div>
                          <button
                            onClick={aiInsight.action}
                            className="flex-shrink-0 h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-[11px] font-black text-white transition-all shadow-md shadow-blue-200"
                          >
                            执行
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 项目动态流 */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm group">
                  <div className="flex items-start justify-between mb-6">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-slate-100 rounded-xl flex items-center justify-center">
                          <Clock className="w-4 h-4 text-slate-500" />
                        </div>
                        <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">项目执行动态</h3>
                      </div>
                      <p className="text-[11px] text-slate-400 font-medium">按时间轴记录的协作与决策流</p>
                    </div>
                    <span className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-[9px] font-black uppercase tracking-wider text-slate-400">
                      Timeline
                    </span>
                  </div>
                  
                  <div className="space-y-6 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-slate-50">
                    {recentActivities.slice(0, 5).map(item => (
                      <div key={item.id} className="relative pl-8 group/item cursor-pointer" onClick={item.action}>
                        <div className="absolute left-0 top-1 w-[22px] h-[22px] rounded-lg bg-white border border-slate-200 flex items-center justify-center z-10 group-hover/item:border-blue-500 transition-colors">
                          <div className="w-1 h-1 rounded-full bg-slate-300 group-hover/item:bg-blue-500 transition-colors" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-slate-700 leading-snug group-hover/item:text-blue-600 transition-colors">{item.title}</p>
                          <p className="text-[10px] font-black text-slate-300 uppercase tracking-tighter">{formatZhDate(item.time, true)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <button onClick={() => setActiveTab('meetings')} className="w-full h-10 mt-6 rounded-xl border border-slate-100 bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:bg-slate-50 hover:text-slate-600 transition-all">
                    查看完整记录
                  </button>
                </div>
              </div>

            </div>
          )}

        {activeTab === 'meetings' && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-sm font-medium text-slate-700">{meetings.length} 场关联会议</span>
              <button
                onClick={() => router.push(`/?project_id=${projectId}`)}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:bg-blue-50 px-2 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 关联会议
              </button>
            </div>
            {meetings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                <FileText className="w-8 h-8 opacity-30" />
                <p className="text-sm">暂无关联会议</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {meetings.map((meeting: any) => (
                  <button
                    key={meeting.id}
                    onClick={() => router.push(`/meeting/${meeting.id}`)}
                    className="w-full flex items-center gap-3 px-4 py-4 hover:bg-slate-50 transition-colors text-left"
                  >
                    <FileText className="w-4 h-4 text-slate-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{meeting.title}</p>
                      <p className="text-xs text-slate-400 mt-1">{formatZhDate(meeting.meetingDate || meeting.meeting_date)}</p>
                    </div>
                    <span className="text-xs text-slate-400">查看详情</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'docs' && (
          <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_280px] gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl flex flex-col min-h-[640px]">
              <div className="p-4 border-b border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-blue-500" /> 项目文档
                  </h3>
                  <button 
                    onClick={() => {
                      setCreatingArtifact(true);
                      setArtifactForm({ artifactType: 'other' });
                    }}
                    className="p-1 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                    title="添加新资料"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      value={docSearch}
                      onChange={e => setDocSearch(e.target.value)}
                      placeholder="搜索标题或正文"
                      className="w-full pl-8 pr-2 py-2 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                  <select
                    value={docTypeFilter}
                    onChange={e => setDocTypeFilter(e.target.value as typeof docTypeFilter)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 text-slate-600"
                  >
                    {docTypeOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {filteredDocs.length === 0 ? (
                  <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-xs text-slate-400 gap-1">
                    <FileText className="w-8 h-8 text-slate-200" />
                    暂无符合条件的文档
                  </div>
                ) : filteredDocs.map(doc => {
                  const docStatus = PARSE_STATUS_MAP[doc.parseStatus] || PARSE_STATUS_MAP.pending;
                  const isSelected = selectedDoc?.id === doc.id;
                  return (
                    <button
                      key={doc.id}
                      onClick={() => setSelectedDocId(doc.id)}
                      className={`w-full text-left px-4 py-3 transition-colors ${isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>{formatZhDate(doc.createdAt)}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${docStatus.cls}`}>{docStatus.label}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{ARTIFACT_TYPE_MAP[doc.artifactType] || '其他'}</span>
                        <span className="text-sm font-medium text-slate-700 truncate">{doc.title || '未命名文档'}</span>
                      </div>
                      {doc.sourceRef && <p className="text-[11px] text-slate-400 mt-1 truncate">来源：{doc.sourceRef}</p>}
                    </button>
                  );
                })}
              </div>
              <div className="p-4 border-t border-slate-100 text-xs text-slate-400">
                共 {filteredDocs.length} 份项目资料
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 min-h-[640px]">
              {selectedDoc ? (
                <div className="flex flex-col h-full">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 border-b border-slate-100 pb-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                          {ARTIFACT_TYPE_MAP[selectedDoc.artifactType] || selectedDoc.artifactType}
                        </span>
                        <h2 className="text-lg font-semibold text-slate-800 break-words">{selectedDoc.title || '未命名文档'}</h2>
                      </div>
                      <p className="text-xs text-slate-400 mt-2">
                        {selectedDoc.createdBy ? `${selectedDoc.createdBy} · ` : ''}
                        {formatZhDate(selectedDoc.createdAt, true)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                        导出
                      </button>
                      <button
                        onClick={() => setActiveTab('requirements')}
                        className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50"
                      >
                        提炼为需求
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto pt-4 space-y-4 text-sm leading-7 text-slate-700">
                    {selectedDocParagraphs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100">
                          <FileText className="w-8 h-8 text-slate-300" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-slate-600">该文档暂无内容</p>
                          <p className="text-xs text-slate-400">你可以编辑文档标题或直接添加正文内容</p>
                        </div>
                        <button 
                          onClick={() => {
                            setCreatingArtifact(true);
                            setArtifactForm(selectedDoc);
                          }}
                          className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20"
                        >
                          完善内容
                        </button>
                      </div>
                    ) : selectedDocParagraphs.map(para => (
                      <p key={para.id}>{para.text}</p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs gap-2">
                  <BookOpen className="w-10 h-10 text-slate-200" />
                  请选择左侧文档查看详情
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-500" /> 智能建议
                  </h3>
                  <span className="text-[11px] text-slate-400">完成度 {docCompletionStats.percent}%</span>
                </div>
                {docRelatedRequirements.length === 0 ? (
                  <p className="text-xs text-slate-400">暂无强相关需求，建议从当前文档提炼关键结论。</p>
                ) : (
                  <div className="space-y-2">
                    {docRelatedRequirements.map(req => (
                      <div key={req.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-xs text-slate-700 truncate">{req.title}</div>
                          <div className="text-[11px] text-slate-400 mt-1">{REQUIREMENT_STATUS_OPTIONS.find(opt => opt.value === req.status)?.label}</div>
                        </div>
                        <button onClick={() => setActiveTab('requirements')} className="text-[11px] text-blue-500 hover:text-blue-600">查看</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-emerald-500" /> 待跟进事项
                </h3>
                {docSuggestedActions.length === 0 ? (
                  <p className="text-xs text-slate-400">暂无待处理事项。</p>
                ) : (
                  <div className="space-y-2">
                    {docSuggestedActions.map(action => (
                      <div key={action.id} className="border border-slate-100 rounded-xl px-3 py-2 bg-slate-50">
                        <div className="text-xs text-slate-700">{action.description}</div>
                        <div className="text-[11px] text-slate-400 mt-1">{action.owner || '未分配'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> 风险提醒
                </h3>
                {docRiskAlerts.length === 0 ? (
                  <p className="text-xs text-slate-400">暂无风险提醒。</p>
                ) : (
                  <div className="space-y-2">
                    {docRiskAlerts.map(risk => (
                      <div key={risk.id} className="border border-amber-200 bg-amber-50 rounded-xl px-3 py-2 flex justify-between gap-2">
                        <span className="text-xs text-slate-700 truncate">{risk.title}</span>
                        <button onClick={() => setActiveTab('risks')} className="text-[11px] text-amber-600 hover:text-amber-700 flex-shrink-0">查看</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'actions' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="text-xs text-slate-400">待推进</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{pendingActions.length}</div>
              </div>
              <div className="bg-white border border-red-100 rounded-2xl p-4 bg-red-50">
                <div className="text-xs text-red-500">阻塞事项</div>
                <div className="text-2xl font-semibold text-red-600 mt-1">{blockedActions.length}</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="text-xs text-slate-400">已逾期</div>
                <div className="text-2xl font-semibold text-slate-800 mt-1">{overdueActions.length}</div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span className="text-sm font-medium text-slate-700">{actionItems.length} 个跟进事项</span>
                <button
                  onClick={() => router.push('/kanban')}
                  className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1.5 rounded-lg transition-colors"
                >
                  前往看板
                </button>
              </div>
              {actionItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                  <CheckSquare className="w-8 h-8 opacity-30" />
                  <p className="text-sm">暂无跟进事项</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {actionItems.map(action => (
                    <div key={action.id} className="px-4 py-4">
                      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${ACTION_STATUS_COLOR[getActionDisplayStatus(action.status)] || 'bg-slate-100 text-slate-600'}`}>
                            {getActionDisplayLabel(action.status)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-700">{action.description}</p>
                            <p className="text-xs text-slate-400 mt-1">{action.meeting_title}</p>
                          </div>
                        </div>

                        {getDisplayOaResult(action.oa_result) && (
                          <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                            <div className="text-[10px] text-slate-400">上次汇报</div>
                            <div className="mt-1 text-xs text-slate-600 line-clamp-2">{getDisplayOaResult(action.oa_result)}</div>
                            {action.oa_attachments && action.oa_attachments.length > 0 && (
                              <div className="mt-2 flex gap-1">
                                {action.oa_attachments.slice(0, 3).map((url, index) => (
                                  <img key={`${action.id}-attachment-${index}`} src={url} alt="" className="h-10 w-10 rounded-lg border border-slate-200 object-cover" />
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4">
                          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                            <span>{action.owner || '未分配'}</span>
                            <span>{action.due_date ? `截止 ${action.due_date}` : '未设置截止时间'}</span>
                            <button onClick={() => router.push(`/meeting/${action.meeting_id}`)} className="text-blue-600 hover:text-blue-700">
                              查看会议
                            </button>
                          </div>
                          <div className="flex justify-end">
                            <button
                              onClick={() => openResult(action)}
                              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all ${
                                action.status === 'done'
                                  ? 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                  : 'border-blue-200 bg-white text-blue-600 hover:bg-blue-50'
                              }`}
                            >
                              {action.status === 'done' ? '查看 / 修改汇报' : '汇报进展'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'requirements' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-6 text-sm text-slate-500">
                <span>总数：<strong className="text-slate-800">{requirements.length}</strong></span>
                <span>待评审：<strong className="text-blue-600">{reviewRequirements.length}</strong></span>
                <span>已上线：<strong className="text-emerald-600">{stats?.requirementLive ?? 0}</strong></span>
              </div>
              <button
                onClick={() => { setCreatingRequirement(true); setRequirementForm({ status: 'draft', priority: 'medium', tags: [] }); setRequirementTagText(''); }}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 新建需求
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {requirements.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                  <Users className="w-8 h-8 opacity-30" />
                  <p className="text-sm">暂无需求，点击右上角新建</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {requirements.map(req => (
                    <div key={req.id} id={`req-${req.id}`} className="p-4 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${REQUIREMENT_PRIORITY_LABEL[req.priority].bg} ${REQUIREMENT_PRIORITY_LABEL[req.priority].color}`}>{REQUIREMENT_PRIORITY_LABEL[req.priority].label}</span>
                            <h4 className="text-sm font-semibold text-slate-700 truncate">{req.title}</h4>
                            <select
                              value={req.status}
                              onChange={e => updateRequirementStatus(req.id, { status: e.target.value as Requirement['status'] })}
                              className="text-[11px] rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 border-0"
                            >
                              {REQUIREMENT_STATUS_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </div>
                          {req.description && (
                            <p className="text-xs text-slate-500 mt-1 whitespace-pre-line">{req.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-400">
                            {req.owner && <span>负责人：{req.owner}</span>}
                            {req.dueDate && <span>截止：{req.dueDate}</span>}
                            {req.tags?.length > 0 && (
                              <span className="flex items-center gap-1">标签：{req.tags.map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{tag}</span>
                              ))}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <select
                            value={req.priority}
                            onChange={e => updateRequirementStatus(req.id, { priority: e.target.value as Requirement['priority'] })}
                            className="text-[11px] bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-500"
                          >
                            <option value="high">高优先级</option>
                            <option value="medium">中优先级</option>
                            <option value="low">低优先级</option>
                          </select>
                          <button
                            onClick={() => deleteRequirementItem(req.id)}
                            className="text-[11px] text-slate-400 hover:text-red-500"
                          >删除</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'risks' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-6 text-sm text-slate-500">
                <span>风险数：<strong className="text-slate-800">{risks.length}</strong></span>
                <span>未关闭：<strong className="text-red-600">{stats?.riskOpen ?? 0}</strong></span>
              </div>
              <button
                onClick={() => { setCreatingRisk(true); setRiskForm({ level: 'medium', status: 'open', detectedBy: 'manual' }); }}
                className="flex items-center gap-1.5 text-xs text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> 记录风险
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {risks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                  <AlertTriangle className="w-8 h-8 opacity-30" />
                  <p className="text-sm">暂无风险</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {risks.map(risk => (
                    <div key={risk.id} className="p-4 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`w-2.5 h-2.5 rounded-full border ${RISK_LEVEL_STYLE[risk.level].ring} ${RISK_LEVEL_STYLE[risk.level].dot}`}></span>
                            <h4 className="text-sm font-semibold text-slate-700 truncate">{risk.title}</h4>
                            <select
                              value={risk.status}
                              onChange={e => updateRisk(risk.id, { status: e.target.value as ProjectRisk['status'] })}
                              className={`text-[11px] rounded-full px-2 py-0.5 border-0 ${RISK_STATUS_COLOR[risk.status]}`}
                            >
                              <option value="open">打开</option>
                              <option value="mitigated">已缓解</option>
                              <option value="closed">已关闭</option>
                            </select>
                          </div>
                          {risk.description && (
                            <p className="text-xs text-slate-500 mt-1 whitespace-pre-line">{risk.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-400">
                            <span>等级：{RISK_LEVEL_STYLE[risk.level].label}</span>
                            {risk.owner && <span>责任人：{risk.owner}</span>}
                            {risk.dueDate && <span>截止：{risk.dueDate}</span>}
                            {risk.mitigationPlan && <span className="text-slate-500">缓解：{risk.mitigationPlan}</span>}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <select
                            value={risk.level}
                            onChange={e => updateRisk(risk.id, { level: e.target.value as ProjectRisk['level'] })}
                            className="text-[11px] bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-500"
                          >
                            <option value="high">高风险</option>
                            <option value="medium">中风险</option>
                            <option value="low">低风险</option>
                          </select>
                          <button
                            onClick={() => deleteRisk(risk.id)}
                            className="text-[11px] text-slate-400 hover:text-red-500"
                          >删除</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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
                <p className="text-xs text-slate-400 mt-0.5">填写后自动同步到项目事项状态</p>
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
                      onClick={() => setResultForm(f => ({ ...f, status: opt.value }))}
                      className={`py-3 rounded-xl border-2 flex flex-col items-center gap-1 transition-all ${
                        resultForm.status === opt.value
                          ? `${opt.activeBg} border-transparent text-white shadow-md scale-[1.02]`
                          : `${opt.bg} ${opt.border} ${opt.text} hover:scale-[1.01]`
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
                  onClick={() => document.getElementById('project-action-img-upload')?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files);
                    setResultImages(prev => [...prev, ...files]);
                  }}
                >
                  <input
                    id="project-action-img-upload"
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => setResultImages(prev => [...prev, ...Array.from(e.target.files || [])])}
                  />
                  <div className="text-2xl mb-1">📎</div>
                  <div className="text-xs text-slate-400 group-hover:text-blue-500 transition-colors">点击上传 / 拖拽文件 / <b>Ctrl+V 粘贴截图</b></div>
                  <div className="text-[10px] text-slate-300 mt-0.5">支持 图片 · Word · Excel · PDF 等任意格式（单文件 ≤50MB）</div>
                </div>
                {resultImages.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {resultImages.map((file, index) => {
                      const isImg = file.type.startsWith('image/');
                      return (
                        <div key={`${file.name}-${index}`} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group bg-slate-50">
                          {isImg ? (
                            <img
                              src={URL.createObjectURL(file)}
                              alt=""
                              className="w-full h-full object-cover cursor-zoom-in"
                              onClick={() => {
                                const imgs = resultImages.filter(x => x.type.startsWith('image/'));
                                setSelPreviewIdx(Math.max(0, imgs.indexOf(file)));
                                setSelPreviewOpen(true);
                              }}
                            />
                          ) : (
                            <button type="button" onClick={() => setSelFilePreview(file)}
                              className="w-full h-full flex flex-col items-center justify-center gap-1 px-1 text-center hover:bg-slate-100">
                              <FileText className="w-5 h-5 text-slate-400" />
                              <span className="text-[10px] text-slate-500 break-all" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{file.name}</span>
                            </button>
                          )}
                          <button
                            onClick={() => setResultImages(prev => prev.filter((_, idx) => idx !== index))}
                            className="absolute top-1 right-1 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                    <div
                      className="aspect-square rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-all"
                      onClick={() => document.getElementById('project-action-img-upload')?.click()}
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
                  // 附件必填（至少 1 张）
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
                      fd.append('type', file.type.startsWith('image/') ? 'image' : 'file');
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
                      await fetchProjectDetail();
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

      {pushPreviewOpen && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) setPushPreviewOpen(false); }}
        >
          <div className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-[28px] border border-white/60 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-indigo-50 px-6 py-5">
              <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-blue-200/20 blur-3xl" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-200">
                      <Send className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-600">Push Preview</p>
                      <h3 className="mt-1 text-xl font-black text-slate-900">待办推送演示预览</h3>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-500">
                    不依赖 IM 实际连通，直接展示每位责任人将收到的消息内容，适合老板演示。
                  </p>
                </div>
                <button
                  onClick={() => setPushPreviewOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white/90 text-slate-400 transition-colors hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(92vh-96px)] overflow-y-auto px-6 py-6">
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleOpenPushPreview}
                  disabled={pushPreviewLoading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-bold text-blue-700 transition-all hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pushPreviewLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  刷新预览
                </button>
                <button
                  onClick={handleSendPushNow}
                  disabled={pushSending || !pushPreviewResult || pushPreviewResult.totalRecipients === 0}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-sm font-bold text-white shadow-lg shadow-blue-200 transition-all hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pushSending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  正式推送
                </button>
                {pushPreviewResult && (
                  <>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500">
                      命中责任人 {pushPreviewResult.totalRecipients} 人
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                      有待办 {pushPreviewResult.recipientsWithTodos} 人
                    </span>
                    <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
                      演示模式 {pushPreviewResult.dryRun ? '预览中' : '已发送'}
                    </span>
                  </>
                )}
              </div>

              {pushSendResult && (
                <div className={`mb-6 rounded-2xl border px-4 py-4 ${
                  pushSendResult.failures === 0
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-amber-200 bg-amber-50'
                }`}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className={`text-sm font-black ${
                        pushSendResult.failures === 0 ? 'text-emerald-700' : 'text-amber-700'
                      }`}>
                        {pushSendResult.failures === 0 ? '正式推送完成' : '正式推送已发起，但下游接口返回异常'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        成功 {pushSendResult.sent} 人，失败 {pushSendResult.failures} 人。即使下游未通，也不影响当前预览演示。
                      </p>
                    </div>
                    <div className="text-right text-xs font-bold text-slate-500">
                      <p>sent: {pushSendResult.sent}</p>
                      <p>failures: {pushSendResult.failures}</p>
                    </div>
                  </div>
                </div>
              )}

              {pushPreviewLoading && !pushPreviewResult ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {[0, 1].map(index => (
                    <div key={index} className="rounded-3xl border border-slate-100 bg-slate-50/80 p-5">
                      <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
                      <div className="mt-4 h-24 animate-pulse rounded-2xl bg-slate-200/70" />
                      <div className="mt-4 h-24 animate-pulse rounded-2xl bg-slate-200/50" />
                    </div>
                  ))}
                </div>
              ) : pushPreviewResult?.details?.length ? (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                  {pushPreviewResult.details.map((detail, index) => {
                    const previewCard = parsePushPreviewCard(detail.previewContent);
                    return (
                      <div key={`${detail.oaUserId}-${index}`} className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-black text-slate-900">{detail.ownerName}</p>
                              <p className="mt-1 text-xs font-medium text-slate-400">OA ID: {detail.oaUserId}</p>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-600">
                                {detail.count} 条待办
                              </span>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
                                detail.error
                                  ? 'bg-red-50 text-red-600'
                                  : 'bg-emerald-50 text-emerald-600'
                              }`}>
                                {detail.error ? '下游异常' : '内容已生成'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="p-5">
                          <div className="rounded-[24px] border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 shadow-inner">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">IM Card Demo</p>
                                <h4 className="mt-2 text-lg font-black text-slate-900">
                                  {previewCard?.title || '待办推送卡片'}
                                </h4>
                                <p className="mt-2 text-sm text-slate-500">
                                  {previewCard?.text || detail.skipped || '当前为在线预览内容，可直接用于演示。'}
                                </p>
                              </div>
                              <div className="rounded-2xl bg-white/80 px-3 py-2 text-right shadow-sm">
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Source</p>
                                <p className="mt-1 text-xs font-bold text-slate-700">研发驾驶舱</p>
                              </div>
                            </div>

                            {previewCard?.items?.length ? (
                              <div className="mt-5 space-y-3">
                                {previewCard.items.map((item, itemIndex) => (
                                  <div key={`${detail.oaUserId}-item-${itemIndex}`} className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-sm font-bold leading-6 text-slate-800">{item.text}</p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {item.status && (
                                            <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-600">{item.status}</span>
                                          )}
                                          {item.priority && (
                                            <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">优先级 {item.priority}</span>
                                          )}
                                        </div>
                                      </div>
                                      {item.dueDate && (
                                        <div className="rounded-xl bg-slate-50 px-2.5 py-2 text-right">
                                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">截止</p>
                                          <p className="mt-1 text-xs font-bold text-slate-700">{item.dueDate}</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : detail.previewContent ? (
                              <pre className="mt-5 whitespace-pre-wrap rounded-2xl bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
                                {detail.previewContent}
                              </pre>
                            ) : (
                              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center text-sm text-slate-400">
                                暂无可展示的预览内容
                              </div>
                            )}
                          </div>

                          {(detail.error || detail.skipped) && (
                            <div className={`mt-4 rounded-2xl border px-4 py-3 text-xs ${
                              detail.error
                                ? 'border-red-200 bg-red-50 text-red-600'
                                : 'border-slate-200 bg-slate-50 text-slate-500'
                            }`}>
                              {detail.error ? `下游返回异常：${detail.error}` : detail.skipped}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-16 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
                    <Send className="h-7 w-7 text-slate-300" />
                  </div>
                  <h4 className="mt-4 text-lg font-black text-slate-900">当前没有可预览的推送对象</h4>
                  <p className="mt-2 text-sm text-slate-500">
                    说明该项目下暂时没有已分配责任人的待办，或数据尚未刷新。
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 新建资料 Drawer */}
        {creatingArtifact && (
          <div className="fixed inset-0 z-[70] bg-black/30 flex justify-end backdrop-blur-sm" onClick={() => setCreatingArtifact(false)}>
            <div className="w-full max-w-md h-full bg-white border-l border-slate-200 shadow-2xl p-8 overflow-y-auto animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-blue-600 rounded-full" />
                  添加项目资料
                </h3>
                <button onClick={() => setCreatingArtifact(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">资料标题 *</label>
                  <input
                    className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none text-sm"
                    placeholder="例如：需求规格说明书 v1.0"
                    value={artifactForm.title ?? ''}
                    onChange={e => setArtifactForm(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">资料类型</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(ARTIFACT_TYPE_MAP).map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setArtifactForm(prev => ({ ...prev, artifactType: val as Artifact['artifactType'] }))}
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all border ${
                          artifactForm.artifactType === val 
                            ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' 
                            : 'bg-white text-slate-500 border-slate-100 hover:border-blue-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">正文内容 / 摘要</label>
                  <textarea
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none text-sm leading-relaxed"
                    rows={10}
                    placeholder="在此粘贴文档正文、会议结论或关键资料内容..."
                    value={artifactForm.content ?? ''}
                    onChange={e => setArtifactForm(prev => ({ ...prev, content: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">来源备注</label>
                  <input
                    className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none text-sm"
                    placeholder="如：来自 06-04 评审会纪要"
                    value={artifactForm.sourceRef ?? ''}
                    onChange={e => setArtifactForm(prev => ({ ...prev, sourceRef: e.target.value }))}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button
                    onClick={() => setCreatingArtifact(false)}
                    className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={submitArtifact}
                    disabled={!artifactForm.title?.trim()}
                    className="flex-[2] py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-50"
                  >
                    立即保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 新建需求 Drawer */}
        {creatingRequirement && (
          <div className="fixed inset-0 z-40 bg-black/30 flex justify-end" onClick={() => setCreatingRequirement(false)}>
            <div className="w-full max-w-md h-full bg-white border-l border-slate-200 shadow-xl p-6 overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-800">新建需求</h3>
                <button onClick={() => setCreatingRequirement(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <label className="text-xs text-slate-400">标题</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none"
                    placeholder="需求名称"
                    value={requirementForm.title ?? ''}
                    onChange={e => setRequirementForm(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">描述</label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none"
                    rows={4}
                    value={requirementForm.description ?? ''}
                    onChange={e => setRequirementForm(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400">优先级</label>
                    <select
                      className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                      value={requirementForm.priority ?? 'medium'}
                      onChange={e => setRequirementForm(prev => ({ ...prev, priority: e.target.value as Requirement['priority'] }))}
                    >
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">状态</label>
                    <select
                      className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                      value={requirementForm.status ?? 'draft'}
                      onChange={e => setRequirementForm(prev => ({ ...prev, status: e.target.value as Requirement['status'] }))}
                    >
                      {REQUIREMENT_STATUS_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400">负责人</label>
                    <input
                      className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                      value={requirementForm.owner ?? ''}
                      onChange={e => setRequirementForm(prev => ({ ...prev, owner: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">截止日期</label>
                    <input
                      type="date"
                      className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                      value={requirementForm.dueDate ?? ''}
                      onChange={e => setRequirementForm(prev => ({ ...prev, dueDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400">标签（逗号分隔）</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                    value={requirementTagText}
                    onChange={e => setRequirementTagText(e.target.value)}
                    placeholder="如：交付、性能"
                  />
                </div>
                <button
                  onClick={submitRequirement}
                  className="w-full bg-blue-600 text-white text-sm py-2 rounded-lg hover:bg-blue-500"
                >
                  保存需求
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 新建风险 Drawer */}
        {creatingRisk && (
          <div className="fixed inset-0 z-40 bg-black/30 flex justify-end" onClick={() => setCreatingRisk(false)}>
            <div className="w-full max-w-md h-full bg-white border-l border-slate-200 shadow-xl p-6 overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-800">记录风险</h3>
                <button onClick={() => setCreatingRisk(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <label className="text-xs text-slate-400">风险标题</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none"
                    placeholder="描述风险事件"
                    value={riskForm.title ?? ''}
                    onChange={e => setRiskForm(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">风险详情</label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg focus:border-blue-500 focus:outline-none"
                    rows={4}
                    value={riskForm.description ?? ''}
                    onChange={e => setRiskForm(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400">风险等级</label>
                    <select
                      className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                      value={riskForm.level ?? 'medium'}
                      onChange={e => setRiskForm(prev => ({ ...prev, level: e.target.value as ProjectRisk['level'] }))}
                    >
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">状态</label>
                    <select
                      className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                      value={riskForm.status ?? 'open'}
                      onChange={e => setRiskForm(prev => ({ ...prev, status: e.target.value as ProjectRisk['status'] }))}
                    >
                      <option value="open">打开</option>
                      <option value="mitigated">已缓解</option>
                      <option value="closed">已关闭</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400">责任人</label>
                    <input
                      className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                      value={riskForm.owner ?? ''}
                      onChange={e => setRiskForm(prev => ({ ...prev, owner: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">截止日期</label>
                    <input
                      type="date"
                      className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                      value={riskForm.dueDate ?? ''}
                      onChange={e => setRiskForm(prev => ({ ...prev, dueDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400">缓解方案</label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg"
                    rows={3}
                    value={riskForm.mitigationPlan ?? ''}
                    onChange={e => setRiskForm(prev => ({ ...prev, mitigationPlan: e.target.value }))}
                  />
                </div>
                <button
                  onClick={submitRisk}
                  className="w-full bg-blue-600 text-white text-sm py-2 rounded-lg hover:bg-blue-500"
                >
                  保存风险
                </button>
              </div>
            </div>
          </div>
        )}

      {/* 已选附件预览（图片放大 / 文件在线预览） */}
      <ImagePreview
        images={resultImages.filter(f => f.type.startsWith('image/')).map(f => URL.createObjectURL(f))}
        index={selPreviewIdx}
        open={selPreviewOpen}
        onClose={() => setSelPreviewOpen(false)}
      />
      {selFilePreview && (
        <FilePreview
          url={URL.createObjectURL(selFilePreview)}
          filename={selFilePreview.name}
          mime={selFilePreview.type}
          open={!!selFilePreview}
          onClose={() => setSelFilePreview(null)}
        />
      )}

      </div>
    </DashboardLayout>
  );
}
