'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Search, FileText, Upload, Mic, Download, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface FileData {
  id: string;
  filename: string;
  url: string;
  type: string;
  size: number;
  created_at: string;
}

export default function FilesPage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'audio' | 'document'>('all');

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/files/list');
      const result = await response.json();
      if (result.success) {
        setFiles(result.data || []);
      }
    } catch (error) {
      console.error('获取文件列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredFiles = files.filter(file => {
    const matchesSearch = file.filename.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === 'all' ||
      (filterType === 'audio' && file.type?.startsWith('audio/')) ||
      (filterType === 'document' && (file.type?.includes('word') || file.type?.includes('text')));
    return matchesSearch && matchesFilter;
  });

  const getFileIcon = (type: string) => {
    if (type?.startsWith('audio/')) return <Mic className="w-8 h-8 text-purple-500" />;
    return <FileText className="w-8 h-8 text-blue-500" />;
  };

  const getFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const handleUpload = () => {
    router.push('/');
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">最近文件</h2>
            <p className="text-slate-600 mt-1">管理上传的音频和文档文件</p>
          </div>
          <Button
            onClick={handleUpload}
            className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 hover:scale-105 transition-all duration-300"
          >
            <Upload className="w-4 h-4 mr-2" />
            上传文件
          </Button>
        </div>

        {/* 搜索和筛选 */}
        <Card className="p-4 border-2 border-slate-200">
          <div className="flex gap-4 items-center">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="搜索文件名..."
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
                variant={filterType === 'audio' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterType('audio')}
                className={filterType === 'audio' ? 'bg-blue-500' : ''}
              >
                音频
              </Button>
              <Button
                variant={filterType === 'document' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilterType('document')}
                className={filterType === 'document' ? 'bg-blue-500' : ''}
              >
                文档
              </Button>
            </div>
          </div>
        </Card>

        {/* 文件列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-full text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-slate-600">加载中...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <Card className="col-span-full p-12 text-center border-2 border-dashed border-slate-200">
              <Upload className="w-16 h-16 mx-auto text-slate-400 mb-4" />
              <p className="text-slate-600 mb-2">暂无文件</p>
              <p className="text-sm text-slate-500">点击上方按钮上传新文件</p>
            </Card>
          ) : (
            filteredFiles.map((file, index) => (
              <Card
                key={index}
                className="p-5 border-2 border-slate-200 hover:border-blue-400 hover:shadow-xl hover:scale-[1.02] hover:-translate-y-1 transition-all duration-300 group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                    {getFileIcon(file.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 mb-1 truncate group-hover:text-blue-600 transition-colors">
                      {file.filename}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                      <span>{getFileSize(file.size)}</span>
                      <span>•</span>
                      <span>{new Date(file.created_at).toLocaleDateString('zh-CN')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
