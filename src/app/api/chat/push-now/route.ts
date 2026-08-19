import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById, getProjectById } from '@/storage';
import { sendScheduledTodos } from '@/lib/todo-push';

/**
 * POST /api/chat/push-now
 * 立即触发推送。支持按会议 (meetingId) 或按项目 (projectId) 推送。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { meetingId, projectId, dryRun = false } = body;

    if (!meetingId && !projectId) {
      return NextResponse.json(
        { success: false, error: '请提供 meetingId 或 projectId' },
        { status: 400 }
      );
    }

    let targetName = '';
    let filterOptions: any = {};

    if (meetingId) {
      const meeting = await getMeetingById(meetingId);
      if (!meeting) return NextResponse.json({ success: false, error: '会议不存在' }, { status: 404 });
      targetName = `会议: ${meeting.title}`;
      // todo-push 目前支持按项目过滤，我们需要临时增加按会议过滤的支持或手动构建 buckets
      // 为了复用现有逻辑，我们直接调用 sendScheduledTodos 并传入特定的过滤逻辑
      // 注意：sendScheduledTodos 内部使用的是 getAllActionItems()，我们需要确保它能按 meetingId 过滤
      filterOptions = { meetingId };
    } else if (projectId) {
      const project = await getProjectById(projectId);
      if (!project) return NextResponse.json({ success: false, error: '项目不存在' }, { status: 404 });
      targetName = `项目: ${project.name}`;
      filterOptions = { projectId };
    }

    // 调用现有的推送逻辑
    // 修改 todo-push.ts 使其支持按 meetingId 过滤
    const manualPushPrefix = dryRun
      ? undefined
      : `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await sendScheduledTodos({
      ...filterOptions,
      format: 'card',
      scheduleLabel: `手动即时推送 - ${targetName}`,
      idempotencyPrefix: manualPushPrefix,
      includeHeader: true,
      dryRun,
    });

    return NextResponse.json({
      success: true,
      data: {
        message: dryRun ? `已生成预览: ${targetName}` : `已完成推送: ${targetName}`,
        dryRun,
        idempotentHits: result.details.filter(d => d.idempotentHit).map(d => d.ownerName),
        ...result
      }
    });

  } catch (error) {
    console.error('[PushNow] 失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 }
    );
  }
}
