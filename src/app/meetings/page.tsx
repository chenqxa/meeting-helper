'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Search, FileText, Calendar, Users, Clock, Download, MoreVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface MeetingData {
  id: string;
  title: string;
  type: string;
  status: string;
  meeting_date: string;
  participants: string[];
  version: number;
  summary?: {
    topics?: string[];
  };
  created_at: string;
}

// 优化会议卡片组件
const MeetingCard = memo(({ meeting, onClick }: { meeting: MeetingData; onClick: () => void }) => {
  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      weekly: '周会',
      monthly: '月会',
      project: '项目会',
      general: '常规会议',
    };
    return typeMap[type] || type;
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { color: string; label: string }> = {
      draft: { color: 'bg-slate-100 text-slate-700', label: '草稿' },
      review: { color: 'bg-yellow-100 text-yellow-700', label: '审核中' },
      locked: { color: 'bg-green-100 text-green-700', label: '已完成' },
    };
    const { color, label } = statusMap[status] || { color: 'bg-slate-100 text-slate-700', label: status };
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${color}`}>{label}</span>;
  };

  return (
    <Card
      className="p-5 border-2 border-slate-200 hover:border-blue-400 hover:shadow-md transition-all duration-300 cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              {meeting.title}
            </h3>
            {getStatusBadge(meeting.status)}
            <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
              {getTypeLabel(meeting.type)}
            </span>
          </div>
          <p className="text-sm text-slate-600 mb-3 line-clamp-2">
            {meeting.summary?.topics?.join('、') || '暂无摘要'}
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>{new Date(meeting.meeting_date).toLocaleDateString('zh-CN')}</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span>{meeting.participants?.length || 0} 人</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>v{meeting.version}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              // 导出功能
            }}
          >
            <Download className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <MoreVertical className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
});
MeetingCard.displayName = 'MeetingCard';

export default function MeetingsPage() {
  const router = useRouter();
  const [meetings, setMeetings] = useState<MeetingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'weekly' | 'monthly' | 'project'>('all');

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/meetings/list');
      const result = await response.json();
      if (result.success) {
        setMeetings(result.data || []);
      }
    } catch (error) {
      console.error('获取会议列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredMeetings = meetings.filter(meeting => {
    const matchesSearch = meeting.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === 'all' || meeting.type === filterType;
    return matchesSearch && matchesFilter;
  });

  const handleMeetingClick = useCallback((meetingId: string) => {
    router.push(`/meeting/${meetingId}`);
  }, [router]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">会议记录</h2>
            <p className="text-slate-600 mt-1">查看和管理所有会议纪要</p>
          </div>
          <Button
            onClick={() => router.push('/')}
            className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 hover:scale-105 transition-all duration-300"
          >
            <FileText className="w-4 h-4 mr-2" />
            新建会议
          </Button>
        </div>

        {/* 搜索和筛选 */}
        <Card className="p-4 border-2 border-slate-200">
          <div className="flex gap-4 items-center">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="搜索会议主题、参会人..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={filterType === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterType('all')}
                className={filterType === 'all' ? 'bg-blue-500' : ''}
              >
                全部
              </Button>
              <Button
                variant={filterType === 'weekly' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterType('weekly')}
                className={filterType === 'weekly' ? 'bg-blue-500' : ''}
              >
                周会
              </Button>
              <Button
                variant={filterType === 'monthly' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterType('monthly')}
                className={filterType === 'monthly' ? 'bg-blue-500' : ''}
              >
                月会
              </Button>
              <Button
                variant={filterType === 'project' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterType('project')}
                className={filterType === 'project' ? 'bg-blue-500' : ''}
              >
                项目会
              </Button>
            </div>
          </div>
        </Card>

        {/* 会议列表 */}
        <div className="space-y-3">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-slate-600">加载中...</p>
            </div>
          ) : filteredMeetings.length === 0 ? (
            <Card className="p-12 text-center border-2 border-dashed border-slate-200">
              <FileText className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 mb-2">暂无会议记录</p>
              <p className="text-sm text-slate-500">点击上方按钮创建新会议</p>
            </Card>
          ) : (
            filteredMeetings.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onClick={() => handleMeetingClick(meeting.id)}
              />
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
