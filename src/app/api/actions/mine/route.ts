import { NextResponse } from 'next/server';
import { getAllActionItems, getMeetings } from '@/storage';
import { getCurrentUser } from '@/lib/session';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';
import { isGroupOwner } from '@/lib/group-owners';

// GET /api/actions/mine - 获取当前登录用户的行动项（从新表读取）
// ?includeGroup=1 - 管理员可附带"群体责任人"（所有人/各部门等）的持续项，用于代填
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    // includeGroup 仅 admin/manager 有效
    let includeGroup = false;
    if (new URL(request.url).searchParams.get('includeGroup') === '1') {
      try {
        const { resolveRole } = await import('@/lib/roles');
        const role = await resolveRole(user.loginid);
        includeGroup = role === 'admin' || role === 'manager';
      } catch { /* 角色解析失败按无权限处理 */ }
    }

    const myName = user.name?.trim().toLowerCase();
    const myLoginId = user.loginid?.trim().toLowerCase();
    const resolvedUser = await resolveActionOwnerIdentity({
      owner: user.name || null,
      ownerLoginId: user.loginid || null,
    });
    const myOaId = resolvedUser.ownerOaId?.trim();

    const allItems = await getAllActionItems();
    const allMeetings = await getMeetings();
    const meetingMap: Record<string, { title: string; meetingDate: string; organizer: string; status?: string; type?: string }> = {};
    for (const m of allMeetings) {
      meetingMap[m.id] = { title: m.title, meetingDate: m.meetingDate || '', organizer: m.organizer || '', status: m.status || 'draft', type: (m as any).type || '' };
    }

    // 批量获取批次信息
    const batchMap: Record<string, { title: string; createdBy: string; createdAt: string }> = {};
    try {
      const { getAllTaskBatches } = await import('@/storage');
      const batches = await getAllTaskBatches();
      for (const b of batches) {
        batchMap[b.id] = { title: b.title, createdBy: b.createdBy || '', createdAt: b.createdAt };
      }
    } catch { /* batch table may not exist yet */ }

    const myActions = allItems.filter(item => {
      const owner = (item.owner || '').trim().toLowerCase();
      const ownerLoginId = (item.ownerLoginId || '').trim().toLowerCase();
      const isMyAction = (
        (myName && owner === myName) ||
        (myLoginId && (ownerLoginId === myLoginId || owner === myLoginId)) ||
        (myOaId && item.ownerOaId === myOaId)
      );

      // 管理员代填模式：附带群体责任人（所有人/各部门）的持续项
      // 这些项推不到具体个人，由管理员在"我的任务"里代为填写进展
      if (includeGroup && isGroupOwner(item.owner) && item.dueDateType === 'continuous') {
        return filterArchived(item);
      }

      // 只显示已归档（locked）会议的行动项，避免未确认的任务进入个人待办
      if (!isMyAction) return false;
      if (item.meetingId) {
        const meeting = meetingMap[item.meetingId];
        if (meeting?.status !== 'locked') return false;
      }

      return true;
    }).map(item => {
      const meeting = item.meetingId ? meetingMap[item.meetingId] : null;
      const batch = (!item.meetingId && item.sourceType === 'batch' && item.sourceId) ? batchMap[item.sourceId] : null;
      const effectiveDate = meeting?.meetingDate || batch?.createdAt?.slice(0, 10) || item.createdAt?.slice(0, 10) || '';
      return {
        id: item.id,
        description: item.description,
        owner: item.owner,
        is_group: isGroupOwner(item.owner),
        proposer: item.proposer,
        proposerLoginId: item.proposerLoginId,
        due_date: item.dueDate,
        due_date_type: item.dueDateType || 'date',
        cycle_date: item.cycleDate || null,
        priority: item.priority,
        status: item.status,
        meeting_id: item.meetingId,
        meeting_title: meeting?.title || batch?.title || '',
        meeting_type: meeting?.type || (item.sourceType === 'batch' ? (item.sourceText || '') : ''),
        meeting_date: effectiveDate,
        meeting_organizer: (meeting?.organizer === '褰撳墠鐢ㄦ埛' ? '' : (meeting?.organizer || batch?.createdBy || '')),
        meeting_status: meeting?.status || 'locked',
        oa_result: item.oaResult,
        oa_result_at: item.oaResultAt,
        oa_score: item.oaScore,
        oa_attachments: item.oaAttachments || [],
        completed_at: item.completedAt,
        block_reason: item.blockReason,
      };
    });

    const statusOrder: Record<string, number> = { candidate: 0, pending: 1, in_progress: 2, blocked: 3, done: 4 };

    function filterArchived(item: typeof allItems[number]): boolean {
      if (!item.meetingId) return true;
      const meeting = meetingMap[item.meetingId];
      return meeting?.status === 'locked';
    }
    myActions.sort((a, b) => {
      const so = (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5);
      if (so !== 0) return so;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });

    return NextResponse.json({ success: true, data: myActions });
  } catch (error) {
    console.error('[actions/mine]', error);
    const message = error instanceof Error ? error.message : String(error);
    if ((error as any)?.code === 'ETIMEOUT' || /Failed to connect|ConnectionError|connect timeout/i.test(message)) {
      return NextResponse.json({ success: true, data: [] });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}
