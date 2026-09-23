import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById, updateMeeting, getAllActionItems } from '@/storage';
import { MinutesGenerator } from '@/lib/minutes-generator';
import { deriveSummary, deriveActionItems } from '@/lib/minutes-derive';
import { resolveActionOwnerIdentity, resolveDeptByName } from '@/lib/action-owner';
import { matchUserFuzzy } from '@/lib/name-matcher';

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

    // 已归档会议禁止重新生成（防止退回待确认 + 行动项被重建/错位）
    if ((meeting as { status?: string }).status === 'locked') {
      return NextResponse.json(
        { success: false, error: '会议已归档，不能重新生成纪要；如需修改请先在会议详情页解锁' },
        { status: 409 }
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
      // 生成时即解析提出人部门，避免台账里提出部门为空
      const proposerDept = await resolveDeptByName(proposerName);
      actionItems = (actionItems as any[]).map(item => ({
        ...item,
        proposer: item.proposer || proposerName || null,
        proposerLoginId: item.proposerLoginId || proposerLoginId || null,
        proposerOaId: item.proposerOaId || proposerOaId || null,
        proposerDept: item.proposerDept || proposerDept || null,
      }));
    }

    // 责任人/提出人"名字带部门"清洗：AI 生成易产出 '陈巧霞（开发部）'/'开发部张三' 等，
    // 模糊匹配到 OA 用户则归一为纯姓名+身份，匹配不到保留原值（不限制自定义人名）
    const namesToClean = new Set<string>();
    (actionItems as any[]).forEach(item => {
      const ownerRaw = String(item.owner || item.assignee || '').trim();
      const proposerRaw = String(item.proposer || '').trim();
      if (ownerRaw) namesToClean.add(ownerRaw);
      if (proposerRaw) namesToClean.add(proposerRaw);
    });
    const nameCleanCache = new Map<string, import('@/lib/name-matcher').MatchedOAUser | null>();
    await Promise.all([...namesToClean].map(async (raw) => {
      // 本身就是精确 OA 姓名的无需清洗（避免误伤同名场景的多余请求）
      nameCleanCache.set(raw, await matchUserFuzzy(raw));
    }));
    (actionItems as any[]).forEach(item => {
      const ownerRaw = String(item.owner || item.assignee || '').trim();
      if (ownerRaw) {
        const m = nameCleanCache.get(ownerRaw);
        if (m) {
          item.owner = m.name;
          item.assignee = m.name;
          if (m.loginid) item.ownerLoginId = m.loginid;
          if (m.oaId) item.ownerOaId = m.oaId;
          if (m.dept) item.dept = m.dept;
        }
      }
      const proposerRaw = String(item.proposer || '').trim();
      if (proposerRaw) {
        const m = nameCleanCache.get(proposerRaw);
        if (m) {
          item.proposer = m.name;
          if (m.loginid) item.proposerLoginId = m.loginid;
          if (m.oaId) item.proposerOaId = m.oaId;
          if (m.dept) item.proposerDept = m.dept;
        }
      }
    });

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
