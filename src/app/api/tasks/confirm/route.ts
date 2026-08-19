import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById, updateMeeting } from '@/storage';
import { verifyTaskToken } from '@/lib/weaver-notify';

// POST /api/tasks/confirm
// body: { taskKey: "meetingId_itemIndex", sig: "xxx", action: "done"|"delay"|"blocked", remark?: string }
export async function POST(request: NextRequest) {
  try {
    const { taskKey, sig, action, remark } = await request.json();

    if (!taskKey || !sig || !action) {
      return NextResponse.json(
        { success: false, error: '参数不完整' },
        { status: 400 }
      );
    }

    // 验证签名
    if (!verifyTaskToken(taskKey, sig)) {
      return NextResponse.json(
        { success: false, error: '无效的确认链接' },
        { status: 403 }
      );
    }

    // 解析 taskKey = meetingId_itemIndex
    const lastUnderscore = taskKey.lastIndexOf('_');
    const meetingId = taskKey.slice(0, lastUnderscore);
    const itemIndex = parseInt(taskKey.slice(lastUnderscore + 1), 10);

    if (!meetingId || isNaN(itemIndex)) {
      return NextResponse.json(
        { success: false, error: '无效的任务标识' },
        { status: 400 }
      );
    }

    const meeting = await getMeetingById(meetingId);
    if (!meeting) {
      return NextResponse.json(
        { success: false, error: '会议不存在' },
        { status: 404 }
      );
    }

    const items: any[] = meeting.actionItems || [];
    if (itemIndex < 0 || itemIndex >= items.length) {
      return NextResponse.json(
        { success: false, error: '行动项不存在' },
        { status: 404 }
      );
    }

    const statusMap: Record<string, string> = {
      done: 'done',
      delay: 'in_progress',
      blocked: 'blocked',
    };

    items[itemIndex] = {
      ...items[itemIndex],
      status: statusMap[action] || 'in_progress',
      confirmedAt: new Date().toISOString(),
      confirmRemark: remark || '',
    };

    await updateMeeting(meetingId, { actionItems: items });

    return NextResponse.json({
      success: true,
      message: action === 'done' ? '已标记为完成' : action === 'blocked' ? '已标记为阻塞' : '已标记为延期',
      data: { taskKey, action, item: items[itemIndex] },
    });
  } catch (error) {
    console.error('[api/tasks/confirm]', error);
    return NextResponse.json(
      { success: false, error: '服务器内部错误' },
      { status: 500 }
    );
  }
}

// GET /api/tasks/confirm?taskKey=xxx&sig=yyy - 获取任务详情（落地页用）
export async function GET(request: NextRequest) {
  const taskKey = request.nextUrl.searchParams.get('taskKey') || '';
  const sig = request.nextUrl.searchParams.get('sig') || '';

  if (!taskKey || !sig) {
    return NextResponse.json({ success: false, error: '参数缺失' }, { status: 400 });
  }

  if (!verifyTaskToken(taskKey, sig)) {
    return NextResponse.json({ success: false, error: '无效链接' }, { status: 403 });
  }

  const lastUnderscore = taskKey.lastIndexOf('_');
  const meetingId = taskKey.slice(0, lastUnderscore);
  const itemIndex = parseInt(taskKey.slice(lastUnderscore + 1), 10);

  const meeting = await getMeetingById(meetingId);
  if (!meeting) {
    return NextResponse.json({ success: false, error: '会议不存在' }, { status: 404 });
  }

  const items: any[] = meeting.actionItems || [];
  const item = items[itemIndex];
  if (!item) {
    return NextResponse.json({ success: false, error: '行动项不存在' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      taskKey,
      sig,
      item,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        meetingDate: meeting.meetingDate,
        organizer: meeting.organizer,
      },
    },
  });
}
