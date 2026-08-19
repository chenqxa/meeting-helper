import { NextRequest, NextResponse } from 'next/server';
import { getTaskBatchById, updateTaskBatch, deleteTaskBatch, getAllActionItems, updateActionItem, deleteActionItem, createActionItem } from '@/storage';
import { getCurrentUser } from '@/lib/session';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';
import { getAppPool, deleteOATasksBySourceId } from '@/lib/oa-task-push';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const batch = await getTaskBatchById(id);
    if (!batch) return NextResponse.json({ success: false, error: '批次不存在' }, { status: 404 });
    const items = await getAllActionItems();
    const batchItems = items.filter(i => i.sourceType === 'batch' && i.sourceId === id);
    return NextResponse.json({ success: true, data: { batch, items: batchItems } });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });

    const { id } = await params;
    const batch = await getTaskBatchById(id);
    if (!batch) return NextResponse.json({ success: false, error: '批次不存在' }, { status: 404 });
    if (batch.status === 'pushed') return NextResponse.json({ success: false, error: '已推送的批次不可编辑' }, { status: 400 });

    const body = await request.json();
    if (body.title != null) await updateTaskBatch(id, { title: body.title });

    if (body.items != null) {
      const existing = await getAllActionItems();
      const existingBatch = existing.filter(i => i.sourceType === 'batch' && i.sourceId === id);
      const updatedIds = new Set<string>();

      for (const item of body.items) {
        if (item.id) {
          updatedIds.add(item.id);
          const resolved = item.owner ? await resolveActionOwnerIdentity({ owner: item.owner || null, ownerLoginId: item.ownerLoginId || null, dept: item.dept || null }) : null;
          await updateActionItem(item.id, {
            description: item.description,
            owner: resolved?.owner || item.owner || null,
            ownerLoginId: resolved?.ownerLoginId || item.ownerLoginId || null,
            ownerOaId: resolved?.ownerOaId || item.ownerOaId || null,
            dept: resolved?.dept || item.dept || null,
            dueDate: item.dueDateType === 'date' ? (item.dueDate || null) : null,
            dueDateType: item.dueDateType || 'date',
            priority: item.priority || 'medium',
            status: item.status || 'pending',
          });
        } else if (item.description?.trim()) {
          const resolved = await resolveActionOwnerIdentity({ owner: item.owner || null, ownerLoginId: item.ownerLoginId || null, dept: item.dept || null });
          const created = await createActionItem({
            meetingId: null, description: item.description.trim(),
            owner: resolved?.owner || item.owner || null, ownerLoginId: resolved?.ownerLoginId || null,
            ownerOaId: resolved?.ownerOaId || null, dept: resolved?.dept || item.dept || null,
            dueDate: item.dueDateType === 'date' ? (item.dueDate || null) : null,
            dueDateType: item.dueDateType || 'date', priority: item.priority || 'medium',
            status: 'pending', sourceType: 'batch', sourceId: id,
          });
          updatedIds.add(created.id);
        }
      }

      for (const ex of existingBatch) {
        if (!updatedIds.has(ex.id)) await deleteActionItem(ex.id);
      }
    }

    const updatedBatch = await getTaskBatchById(id);
    const items = await getAllActionItems();
    const batchItems = items.filter(i => i.sourceType === 'batch' && i.sourceId === id);
    return NextResponse.json({ success: true, data: { batch: updatedBatch, items: batchItems } });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });

    const { id } = await params;
    const batch = await getTaskBatchById(id);
    if (!batch) return NextResponse.json({ success: false, error: '批次不存在' }, { status: 404 });

    // 删除批次下所有行动项
    const allItems = await getAllActionItems();
    const batchItems = allItems.filter(i => i.sourceType === 'batch' && i.sourceId === id);

    // 如果已推送，先作废 OA 记录
    if (batch.status === 'pushed') {
      try {
        await deleteOATasksBySourceId(id);
        console.log(`[batch delete] OA 记录已作废: ${id}`);
      } catch (e) {
        console.warn('[batch delete] OA 作废失败:', (e as Error).message);
      }
    }

    for (const item of batchItems) {
      await deleteActionItem(item.id);
    }

    await deleteTaskBatch(id);
    return NextResponse.json({ success: true, message: `已删除，含 ${batchItems.length} 条行动项${batch.status === 'pushed' ? '，OA已作废' : ''}` });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
