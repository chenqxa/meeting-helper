'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CircleDashed,
  ChevronRight,
  Clock,
  Flag,
  X,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Input } from '@/components/ui/input';

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

interface ProjectStats {
  meetingCount: number;
  artifactCount: number;
  requirementCount: number;
  requirementLive: number;
  actionTotal: number;
  actionDone: number;
  actionBlocked: number;
  riskOpen: number;
}

interface ProjectCardState {
  project: Project;
  stats: ProjectStats;
}

const STATUS_META: Record<Project['status'], { label: string; badge: string; dot: string }> = {
  planning: { label: '规划中', badge: 'bg-slate-100 text-slate-600', dot: 'bg-slate-300' },
  active: { label: '进行中', badge: 'bg-blue-100 text-blue-600', dot: 'bg-blue-500' },
  at_risk: { label: '有风险', badge: 'bg-amber-100 text-amber-600', dot: 'bg-amber-500' },
  completed: { label: '已完成', badge: 'bg-emerald-100 text-emerald-600', dot: 'bg-emerald-500' },
  archived: { label: '已归档', badge: 'bg-slate-200 text-slate-500', dot: 'bg-slate-400' },
};

const QUICK_LINKS: Array<{
  key: keyof ProjectStats;
  label: string;
  color: string;
  tab: 'meetings' | 'docs' | 'requirements' | 'actions' | 'risks';
}> = [
  { key: 'artifactCount', label: '资料库', color: 'bg-blue-50 text-blue-600', tab: 'docs' },
  { key: 'requirementCount', label: '需求', color: 'bg-purple-50 text-purple-600', tab: 'requirements' },
  { key: 'actionTotal', label: '待办中心', color: 'bg-emerald-50 text-emerald-600', tab: 'actions' },
  { key: 'riskOpen', label: '风险', color: 'bg-amber-50 text-amber-600', tab: 'risks' },
];

const EMPTY_STATS: ProjectStats = {
  meetingCount: 0,
  artifactCount: 0,
  requirementCount: 0,
  requirementLive: 0,
  actionTotal: 0,
  actionDone: 0,
  actionBlocked: 0,
  riskOpen: 0,
};

const formatZhDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
};

const getPendingActions = (stats: ProjectStats) => Math.max(0, stats.actionTotal - stats.actionDone);

const getProgressPercent = (stats: ProjectStats) => {
  if (stats.actionTotal <= 0) return 0;
  return Math.round((stats.actionDone / stats.actionTotal) * 100);
};

const getNextStep = (stats: ProjectStats) => {
  const pendingActions = getPendingActions(stats);
  if (stats.riskOpen > 0) return `${stats.riskOpen} 个风险待处理`;
  if (pendingActions > 0) return `${pendingActions} 个待办待推进`;
  if (stats.requirementLive > 0) return `已上线 ${stats.requirementLive} 项需求`;
  return '先关联会议，把项目内容沉淀进来';
};

const getFocusLabel = (project: Project, stats: ProjectStats) => {
  if (stats.riskOpen > 0 || project.status === 'at_risk') return '优先处理风险';
  if (getPendingActions(stats) > 0) return '优先推进待办';
  if (stats.requirementLive > 0) return '关注交付成效';
  return '补齐项目内容';
};

export default function ProjectsWorkspacePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<ProjectCardState[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectOwner, setNewProjectOwner] = useState('');
  const [newProjectDate, setNewProjectDate] = useState('');
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Project['status']>('all');

  useEffect(() => {
    const shouldOpen = searchParams.get('newProject') === 'true';
    if (shouldOpen) {
      setShowNewProject(true);
      router.replace('/projects', { scroll: false });
    }
  }, [router, searchParams]);

  useEffect(() => {
    setLoading(true);
    fetch('/api/projects')
      .then(r => r.json())
      .then(res => {
        if (!res.success) return;
        const base = Array.isArray(res.data) ? res.data : [];
        setProjects(base.map((item: any) => ({
          project: {
            id: item.id,
            name: item.name,
            description: item.description,
            status: item.status,
            phase: item.phase,
            owner: item.owner,
            members: item.members,
            targetDate: item.targetDate,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          } as Project,
          stats: item.stats || EMPTY_STATS,
        })));
      })
      .finally(() => setLoading(false));
  }, []);

  const totalProjects = useMemo(() => projects.length, [projects]);
  const filteredProjects = useMemo(() => {
    const lowerKeyword = keyword.trim().toLowerCase();
    const list = projects.filter(({ project }) => {
      const matchStatus = statusFilter === 'all' || project.status === statusFilter;
      if (!matchStatus) return false;
      if (!lowerKeyword) return true;
      const target = `${project.name} ${project.owner || ''} ${project.phase || ''} ${project.description || ''}`.toLowerCase();
      return target.includes(lowerKeyword);
    });

    // 排序逻辑：有风险的置顶，然后按更新时间
    return list.sort((a, b) => {
      if (a.project.status === 'at_risk' && b.project.status !== 'at_risk') return -1;
      if (a.project.status !== 'at_risk' && b.project.status === 'at_risk') return 1;
      return new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime();
    });
  }, [keyword, projects, statusFilter]);
  const riskProjectCount = useMemo(() => projects.filter(card => card.stats.riskOpen > 0 || card.project.status === 'at_risk').length, [projects]);
  const activeProjectCount = useMemo(() => projects.filter(card => card.project.status === 'active').length, [projects]);
  const totalPendingActions = useMemo(() => projects.reduce((sum, card) => sum + (card.stats.actionTotal - card.stats.actionDone), 0), [projects]);
  const liveRequirementCount = useMemo(() => projects.reduce((sum, card) => sum + card.stats.requirementLive, 0), [projects]);
  const highlightedProjects = useMemo(() => filteredProjects.slice(0, 4), [filteredProjects]);

  const openProject = (id: string) => {
    router.push(`/project/${id}`);
  };

  const handleQuickLink = (id: string, tab: string) => {
    router.push(`/project/${id}?tab=${tab}`);
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || isSavingProject) return;
    setIsSavingProject(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProjectName.trim(),
          owner: newProjectOwner || null,
          targetDate: newProjectDate || null,
        }),
      }).then(r => r.json());
      if (res.success) {
        const newCard: ProjectCardState = { project: res.data, stats: EMPTY_STATS };
        setProjects(prev => [newCard, ...prev]);
        setShowNewProject(false);
        setNewProjectName('');
        setNewProjectOwner('');
        setNewProjectDate('');

        router.push(`/project/${res.data.id}`);
      } else {
        alert(res.error || '创建失败');
      }
    } catch (err) {
      console.error(err);
      alert('创建失败，请稍后再试');
    } finally {
      setIsSavingProject(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-500" /> 项目协同
            </h2>
            <p className="text-sm text-slate-500">从会议沉淀里查看项目推进情况，先找到重点项目，再进入处理需求、待办中心和风险。</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <CircleDashed className="w-4 h-4 text-slate-400" />
              当前项目：<strong className="text-slate-700">{totalProjects}</strong>
            </div>
            <button
              onClick={() => setShowNewProject(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm shadow-sm transition-colors"
            >
              <ArrowUpRight className="w-4 h-4" /> 新建项目
            </button>
          </div>
        </div>

        {/* ── 数据概览 ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 font-medium">全部项目</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{totalProjects}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 font-medium">进行中</p>
            <p className="text-2xl font-bold text-blue-600 mt-1">{activeProjectCount}</p>
          </div>
          <div className={`rounded-2xl p-4 border shadow-sm ${riskProjectCount > 0 ? 'border-amber-100 bg-amber-50/50' : 'border-slate-100 bg-white'}`}>
            <p className={`text-xs font-medium ${riskProjectCount > 0 ? 'text-amber-500' : 'text-slate-400'}`}>需优先关注</p>
            <p className={`text-2xl font-bold mt-1 ${riskProjectCount > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{riskProjectCount}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 font-medium">待推进事项</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{totalPendingActions}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-slate-400 font-medium">已上线需求</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{liveRequirementCount}</p>
          </div>
        </div>

        {/* ── 搜索与筛选 ── */}
        <div className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-col lg:flex-row gap-3 shadow-sm">
          <div className="flex-1 relative">
            <Input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="搜索项目名、负责人、阶段或描述"
              className="pl-4 h-10 bg-slate-50/50 border-slate-200 focus:bg-white transition-all"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-10 rounded-xl border border-slate-200 px-4 text-sm text-slate-600 bg-slate-50/50 focus:bg-white transition-all outline-none"
          >
            <option value="all">全部状态</option>
            <option value="planning">规划中</option>
            <option value="active">进行中</option>
            <option value="at_risk">有风险</option>
            <option value="completed">已完成</option>
            <option value="archived">已归档</option>
          </select>
        </div>

        {loading && totalProjects === 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="h-44 bg-white border border-slate-100 rounded-3xl animate-pulse shadow-sm" />
              ))}
            </div>
            <div className="h-80 bg-white border border-slate-100 rounded-3xl animate-pulse shadow-sm" />
          </div>
        ) : (
          <>
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">重点项目</h3>
                  <p className="text-sm text-slate-500">优先展示当前需要跟进、存在风险或最近有动作的项目。</p>
                </div>
                <button
                  onClick={() => document.getElementById('project-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700"
                >
                  查看项目列表
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {highlightedProjects.map(card => {
                  const { project, stats } = card;
                  const status = STATUS_META[project.status] || STATUS_META.planning;
                  const pendingActions = getPendingActions(stats);
                  const progressPercent = getProgressPercent(stats);
                  const nextStep = getNextStep(stats);
                  const focusLabel = getFocusLabel(project, stats);

                  return (
                    <div
                      key={project.id}
                      onClick={() => openProject(project.id)}
                      className="group relative overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)] cursor-pointer"
                    >
                      <div className="absolute right-0 top-0 h-24 w-24 translate-x-10 -translate-y-10 rounded-full bg-blue-100/60 blur-2xl" />
                      <div className="relative space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${status.badge}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                                {status.label}
                              </span>
                              {project.phase && (
                                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                                  {project.phase}
                                </span>
                              )}
                            </div>
                            <h4 className="mt-3 truncate text-lg font-black tracking-tight text-slate-900 group-hover:text-blue-600">
                              {project.name}
                            </h4>
                            <p className="mt-1 text-sm text-slate-500">
                              负责人：{project.owner || '待指派'} · 最近更新 {formatZhDate(project.updatedAt)}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 p-2 text-slate-300 transition-all group-hover:bg-blue-600 group-hover:text-white">
                            <ArrowUpRight className="h-4 w-4" />
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[11px] text-slate-400">会议</p>
                            <p className="mt-1 text-lg font-black text-slate-900">{stats.meetingCount}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[11px] text-slate-400">待办</p>
                            <p className="mt-1 text-lg font-black text-slate-900">{pendingActions}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[11px] text-slate-400">需求</p>
                            <p className="mt-1 text-lg font-black text-slate-900">{stats.requirementCount}</p>
                          </div>
                          <div className={`rounded-2xl px-3 py-3 ${stats.riskOpen > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
                            <p className={`text-[11px] ${stats.riskOpen > 0 ? 'text-amber-500' : 'text-slate-400'}`}>风险</p>
                            <p className={`mt-1 text-lg font-black ${stats.riskOpen > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{stats.riskOpen}</p>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{focusLabel}</p>
                              <p className="mt-1 truncate text-sm font-bold text-slate-700">{nextStep}</p>
                            </div>
                            <div className="min-w-[84px] text-right">
                              <p className="text-[11px] text-slate-400">推进度</p>
                              <p className="mt-1 text-lg font-black text-slate-900">{progressPercent}%</p>
                            </div>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                            <div
                              className={`h-full rounded-full ${project.status === 'at_risk' ? 'bg-amber-500' : 'bg-blue-500'}`}
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {QUICK_LINKS.map(link => (
                            <button
                              key={link.key}
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                handleQuickLink(project.id, link.tab);
                              }}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-all hover:border-blue-200 hover:text-blue-600"
                            >
                              <span>{link.label}</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${link.color}`}>{stats[link.key]}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section id="project-list" className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">全部项目</h3>
                  <p className="text-sm text-slate-500">用更紧凑的列表查看全量项目，适合项目数量持续增长后的日常管理。</p>
                </div>
                <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-500">
                  共 {filteredProjects.length} 个
                </div>
              </div>

              <div className="hidden grid-cols-[minmax(0,2.1fr)_120px_92px_92px_92px_120px_88px] gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:grid">
                <span>项目</span>
                <span>状态</span>
                <span>待办</span>
                <span>风险</span>
                <span>会议</span>
                <span>最近更新</span>
                <span>操作</span>
              </div>

              <div className="divide-y divide-slate-100">
                {filteredProjects.map(card => {
                  const { project, stats } = card;
                  const status = STATUS_META[project.status] || STATUS_META.planning;
                  const pendingActions = getPendingActions(stats);
                  const nextStep = getNextStep(stats);

                  return (
                    <div
                      key={project.id}
                      className="group cursor-pointer px-5 py-4 transition-colors hover:bg-slate-50/80"
                      onClick={() => openProject(project.id)}
                    >
                      <div className="hidden items-center gap-3 lg:grid lg:grid-cols-[minmax(0,2.1fr)_120px_92px_92px_92px_120px_88px]">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-bold text-slate-900 group-hover:text-blue-600">{project.name}</p>
                            {project.phase && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                {project.phase}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-400">
                            {project.owner || '待指派'} · {nextStep}
                          </p>
                        </div>
                        <div>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${status.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                            {status.label}
                          </span>
                        </div>
                        <span className="text-sm font-bold text-slate-900">{pendingActions}</span>
                        <span className={`text-sm font-bold ${stats.riskOpen > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{stats.riskOpen}</span>
                        <span className="text-sm font-bold text-slate-900">{stats.meetingCount}</span>
                        <span className="text-xs font-medium text-slate-500">{formatZhDate(project.updatedAt)}</span>
                        <button
                          type="button"
                          onClick={event => {
                            event.stopPropagation();
                            openProject(project.id);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700"
                        >
                          查看
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="space-y-3 lg:hidden">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-slate-900">{project.name}</p>
                            <p className="mt-1 text-xs text-slate-400">{project.owner || '待指派'} · {formatZhDate(project.updatedAt)}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${status.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                            {status.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>待办 {pendingActions}</span>
                          <span>风险 {stats.riskOpen}</span>
                          <span>会议 {stats.meetingCount}</span>
                        </div>
                        <p className="truncate text-xs text-slate-400">{nextStep}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {filteredProjects.length === 0 && !loading && (
          <div className="border-2 border-dashed border-slate-200 rounded-3xl p-16 text-center space-y-4 bg-slate-50/50">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto text-slate-300">
              <BookOpen className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-slate-600">{totalProjects === 0 ? '开启你的第一个项目' : '未找到相关项目'}</p>
              <p className="text-sm text-slate-400 max-w-xs mx-auto">
                {totalProjects === 0 ? '建立项目容器，将零散的会议纪要、需求和待办事项收拢管理。' : '换个关键词试试，或调整筛选条件。'}
              </p>
            </div>
            <button
              onClick={() => setShowNewProject(true)}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md shadow-blue-500/20 transition-all"
            >
              <ArrowUpRight className="w-4 h-4" /> 新建项目
            </button>
          </div>
        )}

        {showNewProject && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !isSavingProject && setShowNewProject(false)}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-8 pt-8 pb-4">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-blue-600 rounded-full" />新建项目
                  </h3>
                  <button onClick={() => !isSavingProject && setShowNewProject(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-50 rounded-xl transition-all">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 ml-1">项目名称 <span className="text-red-500">*</span></label>
                    <Input
                      autoFocus
                      placeholder="例如：智能服务系统 v2.0"
                      value={newProjectName}
                      onChange={e => setNewProjectName(e.target.value)}
                      className="h-11 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 ml-1">负责人</label>
                    <Input
                      placeholder="项目主要责任人"
                      value={newProjectOwner}
                      onChange={e => setNewProjectOwner(e.target.value)}
                      className="h-11 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700 ml-1">目标日期</label>
                    <input
                      type="date"
                      value={newProjectDate}
                      onChange={e => setNewProjectDate(e.target.value)}
                      className="w-full h-11 rounded-xl border border-slate-200 px-4 text-sm bg-slate-50 text-slate-700 focus:bg-white focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                    />
                  </div>
                </div>
              </div>
              <div className="p-8 bg-slate-50/50 flex gap-3">
                <button
                  onClick={() => !isSavingProject && setShowNewProject(false)}
                  className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim() || isSavingProject}
                  className="flex-[2] py-3 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-blue-500/25"
                >
                  {isSavingProject ? '正在创建...' : '立即创建'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
