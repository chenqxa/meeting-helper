import { NextRequest, NextResponse } from 'next/server';
import { getMeetings, updateMeeting, getActionItemById, updateActionItem } from '@/storage';
import { verifyCallbackToken } from '@/lib/oa-task-push';
import { autoDetectStatus, isAutoDetectEnabled } from '@/lib/action-status';

// POST /api/oa/callback
// OA 责任人填写结果后回传
// body: { task_id, callback_token, status?, result_remark, operator_loginid, operator_name, attachments? }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { task_id, callback_token, status, result_remark, operator_loginid, operator_name, attachments } = body;

    if (!task_id || !callback_token) {
      return NextResponse.json(
        { success: false, error: '缺少 task_id 或 callback_token' },
        { status: 400 }
      );
    }

    if (!verifyCallbackToken(task_id, callback_token)) {
      console.warn('[OA Callback] token验证失败:', task_id);
      return NextResponse.json({ success: false, error: '无效的回调token' }, { status: 403 });
    }

    const oaStatusMap: Record<string, string> = {
      done: 'done', completed: 'done', finish: 'done', finished: 'done',
      rejected: 'blocked', blocked: 'blocked', cancelled: 'blocked',
    };
    const explicitStatus = oaStatusMap[status || ''] || undefined;
    const { status: mappedStatus, score, autoDetected } = autoDetectStatus(result_remark || '', explicitStatus);
    // 仅当 OA 明确回传了状态、或自动判分开关开启时才写状态/分数；否则只写回传内容（不靠文字猜分）
    const writeStatusScore = !!explicitStatus || isAutoDetectEnabled();
    const now = new Date().toISOString();

    // task_id 格式：meetingId__itemId（新格式）或旧格式 itemId
    // 兼容两种格式：先尝试 meetingId__itemId 解析，再回退全表遍历
    const meetings = await getMeetings();
    let found = false;
    let foundMeetingTitle = '';

    const [maybeMeetingId, maybeItemId] = task_id.includes('__')
      ? task_id.split('__') : [null, task_id];

    // 先尝试从台账表直查（支持批次项和会议项）
    let ledgerItem = null;
    if (maybeItemId) {
      try {
        ledgerItem = await getActionItemById(maybeItemId);
      } catch { /* DB unavailable, fall through to meeting JSON */ }
    }

    if (ledgerItem) {
      const patch: Record<string, any> = {
        oaResult: result_remark || '',
        oaResultAt: now,
        oaAttachments: Array.isArray(attachments) ? attachments : (attachments ? [attachments] : undefined),
        ...(writeStatusScore
          ? { status: mappedStatus as any, oaScore: score, oaAutoDetected: autoDetected }
          : {}),
      };
      if (writeStatusScore && mappedStatus === 'done') {
        patch.completedBy = operator_name || operator_loginid || 'OA';
        patch.completedAt = now;
      }
      if (writeStatusScore && mappedStatus === 'blocked') {
        patch.blockReason = result_remark || '来自OA回传';
      }
      await updateActionItem(ledgerItem.id, patch);
      found = true;
      foundMeetingTitle = ledgerItem.sourceType === 'batch' ? `批次:${ledgerItem.sourceId || ''}` : '';

      // 如果有关联会议，同步会议 JSON
      if (ledgerItem.meetingId) {
        const meetings = await getMeetings();
        for (const meeting of meetings) {
          if (maybeMeetingId && meeting.id !== maybeMeetingId) continue;
          const items: any[] = meeting.actionItems || [];
          const idx = items.findIndex((it: any) =>
            it.id === maybeItemId || it.id === ledgerItem?.originalId
          );
          if (idx === -1) continue;
          items[idx] = {
            ...items[idx],
            oa_result: result_remark || '',
            oa_result_at: now,
            oa_attachments: Array.isArray(attachments) ? attachments : (attachments ? [attachments] : undefined),
            ...(writeStatusScore
              ? {
                  status: mappedStatus,
                  oa_score: score,
                  oa_auto_detected: autoDetected,
                  completed_by: mappedStatus === 'done' ? (operator_name || operator_loginid || 'OA') : items[idx].completed_by,
                  completed_at: mappedStatus === 'done' ? now : items[idx].completed_at,
                  block_reason: mappedStatus === 'blocked' ? (result_remark || '来自OA回传') : items[idx].block_reason,
                }
              : {}),
            completion_note: result_remark || items[idx].completion_note,
          };
          await updateMeeting(meeting.id, { actionItems: items });
          foundMeetingTitle = meeting.title;
          break;
        }
      }
      console.log(`[OA Callback] ${task_id} => ${mappedStatus}(score:${score}) ledger:${ledgerItem.id}`);
    } else {
      // 台账查不到，回退原有逻辑（遍历会议 JSON）
      const meetings = await getMeetings();
      for (const meeting of meetings) {
      if (maybeMeetingId && meeting.id !== maybeMeetingId) continue;

      const items: any[] = meeting.actionItems || [];
      const idx = items.findIndex((it: any) =>
        it.id === maybeItemId ||
        it.id === task_id
      );
      if (idx === -1) continue;

      items[idx] = {
        ...items[idx],
        oa_result: result_remark || '',
        oa_result_at: now,
        oa_attachments: Array.isArray(attachments) ? attachments : (attachments ? [attachments] : undefined),
        ...(writeStatusScore
          ? {
              status: mappedStatus,
              oa_score: score,
              oa_auto_detected: autoDetected,
              completed_by: mappedStatus === 'done' ? (operator_name || operator_loginid || 'OA') : items[idx].completed_by,
              completed_at: mappedStatus === 'done' ? now : items[idx].completed_at,
              block_reason: mappedStatus === 'blocked' ? (result_remark || '来自OA回传') : items[idx].block_reason,
            }
          : {}),
        completion_note: result_remark || items[idx].completion_note,
      };

      await updateMeeting(meeting.id, { actionItems: items });
      foundMeetingTitle = meeting.title;
      found = true;
      console.log(`[OA Callback] ${task_id} => ${mappedStatus}(score:${score}) 自动判断:${autoDetected} 会议:${meeting.title}`);
      break;
    }
    }

    if (!found) {
      console.warn('[OA Callback] 未找到行动项:', task_id);
      return NextResponse.json({ success: false, error: '未找到对应行动项' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: '状态已同步',
      data: { task_id, status: mappedStatus, score, autoDetected, meeting: foundMeetingTitle },
    });
  } catch (error) {
    console.error('[OA Callback] 处理失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务器内部错误' },
      { status: 500 }
    );
  }
}
