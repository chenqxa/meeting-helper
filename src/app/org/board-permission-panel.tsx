'use client';

// 看板人员授权面板：搜索员工 → 勾选看板 → 保存（覆盖角色默认）
// 放在 /org 权限管理 tab 的权限矩阵下方
import { useState, useEffect, useMemo } from 'react';
import { Search, Monitor, Trash2, RefreshCw, Save } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface BoardPerm {
  loginid: string;
  boardKey: string;
  allowed: boolean;
}

interface Employee {
  id: string;
  name: string;
  loginid?: string;
  department?: string;
}

const BOARD_LABELS: Record<string, string> = {
  weekly: '周例会看板',
  monthly: '月度看板',
  production: '产销会看板',
};

export function BoardPermissionPanel() {
  const [perms, setPerms] = useState<BoardPerm[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedLoginid, setSelectedLoginid] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState('');
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [pRes, eRes] = await Promise.all([
        fetch('/api/board-permissions').then(r => r.json()),
        fetch('/api/org/employees').then(r => r.json()),
      ]);
      if (pRes.success) setPerms(pRes.data || []);
      if (eRes.success) setEmployees(eRes.data || []);
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // 按人分组（已有人员级配置的）
  const byPerson = useMemo(() => {
    const map: Record<string, Record<string, boolean>> = {};
    for (const p of perms) {
      if (!map[p.loginid]) map[p.loginid] = {};
      map[p.loginid][p.boardKey] = p.allowed;
    }
    return map;
  }, [perms]);

  // 员工姓名映射
  const nameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of employees) {
      if (e.loginid) map[e.loginid] = e.name;
    }
    return map;
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return employees.filter(e =>
      e.name?.toLowerCase().includes(q) || e.loginid?.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [search, employees]);

  const selectPerson = (emp: Employee) => {
    const lid = emp.loginid || emp.id;
    setSelectedLoginid(lid);
    setSelectedName(emp.name);
    setSearch('');
    // 预填：已有配置用已有值，否则全 false（未配置状态）
    const existing = byPerson[lid] || {};
    setDraft({
      weekly: existing.weekly ?? false,
      monthly: existing.monthly ?? false,
      production: existing.production ?? false,
    });
    setMsg('');
  };

  const save = async () => {
    if (!selectedLoginid) return;
    setSaving(true);
    setMsg('');
    try {
      for (const [key, allowed] of Object.entries(draft)) {
        await fetch('/api/board-permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ loginid: selectedLoginid, boardKey: key, allowed }),
        });
      }
      setMsg('已保存');
      await load();
    } catch {
      setMsg('保存失败');
    }
    setSaving(false);
  };

  const clearPerson = async (loginid: string) => {
    setSaving(true);
    try {
      await fetch(`/api/board-permissions?loginid=${encodeURIComponent(loginid)}`, { method: 'DELETE' });
      if (selectedLoginid === loginid) {
        setSelectedLoginid(null);
        setSelectedName('');
        setDraft({});
      }
      await load();
      setMsg('已清除（恢复角色默认）');
    } catch {
      setMsg('清除失败');
    }
    setSaving(false);
  };

  return (
    <div className="mt-6 bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-bold text-slate-700">看板人员授权</h3>
          <span className="text-xs text-slate-400">人员授权优先于角色默认权限</span>
        </div>
        <button onClick={load} className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-blue-500">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 搜索选人 */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="搜索员工姓名或登录名..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-9 pl-9 text-sm"
          />
        </div>
        {search.trim() && filteredEmployees.length > 0 && (
          <div className="mt-1 max-w-sm rounded-xl border border-slate-200 shadow-lg bg-white z-10 relative">
            {filteredEmployees.map(emp => (
              <button
                key={emp.loginid || emp.id}
                onClick={() => selectPerson(emp)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between"
              >
                <span>{emp.name}</span>
                <span className="text-xs text-slate-400">{emp.department || ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 选中人的看板勾选 */}
      {selectedLoginid && (
        <div className="mb-4 p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-700">{selectedName} 的看板权限</span>
            <div className="flex gap-2">
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1 px-3 h-8 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                <Save className="w-3.5 h-3.5" /> {saving ? '保存中...' : '保存'}
              </button>
              <button onClick={() => clearPerson(selectedLoginid)} disabled={saving}
                className="flex items-center gap-1 px-3 h-8 border border-slate-200 text-slate-500 text-xs rounded-lg hover:bg-slate-50 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" /> 清除
              </button>
            </div>
          </div>
          <div className="flex gap-4">
            {Object.entries(BOARD_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft[key] ?? false}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">{label}</span>
              </label>
            ))}
          </div>
          {msg && <p className="text-xs text-slate-500">{msg}</p>}
        </div>
      )}

      {/* 已授权人员列表 */}
      <div>
        <div className="text-xs font-semibold text-slate-500 mb-2">
          已授权人员（{Object.keys(byPerson).length} 人）
        </div>
        {Object.keys(byPerson).length === 0 ? (
          <p className="text-xs text-slate-300 py-3 text-center">暂无人员级授权，所有人均按角色默认权限</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left font-medium py-2 px-3">员工</th>
                <th className="text-left font-medium py-2 px-3">登录名</th>
                {Object.entries(BOARD_LABELS).map(([key, label]) => (
                  <th key={key} className="text-center font-medium py-2 px-3">{label}</th>
                ))}
                <th className="text-center font-medium py-2 px-3 w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byPerson).map(([loginid, boards]) => (
                <tr key={loginid} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2 px-3 text-slate-700 font-medium">{nameMap[loginid] || loginid}</td>
                  <td className="py-2 px-3 text-slate-400 font-mono">{loginid}</td>
                  {Object.entries(BOARD_LABELS).map(([key]) => (
                    <td key={key} className="text-center py-2 px-3">
                      {boards[key] !== undefined ? (
                        <span className={boards[key] ? 'text-emerald-600 font-bold' : 'text-red-400'}>
                          {boards[key] ? '✓' : '✗'}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                  <td className="text-center py-2 px-3">
                    <button onClick={() => clearPerson(loginid)} disabled={saving}
                      className="text-red-400 hover:text-red-600" title="清除（恢复角色默认）">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-slate-300 mt-2">— 表示未配置，按角色默认走；✓=允许看、✗=禁止看</p>
      </div>
    </div>
  );
}
