'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mic, FileText, Settings, Home, LayoutGrid, User, Building2 } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: LayoutProps) {
  const pathname = usePathname();

  const navItems = [
    { icon: Home, label: '工作台', href: '/' },
    { icon: FileText, label: '会议记录', href: '/meetings' },
    { icon: LayoutGrid, label: '行动项看板', href: '/kanban' },
    { icon: Building2, label: '组织架构', href: '/org' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* 左侧导航栏 */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col fixed h-full">
        {/* Logo */}
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Mic className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-slate-800">会议纪要助手</span>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                      isActive
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* 底部信息区 */}
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-slate-400">
            <Settings className="w-3.5 h-3.5" />
            <span>v1.0.0 · 会议纪要助手</span>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 ml-64">
        {/* 顶部全局操作栏 */}
        <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 fixed top-0 right-0 left-64 z-10">
          <h1 className="text-lg font-semibold text-slate-800">
            {pathname === '/' ? '工作台' : pathname === '/meetings' ? '会议记录' : pathname === '/kanban' ? '行动项看板' : pathname === '/org' ? '组织架构' : pathname.startsWith('/meeting/') ? '会议编辑' : '会议纪要助手'}
          </h1>

          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <FileText className="w-5 h-5 text-slate-600" />
            </button>
            <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
              <Settings className="w-5 h-5 text-slate-600" />
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-sm font-medium cursor-pointer hover:ring-2 hover:ring-blue-300 transition-all">
              <User className="w-4 h-4" />
            </div>
          </div>
        </header>

        {/* 内容区域 */}
        <main className="pt-16 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
