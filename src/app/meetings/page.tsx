'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { WeaverPagination } from '@/components/ui/weaver-pagination';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Search, FileText, Calendar, Users, Clock, Download, Pencil, X, RefreshCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

// 相对时间格式化
const formatRelativeTime = (dateStr: string | undefined): string => {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
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
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};

const normalizeName = (name?: string | null): string => {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const garbledMap: Record<string, string> = {
    '褰撳墠鐢ㄦ埛': '当前用户',
  };
  return garbledMap[trimmed] ?? trimmed;
};

interface MeetingData {
  id: string;
  title: string;
  type: string;
  status: string;
  meetingDate: string;
  department?: string;
  participants: string[];
  organizer?: string;
  version: number;
  summary?: { topics?: string[] };
  createdAt: string;
}

type QuickMeetingFilter = 'all' | 'today' | 'this_week' | 'pending_review' | 'archived' | 'my_related';

// ── 会议卡片 ──
const MeetingCard = memo(({ meeting, canEdit, onClick, onEdit, onDelete }: {
  meeting: MeetingData;
  canEdit: boolean;
  onClick: () => void;
  onEdit: (m: MeetingData) => void;
  onDelete: (m: MeetingData) => void;
}) => {
  const getTypeLabel = (t: string) => ({ weekly:'周会', monthly:'月会', project:'项目会', general:'常规会议' }[t] ?? t);
  const getStatusBadge = (s: string) => {
    const map: Record<string, { color: string; label: string; icon?: any }> = {
      draft:  { color: 'bg-blue-100 text-blue-700 border border-blue-200',   label: '草稿' },
      review: { color: 'bg-amber-100 text-amber-700 border border-amber-200', label: '待确认' },
      locked: { color: 'bg-emerald-100 text-emerald-700 border border-emerald-200', label: '已归档' },
    };
    const { color, label } = map[s] ?? { color: 'bg-slate-100 text-slate-700 border border-slate-200', label: s };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>;
  };
  const dateStr = formatRelativeTime(meeting.meetingDate);

  return (
    <Card
      className="p-6 border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              {meeting.title}
            </h3>
            {getStatusBadge(meeting.status)}
            <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
              {getTypeLabel(meeting.type)}
            </span>
            {meeting.department && (
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
                {meeting.department}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600 mb-3 line-clamp-2">
            {meeting.summary?.topics?.join('、') || '暂无摘要'}
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>{dateStr}</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>{meeting.participants?.length || 0} 人</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>v{meeting.version ?? 1}</span>
            </div>
          </div>
          {meeting.participants?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {meeting.participants.slice(0, 5).map(name => (
                <span key={name} className="px-2 py-0.5 text-[11px] rounded-full bg-slate-100 text-slate-500 border border-slate-200">{name}</span>
              ))}
              {meeting.participants.length > 5 && (
                <span className="px-2 py-0.5 text-[11px] rounded-full bg-slate-100 text-slate-400 border border-slate-200">+{meeting.participants.length - 5} 人</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              title="补充部门/参会人"
              onClick={e => { e.stopPropagation(); onEdit(meeting); }}
              className="text-amber-600 hover:bg-amber-50"
            >
              <Pencil className="w-4 h-4" />
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              title="删除会议"
              onClick={e => { e.stopPropagation(); onDelete(meeting); }}
              className="text-slate-400 hover:text-red-500 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={e => e.stopPropagation()}>
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
});
MeetingCard.displayName = 'MeetingCard';

// ── 主页面 ──
const normalizeMeeting = (m: MeetingData): MeetingData => ({
  ...m,
  organizer: normalizeName(m.organizer),
  participants: (m.participants || []).map(normalizeName).filter(Boolean),
});

export default function MeetingsPage() {
  const router = useRouter();
  const [meetings, setMeetings]     = useState<MeetingData[]>([]);
  const [loading, setLoading]       = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterOrganizer, setFilterOrganizer] = useState('');
  const [dateStart, setDateStart] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  });
  const [dateEnd, setDateEnd] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()}`;
  });
  const [quickFilter, setQuickFilter] = useState<QuickMeetingFilter>('all');
  const [userRole, setUserRole]     = useState<string>('employee');
  const [currentUserName, setCurrentUserName] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pageSize: 12 });

  // DEV-PATCH 弹窗状态
  const [editTarget, setEditTarget]           = useState<MeetingData | null>(null);
  const [editTitle, setEditTitle]             = useState('');
  const [editDept, setEditDept]               = useState('');
  const [editOrganizer, setEditOrganizer]     = useState('');
  const [editType, setEditType]               = useState('');
  const [editParticipants, setEditParticipants] = useState<string[]>([]);
  const [addPersonValue, setAddPersonValue]   = useState('');
  const [isSaving, setIsSaving]               = useState(false);
  const [departments, setDepartments]         = useState<string[]>([]);
  const [allOrgNames, setAllOrgNames]         = useState<string[]>([]);
  const [meetingTypes, setMeetingTypes]       = useState<string[]>([]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [authRes, deptsRes, empsRes, typesRes] = await Promise.allSettled([
          fetch('/api/auth/me').then(r => r.json()),
          fetch('/api/org/departments').then(r => r.json()),
          fetch('/api/org/employees').then(r => r.json()),
          fetch('/api/meeting-types').then(r => r.json()),
        ]);

        if (authRes.status === 'fulfilled' && authRes.value.success) {
          setUserRole(authRes.value.data.role || 'employee');
          setCurrentUserName(normalizeName(authRes.value.data.name || ''));
        } else {
          console.error('[meetings] Failed to load user info:', authRes.status === 'rejected' ? authRes.reason : authRes.value);
        }

        if (deptsRes.status === 'fulfilled' && deptsRes.value.success) {
          setDepartments((deptsRes.value.data || []).filter((x: any) => x.status !== 'inactive').map((x: any) => x.name as string));
        } else {
          console.error('[meetings] Failed to load departments:', deptsRes.status === 'rejected' ? deptsRes.reason : deptsRes.value);
        }

        if (empsRes.status === 'fulfilled' && empsRes.value.success) {
          setAllOrgNames((empsRes.value.data || []).filter((e: any) => e.status !== 'resigned').map((e: any) => e.name as string));
        } else {
          console.error('[meetings] Failed to load employees:', empsRes.status === 'rejected' ? empsRes.reason : empsRes.value);
        }

        if (typesRes.status === 'fulfilled' && typesRes.value.success) {
          setMeetingTypes((typesRes.value.data || []).map((t: any) => t.name as string));
        } else {
          console.error('[meetings] Failed to load meeting types:', typesRes.status === 'rejected' ? typesRes.reason : typesRes.value);
        }
      } catch (error) {
        console.error('[meetings] Failed to load initial data:', error);
      }
    };

    loadInitialData();
    fetchMeetings();
  }, []);

  const fetchMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/meetings/list');
      const d = await r.json();
      if (d.success) {
        setMeetings((d.data || []).map(normalizeMeeting));
      } else {
        console.error('[meetings] Failed to fetch meetings:', d.error);
      }
    } catch (error) {
      console.error('[meetings] Failed to fetch meetings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const canEdit = ['admin', 'manager', 'secretary'].includes(userRole);
  const allTypes = ['all', ...Array.from(new Set([...meetingTypes, 'weekly', 'monthly', 'project', 'general']))];
  const allOrganizers = Array.from(new Set(meetings.map(m => normalizeName(m.organizer)).filter(Boolean)));
  const typeLabel: Record<string, string> = { all:'全部', weekly:'周会', monthly:'月会', project:'项目会', general:'常规会议' };
  const statusLabel: Record<string, string> = { all:'全部状态', draft:'草稿', review:'待确认', locked:'已归档' };
  const quickFilterLabel: Record<QuickMeetingFilter, string> = {
    all: '全部',
    today: '今天',
    this_week: '本周',
    pending_review: '待确认',
    archived: '已归档',
    my_related: '与我相关',
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const filteredMeetings = meetings.filter(m => {
    const keyword = searchQuery.toLowerCase();
    const organizer = normalizeName(m.organizer);
    const participants = m.participants || [];
    const meetingDate = new Date(m.meetingDate);
    const matchSearch =
      m.title.toLowerCase().includes(keyword) ||
      organizer.toLowerCase().includes(keyword) ||
      (m.department || '').toLowerCase().includes(keyword) ||
      participants.some(p => p.toLowerCase().includes(keyword));
    const matchType   = filterType === 'all' || m.type === filterType;
    const matchStatus = filterStatus === 'all' || m.status === filterStatus;
    const matchDepartment = !filterDepartment || (m.department || '') === filterDepartment;
    const matchOrganizer = !filterOrganizer || organizer === filterOrganizer;
    const matchStart = !dateStart || (!isNaN(meetingDate.getTime()) && meetingDate >= new Date(dateStart));
    const matchEnd = (() => {
      if (!dateEnd || isNaN(meetingDate.getTime())) return true;
      const end = new Date(dateEnd);
      end.setHours(23, 59, 59, 999);
      return meetingDate <= end;
    })();
    const matchQuick = (() => {
      if (quickFilter === 'all') return true;
      if (quickFilter === 'today') return !isNaN(meetingDate.getTime()) && meetingDate >= today && meetingDate < tomorrow;
      if (quickFilter === 'this_week') return !isNaN(meetingDate.getTime()) && meetingDate >= today && meetingDate <= weekEnd;
      if (quickFilter === 'pending_review') return m.status === 'review';
      if (quickFilter === 'archived') return m.status === 'locked';
      if (quickFilter === 'my_related') {
        return organizer === currentUserName || participants.includes(currentUserName);
      }
      return true;
    })();
    return matchSearch && matchType && matchStatus && matchDepartment && matchOrganizer && matchStart && matchEnd && matchQuick;
  });

  const activeFilterCount = [
    searchQuery,
    filterDepartment,
    filterOrganizer,
    dateStart,
    dateEnd,
    filterType !== 'all' ? filterType : '',
    filterStatus !== 'all' ? filterStatus : '',
    quickFilter !== 'all' ? quickFilter : '',
  ].filter(Boolean).length;

  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [searchQuery, filterType, filterStatus, filterDepartment, filterOrganizer, dateStart, dateEnd, quickFilter]);

  // 分页切片
  const paginatedMeetings = filteredMeetings.slice(
    (pagination.page - 1) * pagination.pageSize,
    pagination.page * pagination.pageSize
  );

  // 打开 DEV-PATCH 弹窗
  const openEdit = useCallback((m: MeetingData) => {
    const normalized = normalizeMeeting(m);
    setEditTarget(normalized);
    setEditTitle(normalized.title || '');
    setEditDept(normalized.department || '');
    setEditOrganizer(normalized.organizer || '');
    setEditType((normalized as any).type || (m as any).type || '');
    setEditParticipants(normalized.participants || []);
    setAddPersonValue('');
  }, []);

  // 保存补充信息
  const saveEdit = async () => {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      await fetch(`/api/meetings/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, department: editDept, organizer: editOrganizer, participants: editParticipants, type: editType }),
      });
      setMeetings(prev => prev.map(m =>
        m.id === editTarget.id ? normalizeMeeting({ ...m, title: editTitle, department: editDept, organizer: editOrganizer, participants: editParticipants, type: editType } as any) : m
      ));
      setEditTarget(null);
    } finally { setIsSaving(false); }
  };

  const handleDelete = useCallback(async (m: MeetingData) => {
    if (!confirm(`确定删除会议「${m.title}」？此操作将同时删除关联的行动项和OA数据，不可恢复。`)) return;
    try {
      const res = await fetch(`/api/meetings/${m.id}`, { method: 'DELETE' });
      const r = await res.json();
      if (r.success) {
        setMeetings(prev => prev.filter(x => x.id !== m.id));
      } else {
        alert('删除失败: ' + (r.error || '未知错误'));
      }
    } catch {
      alert('删除失败');
    }
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 标题栏 */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900">会议中心</h2>
          <p className="text-slate-600 mt-1">{userRole === 'employee' ? '我参与或主持的会议' : '查看和管理会议纪要'}</p>
        </div>

        {/* 大厂风筛选区 */}
        <Card className="overflow-hidden border border-slate-200 shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(quickFilterLabel) as QuickMeetingFilter[]).map(key => (
                <button
                  key={key}
                  onClick={() => setQuickFilter(key)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold transition-all ${
                    quickFilter === key
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  {quickFilterLabel[key]}
                </button>
              ))}
              <div className="ml-auto text-xs font-medium text-slate-400">
                当前结果 {filteredMeetings.length} 场
              </div>
            </div>
          </div>

          <div className="p-4">
            <div className="flex gap-3 items-center flex-wrap">
              <div className="flex-1 min-w-[220px] relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="搜索会议主题、主持人、参会人、部门..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="h-10 rounded-2xl border-slate-200 pl-10"
                />
              </div>

              <div className="min-w-[150px]">
                <SearchableSelect
                  value={filterDepartment}
                  onChange={setFilterDepartment}
                  options={departments}
                  placeholder="全部部门"
                />
              </div>

              <div className="min-w-[150px]">
                <SearchableSelect
                  value={filterOrganizer}
                  onChange={setFilterOrganizer}
                  options={allOrganizers}
                  placeholder="全部主持人"
                />
              </div>

              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-600"
              >
                {allTypes.map(t => (
                  <option key={t} value={t}>{typeLabel[t] ?? t}</option>
                ))}
              </select>

              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-600"
              >
                {(['all', 'draft', 'review', 'locked'] as const).map(s => (
                  <option key={s} value={s}>{statusLabel[s]}</option>
                ))}
              </select>

              <input
                type="date"
                value={dateStart}
                onChange={e => setDateStart(e.target.value)}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-600"
                title="开始日期"
              />

              <input
                type="date"
                value={dateEnd}
                onChange={e => setDateEnd(e.target.value)}
                className="h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-600"
                title="结束日期"
              />

              {activeFilterCount > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterType('all');
                    setFilterStatus('all');
                    setFilterDepartment('');
                    setFilterOrganizer('');
                    setDateStart('');
                    setDateEnd('');
                    setQuickFilter('all');
                  }}
                  className="h-10 rounded-2xl"
                >
                  清空筛选
                </Button>
              )}

              <Button
                variant="outline"
                onClick={fetchMeetings}
                className="h-10 w-10 rounded-2xl p-0"
                title="刷新会议"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </Card>

        {/* 会议列表 */}
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
              <p className="mt-4 text-slate-600">加载中...</p>
            </div>
          ) : filteredMeetings.length === 0 ? (
            <Card className="p-12 text-center border-2 border-dashed border-slate-200">
              <FileText className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 mb-2">暂无会议记录</p>
              <p className="text-sm text-slate-500">点击右上角「+ 新建会议」创建你的第一个会议</p>
            </Card>
          ) : (
            paginatedMeetings.map(m => (
              <MeetingCard key={m.id} meeting={m} canEdit={canEdit}
                onClick={() => router.push(`/meeting/${m.id}`)}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
        {/* 分页 */}
        {!loading && filteredMeetings.length > 0 && (
          <div className="flex justify-end pt-4">
            <WeaverPagination
              total={filteredMeetings.length}
              current={pagination.page}
              pageSize={pagination.pageSize}
              onPageChange={(page) => setPagination({ ...pagination, page })}
              onPageSizeChange={(pageSize) => setPagination({ page: 1, pageSize })}
            />
          </div>
        )}
      </div>

      {/* ── DEV-PATCH 补充信息弹窗 ── 正式上线后删除此弹窗及卡片上的铅笔按钮即可 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5">
            {/* 头部 */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase tracking-wide">DEV-PATCH</span>
                  <h3 className="text-base font-bold text-slate-900">补充会议信息</h3>
                </div>
                <p className="text-xs text-slate-500 line-clamp-1">{editTarget.title}</p>
              </div>
              <button onClick={() => setEditTarget(null)} className="text-slate-400 hover:text-slate-600 mt-0.5">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 会议标题 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">会议标题</label>
              <Input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="输入会议标题…"
                className="h-9 text-sm rounded-lg"
              />
            </div>

            {/* 所属部门 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">所属部门</label>
              <SearchableSelect
                value={editDept}
                onChange={setEditDept}
                options={departments}
                placeholder="搜索或选择部门…"
              />
            </div>

            {/* 会议类型 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">会议类型</label>
              <SearchableSelect
                value={editType}
                onChange={setEditType}
                options={meetingTypes}
                placeholder="搜索或选择会议类型…"
              />
            </div>

            {/* 主持人 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">主持人</label>
              <SearchableSelect
                value={editOrganizer}
                onChange={setEditOrganizer}
                options={allOrgNames}
                placeholder="搜索或选择主持人…"
                clearable
              />
            </div>

            {/* 参会人员 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-600">参会人员</label>
                <span className="text-[11px] text-slate-400">{editParticipants.length} 人</span>
              </div>
              {/* chips */}
              <div className="flex flex-wrap gap-1.5 p-2.5 border border-slate-200 rounded-lg bg-slate-50 min-h-[44px]">
                {editParticipants.length === 0 ? (
                  <span className="text-[11px] text-slate-300 self-center">暂无参会人员</span>
                ) : editParticipants.map(name => (
                  <span key={name} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-blue-600 text-white">
                    {name}
                    <button type="button"
                      onClick={() => setEditParticipants(prev => prev.filter(p => p !== name))}
                      className="hover:opacity-70 leading-none"
                    >×</button>
                  </span>
                ))}
              </div>
              {/* 搜索添加 */}
              {allOrgNames.length > 0 && (
                <SearchableSelect
                  value={addPersonValue}
                  onChange={name => {
                    if (name && !editParticipants.includes(name)) setEditParticipants(prev => [...prev, name]);
                    setAddPersonValue('');
                  }}
                  options={allOrgNames.filter(n => !editParticipants.includes(n))}
                  placeholder="搜索添加参会人…"
                  clearable={false}
                />
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setEditTarget(null)}>取消</Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={saveEdit}
                disabled={isSaving}
              >
                {isSaving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
