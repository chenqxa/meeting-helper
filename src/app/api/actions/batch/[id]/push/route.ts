import { NextRequest, NextResponse } from 'next/server';
import { getTaskBatchById, updateTaskBatch, getAllActionItems } from '@/storage';
import { pushTasksToOA } from '@/lib/oa-task-push';
import { getCurrentUser } from '@/lib/session';
import { logOperation } from '@/lib/operation-log';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { id } = await params;
    const batch = await getTaskBatchById(id);
    if (!batch) {
      return NextResponse.json({ success: false, error: '批次不存在' }, { status: 404 });
    }

    const allItems = await getAllActionItems();
    const batchItems = allItems.filter(i => i.sourceType === 'batch' && i.sourceId === id);

    if (batchItems.length === 0) {
      return NextResponse.json({ success: false, error: '批次下无行动项' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 推送到 OA
    const oaResult = await pushTasksToOA({
      id: batch.id,
      title: batch.title,
      date: batch.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      actionItems: batchItems.map(item => ({
        id: item.id,
        description: item.description,
        owner: item.owner,
        assignee: item.owner,
        ownerLoginId: item.ownerLoginId,
        ownerOaId: item.ownerOaId,
        dept: item.dept,
        due_date: item.dueDate,
        dueDate: item.dueDate,
        priority: item.priority,
        status: item.status,
      })),
    });

    // 更新批次状态
    await updateTaskBatch(id, { status: 'pushed', oaPushedAt: now });

    await logOperation({
      action: 'batch_push',
      targetType: 'batch',
      targetId: id,
      summary: `批次「${batch.title}」推送 OA：${oaResult.pushed} 条成功${oaResult.failed ? `，${oaResult.failed} 条失败` : ''}`,
      detail: { pushed: oaResult.pushed, failed: oaResult.failed, batchId: id, title: batch.title },
    });

    console.log(`[batch push] 批次 ${id} 已推送: OA ${oaResult.pushed} 条`);

    return NextResponse.json({
      success: true,
      data: {
        batchId: id,
        oaPush: {
          pushed: oaResult.pushed,
          failed: oaResult.failed,
          summary: oaResult.summary,
          errors: oaResult.errors,
        },
      },
    });
  } catch (error) {
    console.error('[batch push]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '推送失败' },
      { status: 500 }
    );
  }
}
