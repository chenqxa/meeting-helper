import { NextRequest, NextResponse } from 'next/server';
import { guardWrite } from '@/lib/api-guard';
import { runDueReminder, runAutoOverdueX } from '@/lib/auto-overdue-processor';

// POST /api/overdue/auto-x - 行动项到期自动处理（admin）
// body:
//   action: 'preview' | 'execute' | 'reminder-preview'
//   dryRun: true = 只预览不执行（preview 同义）
export async function POST(request: NextRequest) {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;

    const body = await request.json().catch(() => ({}));
    const action = body.action || 'preview';

    if (action === 'reminder-preview' || action === 'reminder-execute') {
      const dryRun = action === 'reminder-preview' || body.dryRun === true;
      const result = await runDueReminder(dryRun);
      return NextResponse.json({ success: true, data: result });
    }

    const dryRun = action === 'preview' || body.dryRun === true;
    const result = await runAutoOverdueX(dryRun);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[overdue/auto-x]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '执行失败' },
      { status: 500 },
    );
  }
}
