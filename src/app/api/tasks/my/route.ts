import { NextResponse } from 'next/server';
import { getMeetings } from '@/storage';
import { getCurrentUser } from '@/lib/session';

// GET /api/tasks/my - 返回当前登录用户的所有行动项（跨会议）
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const meetings = await getMeetings();
    const myTasks: any[] = [];

    for (const meeting of meetings) {
      const items: any[] = meeting.actionItems || [];
      items.forEach((item, idx) => {
        const isAssignee =
          item.assignee === user.name ||
          item.owner === user.name ||
          item.assigneeOaId === user.loginid;

        if (isAssignee) {
          myTasks.push({
            ...item,
            _meetingId: meeting.id,
            _meetingTitle: meeting.title,
            _meetingDate: meeting.meetingDate,
            _itemIndex: idx,
          });
        }
      });
    }

    // 按状态排序：pending > in_progress > blocked > done
    const ORDER: Record<string, number> = {
      pending: 0, in_progress: 1, blocked: 2,
      done: 3, completed: 3, confirmed: 3,
    };
    myTasks.sort((a, b) => (ORDER[a.status] ?? 1) - (ORDER[b.status] ?? 1));

    return NextResponse.json({
      success: true,
      data: myTasks,
      meta: { total: myTasks.length, user: { name: user.name, loginid: user.loginid } },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}
