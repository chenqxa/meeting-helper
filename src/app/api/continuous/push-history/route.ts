import { NextRequest, NextResponse } from 'next/server';
import { getPushLogs } from '@/storage/database/continuous-push-log-storage';

// GET /api/continuous/push-history?meeting_type=&page=&pageSize=
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const items = await getPushLogs({
      meetingType: searchParams.get('meeting_type') || searchParams.get('meetingType') || undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
      pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 20,
    });
    return NextResponse.json({ success: true, data: items.items, total: items.total });
  } catch (error) {
    console.error('[continuous/push-history] 查询推送历史失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '查询失败' },
      { status: 500 }
    );
  }
}
