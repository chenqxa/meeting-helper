import { NextRequest, NextResponse } from 'next/server';
import { getOperationLogs } from '@/storage/database/operation-log-storage';

// GET /api/operations?meeting_id=&operator=&action=&start=&end=&page=&pageSize=
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const items = await getOperationLogs({
      meetingId: searchParams.get('meeting_id') || undefined,
      operator: searchParams.get('operator') || undefined,
      action: searchParams.get('action') || undefined,
      start: searchParams.get('start') || undefined,
      end: searchParams.get('end') || undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
      pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 20,
    });

    return NextResponse.json({ success: true, data: items.items, total: items.total });
  } catch (error) {
    console.error('[operations] 读取日志失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '读取日志失败' },
      { status: 500 }
    );
  }
}
