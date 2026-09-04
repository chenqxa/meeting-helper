'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, RefreshCw, Lock, Crown, Plus, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';

type Role = 'admin' | 'manager' | 'secretary' | 'employee';

const ROLE_LABEL: Record<Role, string> = {
  admin: '超级管理员',
  manager: '部门管理员',
  secretary: '秘书',
  employee: '普通员工',
};

const ROLE_DESC: Record<Role, string> = {
  admin: '业务全权限：稽核/重派/配置/组织管理',
  manager: '查看台账与看板、创建会议，不能稽核',
  secretary: '看板/持续项查看、创建会议',
  employee: '仅我的待办与汇报自己任务',
};

interface MatrixPermission {
  key: string;
  label: string;
  group: string;
  admin: boolean;
  manager: boolean;
  secretary: boolean;
  employee: boolean;
}

/** 权限矩阵：只读展示，系统管理员（chenqiaoxia）可勾选编辑（与后端鉴权同源） */
export function PermissionMatrix() {
  const [matrix, setMatrix] = useState<MatrixPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSystem, setIsSystem] = useState(false);
  const [saving, setSaving] = useState(false);
  // 系统管理员管理
  const [systemAdmins, setSystemAdmins] = useState<string[]>([]);
  const [empOptions, setEmpOptions] = useState<string[]>([]);
  const [newAdmin, setNewAdmin] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rm = await fetch('/api/permissions/matrix').then(r => r.json());
      if (rm.success) {
        setMatrix(rm.data.permissions || []);
        setIsSystem(!!rm.data.isSystemAdmin);
      }
      // 系统管理员名单（现任系统管理员可见）
      const sa = await fetch('/api/system-admin').then(r => r.json()).catch(() => ({ success: false }));
      if (sa.success) {
        setSystemAdmins(sa.data.systemAdmins || []);
        setIsSystem(!!sa.data.isSystemAdmin);
      }
      // 组织架构员工，用于添加系统管理员
      const emps = await fetch('/api/org/employees').then(r => r.json()).catch(() => ({ success: false }));
      if (emps.success) setEmpOptions(((emps.data || []) as any[]).map(e => e.name).filter(Boolean));
    } catch { toast.error('加载权限矩阵失败'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const manageAdmin = async (action: 'add' | 'remove', loginid: string) => {
    if (!isSystem || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/system-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, loginid }),
      });
      const r = await res.json();
      if (!r.success) toast.error(r.error || '操作失败');
      else {
        toast.success(action === 'add' ? `已任命 ${loginid} 为系统管理员` : `已撤销 ${loginid} 系统管理员`);
        setNewAdmin('');
        await load();
      }
    } catch { toast.error('操作失败'); }
    setSaving(false);
  };

  const toggle = async (key: string, role: Role, current: boolean) => {
    if (!isSystem || saving) return;
    // 前端乐观更新
    setMatrix(prev => prev.map(p => p.key === key ? { ...p, [role]: !current } : p));
    setSaving(true);
    try {
      const res = await fetch('/api/permissions/matrix', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, permissionKey: key, allowed: !current }),
      });
      const r = await res.json();
      if (!r.success) {
        toast.error(r.error || '更新失败');
        await load(); // 回滚
      } else {
        toast.success(`${ROLE_LABEL[role]} · ${matrix.find(p => p.key === key)?.label} → ${!current ? '已授权' : '已撤销'}`);
      }
    } catch { toast.error('更新失败'); await load(); }
    setSaving(false);
  };

  if (loading) return <div className="py-10 text-center text-sm text-slate-400">加载权限矩阵…</div>;

  const groups = [...new Set(matrix.map(m => m.group))];
  const cells = (p: MatrixPermission): Array<[Role, boolean]> =>
    ([['admin', p.admin], ['manager', p.manager], ['secretary', p.secretary], ['employee', p.employee]] as Array<[Role, boolean]>);

  return (
    <>
      {/* 系统管理员管理（仅系统管理员可见） */}
      {isSystem && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden mb-5">
          <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100 bg-amber-50/50">
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-800">系统管理员</h3>
              <span className="text-xs text-amber-600">最高权限：可编辑下方权限矩阵、任命/撤销系统管理员</span>
            </div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {systemAdmins.map(id => (
                <span key={id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 text-sm text-slate-700 border border-amber-200">
                  <Crown className="w-3.5 h-3.5 text-amber-500" />
                  {id}
                  {systemAdmins.length > 1 && (
                    <button onClick={() => manageAdmin('remove', id)} disabled={saving}
                      title="撤销系统管理员" className="text-slate-400 hover:text-red-500 disabled:opacity-40">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  value={newAdmin}
                  onChange={e => setNewAdmin(e.target.value)}
                  placeholder="输入OA登录账号，任命为新系统管理员…"
                  className="w-72 h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
              </div>
              <button
                disabled={!newAdmin.trim() || saving}
                onClick={() => manageAdmin('add', newAdmin.trim())}
                className="h-9 px-4 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-40 flex items-center gap-1.5"
              ><Plus className="w-3.5 h-3.5" />任命</button>
              <span className="text-xs text-slate-400">交接：先任命新人，再撤销自己（至少保留 1 名）</span>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-500" />
          <h3 className="text-sm font-bold text-slate-700">角色权限矩阵</h3>
          {isSystem
            ? <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">系统管理员可编辑</span>
            : <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">只读</span>}
        </div>
        <button onClick={load} title="刷新"
          className="w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50/50">
              <th className="text-left font-semibold px-5 py-2.5">功能</th>
              {(['admin', 'manager', 'secretary', 'employee'] as Role[]).map(r => (
                <th key={r} className="text-center font-semibold px-3 py-2.5">{ROLE_LABEL[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <React.Fragment key={g}>
                <tr>
                  <td colSpan={5} className="px-5 py-1.5 bg-slate-50/70 border-y border-slate-100">
                    <span className="text-[11px] font-semibold text-slate-500 tracking-wide">{g}</span>
                  </td>
                </tr>
                {matrix.filter(m => m.group === g).map(p => (
                  <tr key={p.key} className="border-b border-slate-50">
                    <td className="px-5 py-2 text-sm text-slate-700">{p.label}</td>
                    {cells(p).map(([role, ok], i) => (
                      <td key={i} className="text-center py-2">
                        {isSystem && !(role === 'admin' && p.key === 'canManageRoles') ? (
                          <button
                            disabled={saving}
                            onClick={() => toggle(p.key, role, ok)}
                            title={ok ? `撤销「${ROLE_LABEL[role]}」此权限` : `授予「${ROLE_LABEL[role]}」此权限`}
                            className={`inline-flex w-5 h-5 rounded-full text-xs items-center justify-center border transition-colors ${
                              ok
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-slate-50 text-slate-300 border-slate-100 hover:bg-slate-100'
                            }`}
                          >
                            {ok ? '✓' : ''}
                          </button>
                        ) : (
                          <span className={`inline-flex w-5 h-5 rounded-full text-xs items-center justify-center border ${
                            ok ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-300 border-slate-100'
                          }`}>
                            {ok ? '✓' : (role === 'admin' && p.key === 'canManageRoles' ? <Lock className="w-2.5 h-2.5" /> : '')}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 space-y-1">
        {(Object.keys(ROLE_DESC) as Role[]).map(r => (
          <p key={r} className="text-xs text-slate-400"><b className="text-slate-500">{ROLE_LABEL[r]}：</b>{ROLE_DESC[r]}</p>
        ))}
        {isSystem && <p className="text-xs text-amber-600 pt-1">点击权限格可授予/撤销；超级管理员的「角色名单管理」已锁定不可关闭，防止锁死自己。</p>}
      </div>
      </div>
    </>
  );
}
