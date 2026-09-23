import { NextRequest, NextResponse } from 'next/server';
import { guardPermission } from '@/lib/api-guard';
import { getTaskBatchById, getAllActionItems } from '@/storage';
import { pushBatchActionsToWeCom } from '@/lib/wecom-action-push';
import { logOperation } from '@/lib/operation-log';

// POST /api/actions/batch/[id]/push-wecom - 手动推送批次（含导入项）企微提醒
// 权限：canPushBatch（默认 admin，可在权限矩阵调整）
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await guardPermission('canPushBatch');
  if (!g.ok) return g.response;
  try {
    const { id } = await params;
    const batch = await getTaskBatchById(id);
    if (!batch) {
      return NextResponse.json({ success: false, error: '批次不存在' }, { status: 404 });
    }

    const all = await getAllActionItems();
    const items = all.filter(i => i.sourceType === 'batch' && i.sourceId === id);
    if (items.length === 0) {
      return NextResponse.json({ success: false, error: '批次下无行动项' }, { status: 400 });
    }

    const result = await pushBatchActionsToWeCom({
      batchId: id,
      batchTitle: batch.title,
      items: items.map(it => ({
        id: it.id,
        description: it.description,
        owner: it.owner,
        assignee: it.owner,
        dueDate: it.dueDate,
        dueDateType: it.dueDateType,
        priority: it.priority,
        status: it.status,
      })),
      triggeredBy: g.user.loginid,
    });

    await logOperation({
      action: 'batch_push',
      targetType: 'batch',
      targetId: id,
      summary: `批次「${batch.title}」推送企微：成功 ${result.sent}，失败 ${result.failed}`,
      detail: { batchId: id, sent: result.sent, failed: result.failed, status: result.status, operator: g.user.loginid },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[batch push-wecom]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '推送失败' },
      { status: 500 },
    );
  }
}
