import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById, updateMeeting, getAllActionItems } from '@/storage';
import { MinutesGenerator } from '@/lib/minutes-generator';
import { deriveSummary, deriveActionItems } from '@/lib/minutes-derive';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';

// 思考模型（hunyuan-t1 等）需要更长处理时间
export const maxDuration = 600; // 10 minutes

export async function POST(request: NextRequest) {
  try {
    const { meetingId, generateProvider, defaultProposer, defaultProposerLoginId, defaultProposerOaId } = await request.json();

    if (!meetingId) {
      return NextResponse.json(
        { success: false, error: 'Missing meetingId' },
        { status: 400 }
      );
    }

    const meeting = await getMeetingById(meetingId);
    if (!meeting) {
      return NextResponse.json(
        { success: false, error: 'Meeting not found' },
        { status: 404 }
      );
    }

    const content = meeting.content;
    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Meeting content is empty' },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    const participants = meeting.participants || [];

    console.log(`[Generate] Starting for meeting ${meetingId} (${content.length} chars, ${participants.length} participants)`);

    // ━━ 核心流程：原始文本 → 会议纪要（1次AI调用）→ 派生摘要和行动项 ━━
    const minutes = await MinutesGenerator.generateMinutes(
      content,
      meeting.title,
      meeting.meetingDate,
      participants,
      generateProvider || process.env.AI_PROVIDER || 'tencent'
    );

    // 从纪要中派生摘要和行动项（纯数据转换，无AI调用）
    const summary = deriveSummary(minutes);
    let actionItems = deriveActionItems(minutes);

    // P3: 注入项目上下文去重（如果会议关联了项目）
    if (meeting.projectId) {
      const existingActions = await getAllActionItems({ projectId: meeting.projectId });
      const existingDescriptions = new Set(
        existingActions
          .filter(a => a.status !== 'done' && a.status !== 'candidate')
          .map(a => a.description.toLowerCase().trim())
      );

      // 简单去重：描述前30字匹配
      actionItems = actionItems.filter(item => {
        const key = item.description.toLowerCase().trim().substring(0, 30);
        if (existingDescriptions.has(key)) {
          console.log('[P3-dedup] 跳过重复行动项:', item.description);
          return false;
        }
        return true;
      });

      console.log(`[P3-dedup] 项目 ${meeting.projectId} 去重后: ${actionItems.length} 条`);
    }

    // 行动项默认提出人：仅用生成时传入 或 会议级 defaultProposer，不再兜底 organizer
    // 原因：提出人应反映真实提出者，误填主持人会导致闭环通知错人
    const proposerName = (defaultProposer && String(defaultProposer).trim())
      || (meeting as any).defaultProposer
      || '';
    const proposerLoginId = (defaultProposerLoginId && String(defaultProposerLoginId).trim())
      || (meeting as any).defaultProposerLoginId
      || '';
    const proposerOaId = (defaultProposerOaId && String(defaultProposerOaId).trim())
      || (meeting as any).defaultProposerOaId
      || '';
    if (proposerName) {
      actionItems = (actionItems as any[]).map(item => ({
        ...item,
        proposer: item.proposer || proposerName || null,
        proposerLoginId: item.proposerLoginId || proposerLoginId || null,
        proposerOaId: item.proposerOaId || proposerOaId || null,
      }));
    }

    const processingTime = Date.now() - startTime;

    console.log(`[Generate] Done in ${(processingTime / 1000).toFixed(1)}s: ${minutes.sections?.length || 0} sections, ${actionItems.length} actions`);

    // 保存到数据库（含 defaultProposer 默认值）
    const meetingPatch: any = {
      minutes,
      summary,
      actionItems,
      status: 'review',
    };
    if (defaultProposer !== undefined) {
      meetingPatch.defaultProposer = proposerName || null;
      meetingPatch.defaultProposerLoginId = proposerLoginId || null;
      meetingPatch.defaultProposerOaId = proposerOaId || null;
    }
    await updateMeeting(meetingId, meetingPatch);

    return NextResponse.json({
      success: true,
      data: {
        meetingId,
        minutes,
        summary,
        actionItems,
        processingTime,
        defaultProposer: proposerName,
        debug_step1a_markdown: minutes.debug_step1a_markdown,
      },
    });
  } catch (error) {
    console.error('[Generate] Failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
