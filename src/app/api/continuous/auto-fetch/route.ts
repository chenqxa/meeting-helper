import { NextRequest, NextResponse } from 'next/server';
import { guardWrite } from '@/lib/api-guard';
import { runAutoFetch } from '@/lib/continuous-auto-fetch';

// POST /api/continuous/auto-fetch - 手动触发一轮持续项「自动取数」（admin）
// 入参：
//   weekEnd: 数据周日 YYYY-MM-DD（补某周，缺省取上一自然周）
//   dryRun:  true 时不写库，仅返回拟写入内容（previews）用于验证
export async function POST(request: NextRequest) {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;

    const body = await request.json().catch(() => ({}));
    const result = await runAutoFetch(undefined, {
      endDate: body && typeof body.weekEnd === 'string' && body.weekEnd.trim() ? body.weekEnd.trim() : undefined,
      dryRun: !!(body && body.dryRun),
      only: body && typeof body.actionId === 'string' && body.actionId.trim()
        ? {
            actionId: body.actionId.trim(),
            source: typeof body.source === 'string' ? body.source : undefined,
            params: body.params && typeof body.params === 'object' ? body.params : null,
          }
        : undefined,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[continuous/auto-fetch]', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '自动取数失败' }, { status: 500 });
  }
}
