import { NextRequest, NextResponse } from 'next/server';
import { executeOaPullResults } from '@/lib/oa-pull-runner';

// POST /api/oa/pull-results
// 从 uf_meetingplan 拉取 OA 用户填写的完成结果（wcjgsm/wcqkfj），同步回行动项
// body 可选：{ cursorAt: '2026-08-01T00:00:00Z' } 增量同步时只拉该时间之后修改的记录
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const cursorAt = typeof body.cursorAt === 'string' && body.cursorAt ? body.cursorAt : null;

  const result = await executeOaPullResults(cursorAt);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error || '同步失败' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      synced: result.synced,
      contSynced: result.contSynced,
      rescheduledCount: result.rescheduled,
      message: result.message,
    },
  });
}
