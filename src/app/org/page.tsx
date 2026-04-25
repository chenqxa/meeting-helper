'use client';

import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import {
  Building2, Users, User, Plus, Edit, Trash2, Search, ChevronRight, ChevronDown,
  Briefcase, Mail, Phone, MapPin, RefreshCw
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import { useRouter } from 'next/navigation';

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

export default function OrgPage() {
  const router = useRouter();
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);

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
      // 调用数据库直连接口（从泛微OA数据库获取数据）
      const res = await fetch('/api/org/sync-db', {
        method: 'POST',
      });
      const r = await res.json();
      if (r.success) {
        alert(`同步成功：部门 ${r.data.departments.created} 新增/${r.data.departments.updated} 更新，员工 ${r.data.employees.created} 新增/${r.data.employees.updated} 更新`);
        loadOrgTree();
      } else {
        alert('同步失败：' + (r.error || '未知错误'));
      }
    } catch (err) {
      alert('同步失败：网络错误');
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
      setForm({ name: node.name, code: '', position: node.position, email: node.email, phone: node.phone, status: node.status });
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
    if (!confirm(`确定要删除 ${node.name} 吗？`)) return;
    try {
      const url = node.type === 'department' ? `/api/org/departments/${node.id}` : `/api/org/employees/${node.id}`;
      const res = await fetch(url, { method: 'DELETE' });
      const r = await res.json();
      if (r.success) loadOrgTree();
      else alert(r.error || '删除失败');
    } catch { /* silent */ }
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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">组织架构</h1>
          <button
            onClick={expandAll}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 hover:bg-slate-100 rounded"
          >
            展开全部
          </button>
          <button
            onClick={collapseAll}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 hover:bg-slate-100 rounded"
          >
            收起全部
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-blue-200 text-blue-600 text-sm rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" /> } 同步泛微OA
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-sm rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> 清空数据
          </button>
          <button
            onClick={() => openCreateDept(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> 新增根部门
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="mb-4">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input
            placeholder="搜索员工..."
            value={searchKeyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchKeyword(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* 组织树 */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 min-h-[600px]">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-400 text-sm">加载中...</div>
        ) : filteredTree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400 text-sm gap-2">
            <Building2 className="w-8 h-8" />
            <span>{searchKeyword ? '未找到匹配结果' : '暂无组织架构，点击右上角新增'}</span>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredTree.map(node => renderNode(node))}
          </div>
        )}
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
    </DashboardLayout>
  );
}
