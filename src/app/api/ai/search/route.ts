import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { query, meetings } = await request.json();

    if (!query || !Array.isArray(meetings)) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    // 简化版：使用关键词匹配作为降级方案
    // 真正的AI语义搜索需要向量数据库和embedding服务
    const results = meetings.filter((m: any) => {
      const title = m.title?.toLowerCase() || '';
      const content = m.minutes?.meetingContent?.toLowerCase() || '';
      const summary = m.summary?.overview?.toLowerCase() || '';
      const searchLower = query.toLowerCase();

      return (
        title.includes(searchLower) ||
        content.includes(searchLower) ||
        summary.includes(searchLower)
      );
    });

    // 按相关性排序（标题匹配优先）
    results.sort((a: any, b: any) => {
      const aTitle = a.title?.toLowerCase() || '';
      const bTitle = b.title?.toLowerCase() || '';
      const searchLower = query.toLowerCase();

      const aTitleMatch = aTitle.includes(searchLower);
      const bTitleMatch = bTitle.includes(searchLower);

      if (aTitleMatch && !bTitleMatch) return -1;
      if (!aTitleMatch && bTitleMatch) return 1;
      return 0;
    });

    return NextResponse.json({
      success: true,
      results,
      message: '使用关键词匹配（AI语义搜索需要向量数据库）',
    });
  } catch (error) {
    console.error('[AI Search] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Search failed' },
      { status: 500 }
    );
  }
}
