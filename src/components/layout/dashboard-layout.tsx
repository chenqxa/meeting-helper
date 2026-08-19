'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Mic, FileText, Settings, Home, LayoutGrid, Building2,
  LogOut, ClipboardList, Menu, Plus, MessageSquareWarning, RefreshCw, FolderOpen,
  Presentation, ScrollText, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { AiAssistant } from '@/components/ui/ai-assistant';
import FeedbackSubmitDialog from '@/components/feedback-submit-dialog';
import PageLoader from './page-loader';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface LayoutProps {
  children: React.ReactNode;
}

const PAGE_TITLES: Record<string, string> = {
  '/': '工作台',
  '/meetings': '会议中心',
  '/kanban': '待办中心',
  '/tracking': '行动项台账',
  '/feedback': '反馈台账',
  '/projects': '项目协同',
  '/push-preview': '推送预览',
  '/weekly-board': '周例会看板',
  '/monthly-board': '月度看板',
  '/production-board': '产销会看板',
  '/org': '组织',
  '/settings': '基础设置',
  '/oa-sync': 'OA 同步',
};

export default function DashboardLayout({ children }: LayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<{ name: string; loginid: string; dept?: string; role?: string } | null>(null);
  const [navReady, setNavReady] = useState(false);
  const [myTaskCount, setMyTaskCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [sysNavOpen, setSysNavOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [logForm, setLogForm] = useState({
    projectId: '',
    type: 'note' as 'note' | 'action' | 'risk',
    content: '',
    title: '',
  });
  const [isSubmittingLog, setIsSubmittingLog] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // 获取项目列表供快捷录入使用
  useEffect(() => {
    if (quickLogOpen) {
      if (projects.length === 0) {
        fetch('/api/projects')
          .then(r => r.json())
          .then(d => { 
            if (d.success) {
              setProjects(Array.isArray(d.data) ? d.data : []); 
            }
          });
      }
      
      // 如果在项目详情页，自动预选当前项目
      if (pathname.startsWith('/project/')) {
        const id = pathname.split('/').pop();
        if (id && id !== 'project') {
          setLogForm(prev => ({ ...prev, projectId: id }));
        }
      }
    }
  }, [quickLogOpen, projects.length, pathname]);

  const submitQuickLog = async () => {
    if (!logForm.projectId || !logForm.content) return;
    setIsSubmittingLog(true);
    try {
      let url = '';
      let body = {};
      
      if (logForm.type === 'note') {
        url = '/api/artifacts';
        body = {
          projectId: logForm.projectId,
          title: logForm.title || `快捷备注 ${new Date().toLocaleDateString()}`,
          content: logForm.content,
          artifactType: 'other',
          createdBy: currentUser?.name || '用户',
        };
      } else if (logForm.type === 'action') {
        url = `/api/projects/${logForm.projectId}/actions`;
        body = {
          description: logForm.content,
          priority: 'medium',
          status: 'pending',
        };
      } else if (logForm.type === 'risk') {
        url = `/api/projects/${logForm.projectId}/risks`;
        body = {
          title: logForm.title || '快捷记录风险',
          description: logForm.content,
          level: 'medium',
          status: 'open',
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setQuickLogOpen(false);
        setLogForm({ projectId: '', type: 'note', content: '', title: '' });
        // 发送自定义刷新事件，替代全页刷新
        window.dispatchEvent(new CustomEvent('refresh-data'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingLog(false);
    }
  };

  // 从 localStorage 恢复折叠状态
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebar_collapsed');
      if (saved !== null) setCollapsed(JSON.parse(saved));
      const savedSys = localStorage.getItem('sidebar_sys_open');
      if (savedSys !== null) setSysNavOpen(JSON.parse(savedSys));
    } catch {}
  }, []);

  // 当前页在「系统管理」子菜单内时自动展开
  useEffect(() => {
    const sysHrefs = ['/org', '/settings', '/oa-sync', '/logs'];
    if (sysHrefs.some(h => pathname === h || pathname.startsWith(h + '/'))) setSysNavOpen(true);
  }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar_collapsed', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const cached = sessionStorage.getItem('auth_me');
    if (cached) {
      try {
        const u = JSON.parse(cached);
        setCurrentUser(u);
        setNavReady(true);
      } catch {}
    }
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setCurrentUser(d.data as { name: string; loginid: string; dept?: string; role?: string });
          sessionStorage.setItem('auth_me', JSON.stringify(d.data));
        }
      })
      .catch(() => {})
      .finally(() => setNavReady(true));
    fetch('/api/actions/mine')
      .then(r => r.json())
      .then(async d => {
        if (d.success) {
          // 与待办中心口径一致：已处理(done)、已勾稽(verified)、已取消、已打稽核标记(V/X/0)的不算待办
          let pendingItems = (d.data || []).filter((t: any) =>
            t.status !== 'done' && t.status !== 'verified' && t.status !== 'cancelled' && t.oa_score == null
          );
          // 持续项本周期已填报 → 本周期视作已完成，不计入待办角标
          const contItems = pendingItems.filter((t: any) => (t.due_date_type || '') === 'continuous');
          if (contItems.length > 0) {
            try {
              const pr = await fetch('/api/continuous/progress').then(r => r.json());
              if (pr.success) {
                const latestMap: Record<string, string> = {};
                for (const [actionId, recs] of Object.entries(pr.data || {})) {
                  const latest = [...(recs as any[])].sort((a, b) => String(b.cycleDate).localeCompare(String(a.cycleDate)))[0];
                  if (latest?.cycleDate) latestMap[actionId] = latest.cycleDate;
                }
                const cycleStartOf = (meetingType: string) => {
                  const t = new Date(); t.setHours(0, 0, 0, 0);
                  if (meetingType === '公司月会') return new Date(t.getFullYear(), t.getMonth(), 1);
                  const diff = (t.getDay() + 7 - 5) % 7; // 距最近周五（推送日）
                  const d = new Date(t); d.setDate(t.getDate() - diff);
                  return d;
                };
                pendingItems = pendingItems.filter((t: any) => {
                  if ((t.due_date_type || '') !== 'continuous') return true;
                  const lastCycle = latestMap[t.id];
                  if (!lastCycle) return true;
                  return new Date(lastCycle + 'T00:00:00') < cycleStartOf(t.meeting_type || '');
                });
              }
            } catch { /* 进度不可用时按原口径 */ }
          }
          setMyTaskCount(pendingItems.length);
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    sessionStorage.removeItem('auth_me');
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login?error=skip');
  };

  const role = currentUser?.role || 'employee';
  const allNavGroups = [
    {
      label: '个人工作',
      items: [
        { icon: Home, label: '工作台', href: '/', roles: ['admin', 'manager', 'secretary', 'employee'] },
        { icon: LayoutGrid, label: '待办中心', href: '/kanban', badge: myTaskCount, roles: ['admin', 'manager', 'secretary', 'employee'] },
      ]
    },
    {
      label: '业务协同',
      items: [
        { icon: FileText, label: '会议中心', href: '/meetings', roles: ['admin', 'manager', 'secretary', 'employee'] },
        // 项目协同暂时隐藏，所有人不可见；需要时取消下一行注释即可
        // { icon: Building2, label: '项目协同', href: '/projects', roles: ['admin', 'manager', 'secretary'] },
        { icon: Presentation, label: '周例会看板', href: '/weekly-board', roles: ['admin', 'manager', 'secretary'] },
        { icon: Presentation, label: '月度看板', href: '/monthly-board', roles: ['admin', 'manager', 'secretary'] },
        { icon: Presentation, label: '产销会看板', href: '/production-board', roles: ['admin', 'manager', 'secretary'] },
      ]
    },
    {
      label: '管理配置',
      items: [
        { icon: ClipboardList, label: '行动项台账', href: '/tracking', roles: ['admin', 'manager'] },
        { icon: RefreshCw, label: '持续项跟进', href: '/continuous', roles: ['admin', 'manager', 'secretary'] },
        { icon: MessageSquareWarning, label: '反馈台账', href: '/feedback', roles: ['admin', 'manager', 'employee'] },
        { icon: FolderOpen, label: '批次管理', href: '/batches', roles: ['admin', 'manager', 'secretary', 'employee'] },
      ]
    },
    {
      label: '系统管理',
      collapsible: true,
      items: [
        { icon: Building2, label: '组织', href: '/org', roles: ['admin'] },
        { icon: Settings, label: '基础设置', href: '/settings', roles: ['admin'] },
        { icon: Building2, label: 'OA 同步', href: '/oa-sync', roles: ['admin'] },
        { icon: ScrollText, label: '操作日志', href: '/logs', roles: ['admin'], loginids: ['chenqiaoxia'] },
      ]
    }
  ];

  const navGroups = allNavGroups.map(group => ({
    ...group,
    items: group.items.filter(item =>
      item.roles.includes(role) &&
      (!(item as any).loginids || (item as any).loginids.includes(currentUser?.loginid))
    )
  })).filter(group => group.items.length > 0);

  const pageTitle = PAGE_TITLES[pathname]
    ?? (pathname.startsWith('/meeting/') ? '会议详情'
    : pathname.startsWith('/project/') ? '项目详情'
    : '会议纪要助手');

  const sidebarW = collapsed ? 'lg:w-[60px]' : 'lg:w-[220px]';
  const mainML = collapsed ? 'lg:ml-[60px]' : 'lg:ml-[220px]';
  const headerLeft = collapsed ? 'lg:left-[60px]' : 'lg:left-[220px]';

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex">
      <PageLoader />
      {/* ── 遮罩（移动端）── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── 左侧导航栏 ── */}
      <aside
        className={`
          ${sidebarW} bg-[#1b2537]
          flex flex-col fixed h-full z-40
          transition-all duration-200 ease-in-out
          overflow-hidden
          w-[240px]
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        {/* Logo 区域 */}
        <div className={`relative flex items-center h-14 flex-shrink-0 border-b border-white/5 ${collapsed ? 'justify-center px-0' : 'px-4 gap-3'}`}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/30">
            <Mic className="w-4 h-4 text-white" />
          </div>
          <span className={`text-sm font-bold text-white whitespace-nowrap tracking-tight transition-opacity duration-200 ${collapsed ? 'absolute left-12 opacity-0 pointer-events-none' : 'opacity-100'}`}>
            会议纪要助手
          </span>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 py-4 overflow-y-auto overflow-x-hidden custom-scrollbar">
          {!navReady && !collapsed && (
            <div className="space-y-2 px-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-9 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          )}
          
          <div className="space-y-4">
            {navGroups.map((group, gIdx) => {
              const groupCollapsed = (group as any).collapsible && !sysNavOpen && !collapsed;
              return (
              <div key={gIdx} className="space-y-1">
                {!collapsed ? (
                  <div className="px-6 mb-1.5">
                    {(group as any).collapsible ? (
                      <button onClick={() => setSysNavOpen(v => { try { localStorage.setItem('sidebar_sys_open', JSON.stringify(!v)); } catch {} return !v; })}
                        className="flex w-full items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-slate-300 transition-colors">
                        <span>{group.label}</span>
                        <span className={`inline-block transition-transform text-[9px] ${sysNavOpen ? 'rotate-90' : ''}`}>▶</span>
                      </button>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{group.label}</span>
                    )}
                  </div>
                ) : null}
                {(!groupCollapsed || collapsed) && (
                <ul className={`space-y-0.5 ${collapsed ? 'px-2' : 'px-3'}`}>
                  {group.items.map(item => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={collapsed ? item.label : undefined}
                          className={`
                            flex items-center gap-3 h-10 w-full rounded-xl relative group
                            ${collapsed ? 'justify-center px-0' : 'px-3'}
                            ${isActive
                              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 font-medium'
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                            }
                          `}
                        >
                          <div className="relative flex-shrink-0">
                            <Icon className={`w-[18px] h-[18px] ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
                            {'badge' in item && (item.badge ?? 0) > 0 && collapsed && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center border-2 border-[#1b2537]">
                {(item.badge ?? 0) > 99 ? '99+' : item.badge}
              </span>
                            )}
                          </div>
                          <span className={`text-[13px] whitespace-nowrap min-w-0 transition-opacity duration-200 ${collapsed ? 'absolute left-[42px] opacity-0 pointer-events-none' : 'flex-1 opacity-100'}`}>
                            {item.label}
                            {'badge' in item && (item.badge ?? 0) > 0 && (
                <span className={`ml-1.5 inline-flex translate-y-[-1px] min-w-[18px] h-4.5 px-1.5 rounded-full text-[10px] font-bold items-center justify-center ${isActive ? 'bg-white text-blue-600' : 'bg-red-500 text-white'}`}>
                  {(item.badge ?? 0) > 99 ? '99+' : item.badge}
                </span>
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                )}
              </div>
              );
            })}
          </div>
        </nav>
      </aside>

      {/* ── 主内容区 ── */}
      <div className={`flex-1 ${mainML} transition-[margin] duration-200 ease-in-out flex flex-col min-h-screen`}>

        {/* 顶部栏 */}
        <header className={`
          bg-white/80 backdrop-blur-md border-b border-slate-200
          h-14 flex items-center justify-between px-4 lg:px-8
          fixed top-0 right-0 ${headerLeft} z-20
          transition-[left] duration-200 ease-in-out
        `}>
          <div className="flex items-center gap-4">
            {/* 移动端汉堡菜单 */}
            <button
              className="lg:hidden p-2 rounded-xl hover:bg-slate-100 text-slate-500 transition-colors"
              onClick={() => setMobileOpen(v => !v)}
            >
              <Menu className="w-5 h-5" />
            </button>
            {/* 侧边栏折叠开关（桌面端） */}
            <button
              onClick={toggleCollapsed}
              title={collapsed ? '展开侧边栏' : '收起侧边栏'}
              className="hidden lg:flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            >
              {collapsed ? <PanelLeftOpen className="w-4.5 h-4.5" /> : <PanelLeftClose className="w-4.5 h-4.5" />}
            </button>
            <div className="flex items-center gap-3">
              <div className="w-1 h-4 bg-blue-500 rounded-full hidden sm:block" />
              <h1 className="text-sm font-bold text-slate-900 tracking-tight whitespace-nowrap">{pageTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setQuickLogOpen(true)}
              className="hidden md:flex items-center gap-2 px-4 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-all shadow-sm active:scale-95"
            >
              <ClipboardList className="w-3.5 h-3.5 text-blue-500" />
              快捷录入
            </button>
            <Link
              href="/?newMeeting=true"
              className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-md shadow-blue-500/20 active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">新建会议</span>
            </Link>
            <button
              onClick={() => setFeedbackOpen(true)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-all shadow-sm active:scale-95"
            >
              <MessageSquareWarning className="w-3.5 h-3.5 text-emerald-500" />
              <span className="hidden sm:inline">反馈</span>
            </button>
            
            <div className="h-4 w-px bg-slate-200 hidden sm:block" />

            {currentUser ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 text-white text-xs font-bold shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
                    title={`${currentUser.name || currentUser.loginid} · 账号菜单`}
                    aria-label="账号菜单"
                  >
                    {(currentUser.name || currentUser.loginid).charAt(0).toUpperCase()}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60 p-0">
                  {/* 账号信息头 */}
                  <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 text-sm font-bold text-white">
                      {(currentUser.name || currentUser.loginid).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{currentUser.name || currentUser.loginid}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {currentUser.loginid}{currentUser.dept ? ` · ${currentUser.dept}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="p-1.5">
                    <DropdownMenuItem
                      onClick={() => setFeedbackOpen(true)}
                      className="cursor-pointer rounded-lg"
                    >
                      <MessageSquareWarning className="!text-emerald-500" /> 意见反馈
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={handleLogout}
                      className="cursor-pointer rounded-lg"
                    >
                      <LogOut /> 退出登录
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="h-9 w-9 rounded-full bg-slate-100 animate-pulse" />
            )}
          </div>
        </header>

        {/* 页面内容 */}
        <main className="pt-14 flex-1">
          <div className="p-4 lg:p-6 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* AI 助手悬浮按钮 */}
      <AiAssistant />

      {/* ── 快捷录入 Modal ── */}
      {quickLogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => !isSubmittingLog && setQuickLogOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="px-8 pt-8 pb-4">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-blue-600 rounded-full" />
                  快速记录项目事项
                </h3>
                <button onClick={() => !isSubmittingLog && setQuickLogOpen(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-50 rounded-xl transition-all">
                  <Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>

              <div className="space-y-6">
                {/* 项目选择 */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">关联项目 <span className="text-red-500">*</span></label>
                  <select
                    className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all outline-none text-sm"
                    value={logForm.projectId}
                    onChange={e => setLogForm(prev => ({ ...prev, projectId: e.target.value }))}
                  >
                    <option value="">请选择所属项目</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {/* 类型切换 */}
                <div className="flex p-1 bg-slate-100 rounded-xl">
                  {(['note', 'action', 'risk'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setLogForm(prev => ({ ...prev, type: t }))}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                        logForm.type === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {t === 'note' ? '记备注' : t === 'action' ? '提事项' : '记风险'}
                    </button>
                  ))}
                </div>

                {/* 标题（仅备注和风险显示） */}
                {(logForm.type === 'note' || logForm.type === 'risk') && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <label className="text-sm font-bold text-slate-700 ml-1">标题</label>
                    <input
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 transition-all outline-none text-sm"
                      placeholder={logForm.type === 'note' ? '备注标题' : '风险简述'}
                      value={logForm.title}
                      onChange={e => setLogForm(prev => ({ ...prev, title: e.target.value }))}
                    />
                  </div>
                )}

                {/* 内容 */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">内容详情 <span className="text-red-500">*</span></label>
                  <textarea
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 transition-all outline-none text-sm min-h-[120px]"
                    placeholder={
                      logForm.type === 'note' ? '粘贴文档内容、会议结论或关键信息...' :
                      logForm.type === 'action' ? '描述需要推进的具体事项内容...' :
                      '描述潜在风险点及可能的影响...'
                    }
                    value={logForm.content}
                    onChange={e => setLogForm(prev => ({ ...prev, content: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            <div className="p-8 bg-slate-50/50 flex gap-3">
              <button
                onClick={() => !isSubmittingLog && setQuickLogOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitQuickLog}
                disabled={!logForm.projectId || !logForm.content || isSubmittingLog}
                className="flex-[2] py-3 bg-blue-600 text-white text-sm font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-50"
              >
                {isSubmittingLog ? '提交中...' : '立即保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <FeedbackSubmitDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  );
}
