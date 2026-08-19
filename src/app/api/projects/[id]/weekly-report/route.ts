import { NextRequest, NextResponse } from 'next/server';
import { getProjectById, getAllActionItems, getMeetings } from '@/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    const project = await getProjectById(projectId);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const [actions, meetings] = await Promise.all([
      getAllActionItems({ projectId }),
      getMeetings(),
    ]);

    const projectMeetings = meetings.filter((m: any) => m.projectId === projectId);

    // 计算本周时间范围
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    // 本周完成的行动项
    const completedThisWeek = actions.filter(a => {
      if (!a.completedAt) return false;
      const completedDate = new Date(a.completedAt);
      return completedDate >= weekStart && completedDate <= weekEnd;
    });

    // 本周新增行动项
    const addedThisWeek = actions.filter(a => {
      if (!a.createdAt) return false;
      const createdDate = new Date(a.createdAt);
      return createdDate >= weekStart && createdDate <= weekEnd;
    });

    // 本周会议
    const meetingsThisWeek = projectMeetings.filter(m => {
      if (!m.meetingDate) return false;
      const meetingDate = new Date(m.meetingDate);
      return meetingDate >= weekStart && meetingDate <= weekEnd;
    });

    // 风险检测
    const risks: string[] = [];
    const overdueActions = actions.filter(a => {
      if (!a.dueDate || a.status === 'done') return false;
      const dueDate = new Date(a.dueDate);
      return dueDate < now;
    });
    if (overdueActions.length > 0) {
      risks.push(`${overdueActions.length} 个行动项已超期`);
    }

    const blockedActions = actions.filter(a => a.status === 'blocked');
    if (blockedActions.length > 0) {
      risks.push(`${blockedActions.length} 个行动项被阻塞`);
    }

    const unassignedActions = actions.filter(a => !a.owner && a.status !== 'done');
    if (unassignedActions.length > 0) {
      risks.push(`${unassignedActions.length} 个行动项未指派负责人`);
    }

    const total = actions.length;
    const done = actions.filter(a => a.status === 'done').length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;

    const report = {
      projectId,
      projectName: project.name,
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      summary: {
        totalActions: total,
        completedActions: done,
        progress,
        meetingsThisWeek: meetingsThisWeek.length,
        completedThisWeek: completedThisWeek.length,
        addedThisWeek: addedThisWeek.length,
      },
      risks: risks.length > 0 ? risks : ['无风险'],
      recentMeetings: meetingsThisWeek.slice(0, 5).map((m: any) => ({
        id: m.id,
        title: m.title,
        date: m.meetingDate,
      })),
      topPendingActions: actions
        .filter(a => a.status !== 'done')
        .sort((a, b) => {
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        })
        .slice(0, 10)
        .map(a => ({
          id: a.id,
          description: a.description,
          owner: a.owner,
          dueDate: a.dueDate,
          status: a.status,
        })),
    };

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    console.error('[weekly-report]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
