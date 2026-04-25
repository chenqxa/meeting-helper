import { NextRequest, NextResponse } from 'next/server';
import { getMeetings, updateMeeting } from '@/storage/database/memory-storage';

// 在所有会议中找到指定行动项，返回 { meeting, itemIndex }
// 新ID格式: ${meeting.id}-${item.id}
async function findActionItem(actionId: string) {
  const meetings = await getMeetings();
  for (const meeting of meetings) {
    const items = meeting.actionItems || [];
    // 支持旧格式（纯item.id）和新格式（meeting.id-item.id）
    const idx = items.findIndex((item: any) => 
      item.id === actionId || `${meeting.id}-${item.id}` === actionId
    );
    if (idx !== -1) {
      return { meeting, itemIndex: idx };
    }
  }
  return null;
}

// PUT /api/actions/[id] - 更新行动项状态、负责人等
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: actionId } = await params;
    const body = await request.json();
    const found = await findActionItem(actionId);

    if (!found) {
      return NextResponse.json(
        { success: false, error: 'Action item not found' },
        { status: 404 }
      );
    }

    const { meeting, itemIndex } = found;
    const items = [...(meeting.actionItems || [])];

    // 合并更新字段
    const now = new Date().toISOString();
    items[itemIndex] = {
      ...items[itemIndex],
      ...body,
      // 映射前端字段名到后端字段名
      ...(body.owner !== undefined && { assignee: body.owner }),
      ...(body.due_date !== undefined && { dueDate: body.due_date }),
      // 完成记录
      ...(body.status === 'done' && {
        completed_by: body.completed_by || '当前用户',
        completed_at: now,
        completion_note: body.completion_note || null,
        evidence_files: body.evidence_files || items[itemIndex].evidence_files || [],
      }),
      // 确认记录
      ...(body.status === 'in_progress' && !items[itemIndex].confirmed_at && {
        confirmed_by: body.confirmed_by || '当前用户',
        confirmed_at: now,
      }),
      // 阻塞记录
      ...(body.status === 'blocked' && {
        blocked_by: body.blocked_by || '当前用户',
        blocked_at: now,
        block_reason: body.block_reason || null,
      }),
      updated_at: now,
    };

    await updateMeeting(meeting.id, { actionItems: items });

    return NextResponse.json({ success: true, data: items[itemIndex] });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/actions/[id] - 删除行动项
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: actionId } = await params;
    const found = await findActionItem(actionId);

    if (!found) {
      return NextResponse.json(
        { success: false, error: 'Action item not found' },
        { status: 404 }
      );
    }

    const { meeting, itemIndex } = found;
    const items = [...(meeting.actionItems || [])];
    items.splice(itemIndex, 1);

    await updateMeeting(meeting.id, { actionItems: items });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
