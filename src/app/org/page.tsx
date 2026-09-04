'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  Building2, Users, User, Plus, Edit, Trash2, Search, ChevronRight, ChevronDown,
  Briefcase, Mail, Phone, MapPin, RefreshCw, ShieldCheck, Crown, ClipboardList,
  Home, Folder, FolderOpen
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PermissionMatrix } from '@/app/settings/permissions-tab';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface OrgNode {
  type: 'department' | 'employee';
  id: string;
  name: string;
  departmentId?: string;
  parentId?: string | null;
  children?: OrgNode[];
  code?: string;
  managerId?: string;
  sort?: number;
  position?: string;
  email?: string;
  phone?: string;
  status?: string;
}

type NodeType = 'department' | 'employee';

const ROLE_OPTIONS = [
  { value: 'admin', label: '超级管理员', color: 'text-red-600 bg-red-50 border-red-200', icon: Crown },
  { value: 'manager', label: '部门领导', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: ShieldCheck },
  { value: 'secretary', label: '会议管理员', color: 'text-purple-600 bg-purple-50 border-purple-200', icon: ClipboardList },
  { value: 'employee', label: '普通员工（默认）', color: 'text-slate-500 bg-slate-50 border-slate-200', icon: User },
];

export default function OrgPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'org' | 'roles' | 'permissions'>('org');
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

  // 角色管理
  const [rolesConfig, setRolesConfig] = useState<{ admins: string[]; roles: Record<string, string> }>({ admins: [], roles: {} });
  const [allEmployees, setAllEmployees] = useState<{
    id: string; name: string; loginid?: string;
    department: string; deptId?: string;
    position?: string; code?: string; email?: string; phone?: string; status?: string;
  }[]>([]);
  const [roleSearch, setRoleSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [roleMsg, setRoleMsg] = useState('');
  // 批量选择
  const [selectedLoginids, setSelectedLoginids] = useState<Set<string>>(new Set());
  const [batchRole, setBatchRole] = useState('manager');
  const [batchSaving, setBatchSaving] = useState(false);
  // 组织架构双栏
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [orgSearch, setOrgSearch] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [collapsedDeptIds, setCollapsedDeptIds] = useState<Set<string>>(new Set());
  // 左侧面板宽度（可拖拽）
  const [leftPanelWidth, setLeftPanelWidth] = useState(208);
  const resizingRef = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  // 角色管理 - 部门筛选
  const [roleDeptFilter, setRoleDeptFilter] = useState<string | null>(null);

  // 拖拽调整左侧面板宽度
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    resizingRef.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = leftPanelWidth;
    e.preventDefault();
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = e.clientX - resizeStartX.current;
      setLeftPanelWidth(Math.max(160, Math.min(400, resizeStartWidth.current + delta)));
    };
    const onUp = () => { resizingRef.current = false; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  const toggleDeptCollapse = (id: string) => {
    setCollapsedDeptIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const loadRoles = useCallback(async () => {
    try {
      const [rolesRes, empRes, deptRes] = await Promise.all([
        fetch('/api/roles').then(r => r.json()),
        fetch('/api/org/employees').then(r => r.json()),
        fetch('/api/org/departments').then(r => r.json()),
      ]);
      // 任意接口返回 401 → 跳转登录
      if ([rolesRes, empRes, deptRes].some(r => r.code === 'UNAUTHORIZED')) {
        router.push('/login?redirect=/org'); return;
      }
      if (rolesRes.success) setRolesConfig(rolesRes.data);
      if (empRes.success && deptRes.success) {
        const deptMap = new Map((deptRes.data || []).map((d: any) => [d.id, d.name]));
        setAllEmployees((empRes.data || []).map((e: any) => ({
          id: e.id,
          name: e.name,
          loginid: e.loginid || '',
          department: deptMap.get(e.departmentId) || e.department || '',
          deptId: e.departmentId,
          position: e.position || '',
          code: e.code || '',
          email: e.email || '',
          phone: e.phone || '',
          status: e.status || 'active',
        })));
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadRoles(); }, [activeTab, loadRoles]);

  const getRole = (loginid: string) => {
    if (rolesConfig.admins.includes(loginid)) return 'admin';
    return rolesConfig.roles[loginid] || 'employee';
  };

  const setRole = async (loginid: string, role: string) => {
    setSavingId(loginid);
    try {
      await fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set', loginid, role }) });
      await loadRoles();
      setRoleMsg(`✓ 已更新`);
      setTimeout(() => setRoleMsg(''), 2000);
    } finally { setSavingId(null); }
  };

  // 批量操作
  const toggleSelect = (loginid: string) => {
    setSelectedLoginids(prev => { const n = new Set(prev); n.has(loginid) ? n.delete(loginid) : n.add(loginid); return n; });
  };
  const toggleSelectAll = () => {
    const all = filteredEmployees.map(e => e.loginid || e.id);
    setSelectedLoginids(selectedLoginids.size === all.length ? new Set() : new Set(all));
  };
  const batchSetRole = async () => {
    if (!selectedLoginids.size) return;
    setBatchSaving(true);
    const count = selectedLoginids.size;
    try {
      await Promise.all([...selectedLoginids].map(id =>
        fetch('/api/roles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set', loginid: id, role: batchRole }) })
      ));
      await loadRoles();
      setSelectedLoginids(new Set());
      setRoleMsg(`✓ 已批量设置 ${count} 人`);
      setTimeout(() => setRoleMsg(''), 3000);
    } finally { setBatchSaving(false); }
  };

  // 平铺部门列表（带层级）
  const flatDepts = React.useMemo(() => {
    const result: Array<OrgNode & { level: number }> = [];
    const walk = (nodes: OrgNode[], lvl: number) => {
      nodes.forEach(n => {
        if (n.type === 'department') {
          result.push({ ...n, level: lvl });
          if (n.children) walk(n.children, lvl + 1);
        }
      });
    };
    walk(tree, 0);
    return result;
  }, [tree]);

  // 组织架构右侧过滤员工（只显示在职）
  const orgFilteredEmployees = React.useMemo(() => {
    return allEmployees.filter(e => {
      if (e.status === 'resigned') return false;  // 隐藏已离职
      if (selectedDeptId && e.deptId !== selectedDeptId) return false;
      if (orgSearch) {
        const q = orgSearch.toLowerCase();
        if (!e.name.toLowerCase().includes(q) &&
            !(e.position || '').toLowerCase().includes(q) &&
            !(e.loginid || '').toLowerCase().includes(q) &&
            !(e.code || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allEmployees, selectedDeptId, orgSearch]);

  // 角色统计
  const roleCounts = React.useMemo(() => {
    const counts: Record<string, number> = { admin: 0, manager: 0, secretary: 0, employee: 0 };
    allEmployees.forEach(e => { const r = getRole(e.loginid || e.id); counts[r] = (counts[r] || 0) + 1; });
    return counts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEmployees, rolesConfig]);

  // 过滤后的员工列表
  const filteredEmployees = React.useMemo(() => {
    return allEmployees.filter(e => {
      const key = e.loginid || e.id;
      const r = getRole(key);
      if (roleFilter !== 'all' && r !== roleFilter) return false;
      if (roleDeptFilter && e.deptId !== roleDeptFilter) return false;
      if (roleSearch) {
        const q = roleSearch.toLowerCase();
        if (!e.name.toLowerCase().includes(q) && !e.department.toLowerCase().includes(q) && !key.toLowerCase().includes(q) && !(e.code || '').toLowerCase().includes(q) && !(e.position || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEmployees, rolesConfig, roleFilter, roleSearch, roleDeptFilter]);

  // 对话框状态
  const [dialogType, setDialogType] = useState<'create-dept' | 'create-emp' | 'edit-dept' | 'edit-emp' | null>(null);
  const [selectedNode, setSelectedNode] = useState<OrgNode | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  // 搜索过滤树
  const { filteredTree, expandIdsForSearch } = React.useMemo(() => {
    try {
      if (!searchKeyword.trim()) return { filteredTree: tree, expandIdsForSearch: new Set<string>() };

      const keyword = String(searchKeyword).toLowerCase();
      const idsToExpand = new Set<string>();

      // 检查节点是否匹配
      const nodeMatches = (node: OrgNode): boolean => {
        try {
          const name = String(node.name || '');
          if (node.type === 'employee') {
            const code = String(node.code || '');
            const position = String(node.position || '');
            const email = String(node.email || '');
            return !!(
              name.toLowerCase().includes(keyword) ||
              code.toLowerCase().includes(keyword) ||
              position.toLowerCase().includes(keyword) ||
              email.toLowerCase().includes(keyword)
            );
          }
          return !!name.toLowerCase().includes(keyword);
        } catch {
          return false;
        }
      };

      // 递归过滤树，保留匹配节点及其祖先
      const filterTree = (nodes: OrgNode[], parentIds: string[] = []): OrgNode[] => {
        return nodes.filter(node => {
          try {
            const currentPath = [...parentIds, node.id];
            if (nodeMatches(node)) {
              // 节点本身匹配，添加所有祖先到展开列表
              parentIds.forEach(id => idsToExpand.add(id));
              return true;
            }
            if (node.children) {
              const filteredChildren = filterTree(node.children, currentPath);
              if (filteredChildren.length > 0) {
                // 有子节点匹配，添加当前节点到展开列表
                idsToExpand.add(node.id);
                return true;
              }
            }
            return false;
          } catch {
            return false;
          }
        });
      };

      const result = filterTree(tree);
      return { filteredTree: result, expandIdsForSearch: idsToExpand };
    } catch (error) {
      console.error('Search filter error:', error);
      return { filteredTree: tree, expandIdsForSearch: new Set<string>() };
    }
  }, [tree, searchKeyword]);
  
  // 搜索时自动展开匹配结果的父部门
  React.useEffect(() => {
    if (searchKeyword.trim()) {
      setExpandedIds(prev => {
        const merged = new Set(prev);
        expandIdsForSearch.forEach(id => merged.add(id));
        return merged;
      });
    }
  }, [searchKeyword, expandIdsForSearch]);

  const loadOrgTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/org');
      const r = await res.json();
      if (r.success) setTree(r.data || []);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadOrgTree(); }, [loadOrgTree]);

  // 展开/收起
  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  // 展开所有
  const expandAll = () => {
    const ids = new Set<string>();
    function collect(nodes: OrgNode[]) {
      nodes.forEach(node => {
        if (node.type === 'department' && node.children && node.children.length > 0) {
          ids.add(node.id);
          collect(node.children);
        }
      });
    }
    collect(tree);
    setExpandedIds(ids);
  };

  // 收起所有
  const collapseAll = () => setExpandedIds(new Set());

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/org/sync-db', { method: 'POST' });
      if (res.status === 401) {
        router.push('/login?redirect=/org');
        return;
      }
      const r = await res.json();
      if (!r.success && (r.code === 'UNAUTHORIZED' || r.error?.includes('未登录'))) {
        router.push('/login?redirect=/org');
        return;
      }
      if (r.success) {
        const d = r.data;
        const now = new Date();
        setLastSyncedAt(now);
        const details = [
          `部门：+${d.departments.created} ~${d.departments.updated} -${d.departments.deleted}`,
          `员工：+${d.employees.created} ~${d.employees.updated}`,
          d.employees.deptChanged > 0 ? `换部门 ${d.employees.deptChanged} 人` : '',
          d.employees.resigned > 0 ? `标记离职 ${d.employees.resigned} 人` : '',
          d.employees.skipped > 0 ? `跳过 ${d.employees.skipped} 人` : '',
        ].filter(Boolean).join(' · ');
        toast.success('同步完成', { description: details, duration: 6000 });
        loadOrgTree();
        loadRoles();
      } else {
        toast.error('同步失败', { description: r.error || '未知错误' });
      }
    } catch (err) {
      toast.error('同步失败', { description: '网络错误，请检查连接' });
    } finally {
      setSyncing(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('确定要清空所有组织架构数据吗？此操作不可恢复！')) return;
    try {
      const res = await fetch('/api/org/clear', { method: 'POST' });
      const r = await res.json();
      if (r.success) {
        alert('清空成功');
        loadOrgTree();
      } else {
        alert('清空失败：' + (r.error || '未知错误'));
      }
    } catch (err) {
      alert('清空失败：网络错误');
    }
  };

  // 打开创建对话框
  const openCreateDept = (parentId: string | null = null) => {
    setSelectedNode(null);
    setForm({ parentId, name: '', code: '', description: '', sort: 0, status: 'active' });
    setDialogType('create-dept');
  };

  const openCreateEmp = (departmentId: string) => {
    setSelectedNode(null);
    setForm({ name: '', code: '', position: '', departmentId, email: '', phone: '', status: 'active', joinedAt: new Date().toISOString().split('T')[0] });
    setDialogType('create-emp');
  };

  // 打开编辑对话框
  const openEdit = (node: OrgNode) => {
    setSelectedNode(node);
    if (node.type === 'department') {
      setForm({ name: node.name, code: node.code, description: '', sort: node.sort || 0, status: 'active' });
      setDialogType('edit-dept');
    } else {
      setForm({ name: node.name, code: node.code || '', position: node.position, email: node.email, phone: node.phone, status: node.status });
      setDialogType('edit-emp');
    }
  };

  // 提交表单
  const submitForm = async () => {
    try {
      let url = '', method = 'POST';
      if (dialogType === 'create-dept') {
        url = '/api/org/departments';
      } else if (dialogType === 'create-emp') {
        url = '/api/org/employees';
      } else if (dialogType === 'edit-dept') {
        url = `/api/org/departments/${selectedNode?.id}`;
        method = 'PUT';
      } else if (dialogType === 'edit-emp') {
        url = `/api/org/employees/${selectedNode?.id}`;
        method = 'PUT';
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const r = await res.json();
      if (r.success) {
        setDialogType(null);
        loadOrgTree();
      }
    } catch { /* silent */ }
  };

  // 删除
  const handleDelete = async (node: OrgNode) => {
    toast(`确定删除「${node.name}」？`, {
      description: node.type === 'department' ? '该部门下的子部门和员工也会一并删除' : undefined,
      action: {
        label: '确认删除',
        onClick: async () => {
          try {
            const url = node.type === 'department' ? `/api/org/departments/${node.id}` : `/api/org/employees/${node.id}`;
            const res = await fetch(url, { method: 'DELETE' });
            const r = await res.json();
            if (r.success) { loadOrgTree(); toast.success('删除成功'); }
            else toast.error(r.error || '删除失败');
          } catch { toast.error('删除失败'); }
        },
      },
      cancel: { label: '取消', onClick: () => {} },
      duration: 8000,
    });
  };

  // 渲染树节点
  const renderNode = (node: OrgNode, level: number = 0) => {
    const isDept = node.type === 'department';
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedIds.has(node.id);

    return (
      <div key={node.id} className="select-none">
        <div
          className={`flex items-center gap-2 py-2 px-3 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors ${level > 0 ? 'ml-4' : ''}`}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
        >
          {/* 展开/收起图标 */}
          {isDept && hasChildren && (
            <button onClick={() => toggleExpand(node.id)} className="p-0.5 hover:bg-slate-200 rounded">
              {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </button>
          )}
          {isDept && !hasChildren && <span className="w-5" />}

          {/* 图标 */}
          {isDept ? (
            <Building2 className="w-4 h-4 text-blue-500" />
          ) : (
            <User className="w-4 h-4 text-slate-500" />
          )}

          {/* 名称 */}
          <span className={`text-sm font-medium ${isDept ? 'text-slate-700' : 'text-slate-600'}`}>
            {node.name}
          </span>

          {/* 部门编码 */}
          {isDept && node.code && (
            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{node.code}</span>
          )}

          {/* 职位 */}
          {!isDept && node.position && (
            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <Briefcase className="w-2.5 h-2.5" />{node.position}
            </span>
          )}

          {/* 邮箱 */}
          {!isDept && node.email && (
            <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
              <Mail className="w-2.5 h-2.5" />{node.email}
            </span>
          )}

          {/* 操作按钮 */}
          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {isDept && (
              <button
                onClick={() => openCreateEmp(node.id)}
                className="p-1.5 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors"
                title="添加员工"
              >
                <Users className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => openCreateDept(node.id)}
              className="p-1.5 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors"
              title="添加子部门"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => openEdit(node)}
              className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
              title="编辑"
            >
              <Edit className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleDelete(node)}
              className="p-1.5 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 子节点 */}
        {isDept && isExpanded && hasChildren && (
          <div className="group">
            {node.children!.map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout>
      {/* Tab 切换 */}
      <div className="flex items-center gap-1 mb-5 bg-slate-100 p-1 rounded-xl w-fit">
        <button onClick={() => setActiveTab('org')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'org' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <Building2 className="w-4 h-4" /> 组织架构
        </button>
        <button onClick={() => setActiveTab('roles')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'roles' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <ShieldCheck className="w-4 h-4" /> 角色管理
        </button>
        <button onClick={() => setActiveTab('permissions')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'permissions' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}>
          <ShieldCheck className="w-4 h-4" /> 权限管理
        </button>
      </div>

      {/* ── 角色管理面板 ── */}
      {activeTab === 'roles' && (
        <div>
          {/* 顶部统计卡片 */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {ROLE_OPTIONS.map(r => {
              const Icon = r.icon;
              const count = roleCounts[r.value] || 0;
              return (
                <button key={r.value}
                  onClick={() => setRoleFilter(roleFilter === r.value ? 'all' : r.value)}
                  className={`flex items-center gap-3 p-4 rounded-2xl border transition-all text-left ${
                    roleFilter === r.value
                      ? r.color + ' shadow-sm scale-[1.02]'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                  }`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    roleFilter === r.value ? 'bg-white/60' : 'bg-slate-100'
                  }`}>
                    <Icon className={`w-4 h-4 ${roleFilter === r.value ? '' : 'text-slate-500'}`} />
                  </div>
                  <div>
                    <p className="text-lg font-bold leading-none">{count}</p>
                    <p className="text-xs mt-0.5 opacity-70">{r.label.replace('（默认）', '')}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 搜索栏 */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={roleSearch}
                onChange={e => setRoleSearch(e.target.value)}
                placeholder="搜索姓名、工号、职位..."
                className="w-full h-9 pl-9 pr-4 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            {(roleFilter !== 'all' || roleDeptFilter) && (
              <button onClick={() => { setRoleFilter('all'); setRoleDeptFilter(null); }}
                className="h-9 px-3 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 flex items-center gap-1">
                清除筛选 ×
              </button>
            )}
            <span className="ml-auto text-xs text-slate-400">{filteredEmployees.length} 人</span>
            {roleMsg && <span className="text-xs text-emerald-600 font-medium">{roleMsg}</span>}
          </div>
          {/* 部门快捷筛选 chips */}
          {(() => {
            const depts = Array.from(new Map(allEmployees.filter(e => e.deptId && e.department).map(e => [e.deptId, e.department])).entries());
            if (depts.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <button onClick={() => setRoleDeptFilter(null)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    !roleDeptFilter ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}>全部</button>
                {depts.map(([deptId, deptName]) => (
                  <button key={deptId} onClick={() => setRoleDeptFilter(roleDeptFilter === deptId ? null : deptId!)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                      roleDeptFilter === deptId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                    }`}>{deptName}</button>
                ))}
              </div>
            );
          })()}

          {/* 人员列表 */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {/* 表头 */}
            <div className="grid grid-cols-[auto_auto_1fr_1fr_1fr_200px] gap-4 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-400">
              <input type="checkbox"
                checked={filteredEmployees.length > 0 && selectedLoginids.size === filteredEmployees.length}
                ref={el => { if (el) el.indeterminate = selectedLoginids.size > 0 && selectedLoginids.size < filteredEmployees.length; }}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 mt-0.5 cursor-pointer rounded"
              />
              <div className="w-8" />
              <div>姓名</div>
              <div>部门</div>
              <div>职位</div>
              <div>角色权限</div>
            </div>

            {filteredEmployees.length === 0 ? (
              <div className="py-16 text-center text-slate-300">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">{allEmployees.length === 0 ? '暂无人员，请先同步组织架构' : '没有匹配的人员'}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {filteredEmployees.map(emp => {
                  const loginid = emp.loginid || emp.id;
                  const role = getRole(loginid);
                  const opt = ROLE_OPTIONS.find(r => r.value === role)!;
                  const isSaving = savingId === loginid;
                  // 头像颜色按角色
                  const avatarColors: Record<string, string> = {
                    admin: 'bg-gradient-to-br from-red-400 to-rose-500',
                    manager: 'bg-gradient-to-br from-blue-400 to-blue-600',
                    secretary: 'bg-gradient-to-br from-purple-400 to-purple-600',
                    employee: 'bg-gradient-to-br from-slate-300 to-slate-400',
                  };
                  return (
                    <div key={emp.id}
                      className="grid grid-cols-[auto_auto_1fr_1fr_1fr_200px] gap-4 items-center px-5 py-3 hover:bg-slate-50/80 transition-colors">
                      <input type="checkbox" checked={selectedLoginids.has(loginid)} onChange={() => toggleSelect(loginid)}
                        className="w-3.5 h-3.5 cursor-pointer rounded" />
                      {/* 头像 */}
                      <div className={`w-8 h-8 rounded-full ${avatarColors[role]} flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm`}>
                        {emp.name.charAt(0)}
                      </div>
                      {/* 姓名 */}
                      <div>
                        <p className="text-sm font-medium text-slate-800">{emp.name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{loginid}</p>
                      </div>
                      {/* 部门 */}
                      <div className="text-sm text-slate-500 truncate">{emp.department || '—'}</div>
                      {/* 职位 */}
                      <div className="text-sm text-slate-500 truncate">{emp.position || '—'}</div>
                      {/* 角色选择器 */}
                      <div className="flex items-center gap-2">
                        <span className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${opt.color}`}>
                          <opt.icon className="w-2.5 h-2.5" />{opt.label.replace('（默认）', '')}
                        </span>
                        <select
                          value={role}
                          disabled={isSaving}
                          onChange={e => setRole(loginid, e.target.value)}
                          className="h-7 text-xs border border-slate-200 rounded-lg px-1.5 bg-white text-slate-600 cursor-pointer hover:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200 disabled:opacity-50"
                        >
                          {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                        {isSaving && <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 批量操作浮动条 */}
          {selectedLoginids.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white rounded-2xl shadow-2xl px-5 py-3.5 flex items-center gap-3">
              <span className="text-sm font-semibold">已选 {selectedLoginids.size} 人</span>
              <div className="w-px h-4 bg-white/20" />
              <span className="text-sm text-white/60">批量设置为</span>
              <select value={batchRole} onChange={e => setBatchRole(e.target.value)}
                className="h-8 text-sm bg-slate-700 border border-slate-600 rounded-lg px-2 text-white focus:outline-none">
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label.replace('（默认）', '')}</option>)}
              </select>
              <button onClick={batchSetRole} disabled={batchSaving}
                className="h-8 px-4 bg-blue-500 hover:bg-blue-400 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors">
                {batchSaving ? '保存中...' : '确认应用'}
              </button>
              <button onClick={() => setSelectedLoginids(new Set())}
                className="h-8 px-3 bg-slate-700 hover:bg-slate-600 text-sm rounded-lg transition-colors">
                取消
              </button>
            </div>
          )}

          {/* 权限说明 */}
          <div className="mt-4 grid grid-cols-4 gap-2">
            {ROLE_OPTIONS.map(r => {
              const Icon = r.icon;
              return (
                <div key={r.value} className={`flex items-start gap-2 p-3 rounded-xl border text-[11px] ${r.color}`}>
                  <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">{r.label.replace('（默认）', '')}</p>
                    <p className="mt-0.5 opacity-60 leading-relaxed">
                      {r.value === 'admin' && '全部功能不受限'}
                      {r.value === 'manager' && '台账/看板全部 + 稽核'}
                      {r.value === 'secretary' && '会议纪要生成/管理'}
                      {r.value === 'employee' && '仅看板我的任务'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 权限管理 ── */}
      {activeTab === 'permissions' && <PermissionMatrix />}

      {activeTab === 'org' && (<>
      {/* 顶栏操作 */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-blue-200 text-blue-600 text-sm rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? '同步中...' : '同步泛微OA'}
        </button>
        {lastSyncedAt && (
          <span className="text-xs text-slate-400">
            上次同步：{lastSyncedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
        <button onClick={handleClear}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50 transition-colors">
          <Trash2 className="w-3.5 h-3.5" /> 清空数据
        </button>
        <button onClick={() => openCreateDept(null)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors">
          <Plus className="w-3.5 h-3.5" /> 新增根部门
        </button>
      </div>

      {/* 双栏主体 */}
      <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 16rem)' }}>

        {/* 左侧部门树 */}
        <div className="flex-shrink-0 bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden" style={{ width: leftPanelWidth }}>
          <div className="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">部门</p>
            <div className="flex items-center gap-0.5">
              <button onClick={() => setCollapsedDeptIds(new Set())}
                className="px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors font-medium">展开</button>
              <span className="text-slate-200 text-xs">|</span>
              <button onClick={() => {
                const allParentIds = new Set(tree.filter(n => n.type === 'department' && n.children?.some(c => c.type === 'department')).map(n => n.id));
                setCollapsedDeptIds(allParentIds);
              }}
                className="px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors font-medium">折叠</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {/* 全部成员 */}
            <button onClick={() => setSelectedDeptId(null)}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                selectedDeptId === null ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}>
              <Users className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1 text-left truncate">全部成员</span>
              <span className="text-[11px] text-slate-400">{allEmployees.length}</span>
            </button>
            {/* 部门树 */}
            {loading ? (
              <div className="px-4 py-6 text-xs text-slate-300 text-center">加载中...</div>
            ) : tree.filter(n => n.type === 'department').length === 0 ? (
              <div className="px-4 py-6 text-xs text-slate-300 text-center">暂无部门</div>
            ) : (() => {
              const renderDeptTree = (nodes: OrgNode[], depth: number): React.ReactNode =>
                nodes.filter(n => n.type === 'department' && n.code !== 'UNCATEGORIZED').map(dept => {
                  const children = (dept.children || []).filter(c => c.type === 'department');
                  const hasChildren = children.length > 0;
                  const isCollapsed = collapsedDeptIds.has(dept.id);
                  const isSelected = selectedDeptId === dept.id;
                  const cnt = allEmployees.filter(e => e.deptId === dept.id).length;
                  const isRoot = depth === 0;
                  return (
                    <div key={dept.id}>
                      <div className={`group flex items-center h-7 pr-1 ${
                        isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                      }`}>
                        {/* 缩进 */}
                        <div style={{ width: depth * 14 + 4 }} className="flex-shrink-0" />
                        {/* 展开/折叠箭头 */}
                        <button
                          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 transition-colors ${
                            hasChildren ? 'text-slate-400 hover:text-slate-700' : 'opacity-0 pointer-events-none'
                          }`}
                          onClick={() => hasChildren && toggleDeptCollapse(dept.id)}
                        >
                          {isCollapsed
                            ? <ChevronRight className="w-3 h-3" />
                            : <ChevronDown className="w-3 h-3" />
                          }
                        </button>
                        {/* 图标 */}
                        {isRoot
                          ? <Home className={`w-3.5 h-3.5 flex-shrink-0 ml-0.5 ${isSelected ? 'text-blue-500' : 'text-blue-400'}`} />
                          : (hasChildren && !isCollapsed)
                            ? <FolderOpen className={`w-3.5 h-3.5 flex-shrink-0 ml-0.5 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                            : <Folder className={`w-3.5 h-3.5 flex-shrink-0 ml-0.5 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                        }
                        {/* 名称 */}
                        <button
                          onClick={() => setSelectedDeptId(dept.id)}
                          className={`flex-1 flex items-center gap-1 px-1.5 py-0.5 text-[12.5px] text-left truncate ${
                            isSelected ? 'text-blue-700 font-medium' : isRoot ? 'text-slate-700 font-medium' : 'text-slate-600'
                          }`}
                        >
                          <span className="flex-1 truncate">{dept.name}</span>
                          {cnt > 0 && <span className="text-[10px] text-slate-400 flex-shrink-0">{cnt}</span>}
                        </button>
                        {/* 编辑/删除按钮 */}
                        <button onClick={() => openEdit(dept)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-100 text-slate-400 rounded transition-all flex-shrink-0">
                          <Edit className="w-3 h-3" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDelete(dept); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-all flex-shrink-0">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      {!isCollapsed && hasChildren && renderDeptTree(children, depth + 1)}
                    </div>
                  );
                });
              return renderDeptTree(tree, 0);
            })()}
          </div>
        </div>

        {/* 拖拽分隔线 */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="w-1 flex-shrink-0 cursor-col-resize group flex items-stretch"
        >
          <div className="w-px flex-1 bg-slate-200 group-hover:bg-blue-400 transition-colors mx-auto" />
        </div>

        {/* 右侧员工面板 */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 右侧顶栏 */}
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-base font-semibold text-slate-800 flex-1 flex items-center gap-2">
              {selectedDeptId ? flatDepts.find(d => d.id === selectedDeptId)?.name ?? '部门' : '全部成员'}
              <span className="text-sm font-normal text-slate-400">{orgFilteredEmployees.length} 人</span>
            </h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input value={orgSearch} onChange={e => setOrgSearch(e.target.value)}
                placeholder="搜索成员..." className="h-8 pl-8 pr-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 w-44" />
            </div>
            {selectedDeptId && (
              <button onClick={() => openCreateDept(selectedDeptId)}
                className="flex items-center gap-1.5 h-8 px-3 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors">
                <Plus className="w-3.5 h-3.5" /> 子部门
              </button>
            )}
            <button onClick={() => openCreateEmp(selectedDeptId || '')}
              className="flex items-center gap-1.5 h-8 px-3 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
              <Plus className="w-3.5 h-3.5" /> 新增员工
            </button>
          </div>

          {/* 员工列表 */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex-1">
            <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-4 px-5 py-2.5 bg-slate-50 border-b border-slate-100 text-xs font-medium text-slate-400">
              <div className="w-8" /><div>姓名</div><div>部门</div><div>职位</div><div className="w-16 text-right">操作</div>
            </div>
            <div className="divide-y divide-slate-50 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 22rem)' }}>
              {orgFilteredEmployees.length === 0 ? (
                <div className="py-16 text-center text-slate-300">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{allEmployees.length === 0 ? '暂无成员，请先同步组织架构' : '没有匹配成员'}</p>
                </div>
              ) : orgFilteredEmployees.map(emp => {
                const role = getRole(emp.loginid || emp.id);
                const opt = ROLE_OPTIONS.find(r => r.value === role)!;
                const avatarColors: Record<string, string> = {
                  admin: 'from-red-400 to-rose-500',
                  manager: 'from-blue-400 to-blue-600',
                  secretary: 'from-purple-400 to-purple-600',
                  employee: 'from-slate-300 to-slate-400',
                };
                return (
                  <div key={emp.id} className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-4 items-center px-5 py-2.5 hover:bg-slate-50/80 transition-colors group">
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarColors[role]} flex items-center justify-center text-white text-sm font-bold shadow-sm`}>
                      {emp.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{emp.name}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                        {emp.loginid || emp.code || '—'}
                        <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border ${opt.color}`}>
                          <opt.icon className="w-2.5 h-2.5" />{opt.label.replace('（默认）', '')}
                        </span>
                      </p>
                    </div>
                    <div className="text-sm text-slate-500 truncate">{emp.department || '—'}</div>
                    <div className="text-sm text-slate-400 truncate">{emp.position || '—'}</div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit({ type: 'employee', id: emp.id, name: emp.name, code: emp.code, position: emp.position, email: emp.email, phone: emp.phone, status: emp.status })}
                        className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-lg">
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete({ type: 'employee', id: emp.id, name: emp.name })}
                        className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── 对话框 ── */}
      <Dialog open={!!dialogType} onOpenChange={open => !open && setDialogType(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogType === 'create-dept' && '新增部门'}
              {dialogType === 'edit-dept' && '编辑部门'}
              {dialogType === 'create-emp' && '新增员工'}
              {dialogType === 'edit-emp' && '编辑员工'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {dialogType?.includes('dept') ? (
              <>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">部门名称 *</label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">部门编码 *</label>
                  <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="h-8 text-sm" placeholder="如：IT" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">排序号</label>
                  <Input type="number" value={form.sort} onChange={e => setForm(f => ({ ...f, sort: parseInt(e.target.value) || 0 }))} className="h-8 text-sm" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">姓名 *</label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">工号 *</label>
                  <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="h-8 text-sm" placeholder="如：E0001" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">职位</label>
                  <Input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">邮箱</label>
                  <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">手机</label>
                  <Input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="h-8 text-sm" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <button onClick={() => setDialogType(null)} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">取消</button>
            <button onClick={submitForm} disabled={!form.name} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">保存</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>)}
    </DashboardLayout>
  );
}
