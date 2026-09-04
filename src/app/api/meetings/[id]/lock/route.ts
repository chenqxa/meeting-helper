import { NextRequest, NextResponse } from 'next/server';
import { getAllActionItems, getMeetingById, updateMeeting } from '@/storage';
import { pushMeetingTasksToOA, checkOATasksCanUnlock } from '@/lib/oa-task-push';
import { createShareToken } from '@/storage/database/share-token-storage';
import { sendTextCardMessage, resolveUserIdsByNames } from '@/lib/wecom-message';
import { batchSendOAUserMessage } from '@/lib/chat-client';
import { searchOAUsers } from '@/lib/weaver-notify';
import { sendScheduledTodos } from '@/lib/todo-push';
import { syncMeetingActionsToWeCom } from '@/lib/wecom-action-push';
import { logOperation } from '@/lib/operation-log';

async function getMeetingActionItemsForOAPush(meetingId: string, meeting: any) {
  try {
    // 优先使用数据库中的行动项（这是用户修改和删除后的最新数据）
    const dbItems = await getAllActionItems({ meetingId });

    // 如果数据库中有数据，直接使用，不再合并会议JSON中的旧数据
    if (dbItems.length > 0) {
      return dbItems.map(dbItem => ({
        id: dbItem.originalId || dbItem.id,
        description: dbItem.description,
        owner: dbItem.owner,
        assignee: dbItem.owner,
        ownerLoginId: dbItem.ownerLoginId,
        ownerOaId: dbItem.ownerOaId,
        dept: dbItem.dept,
        proposer: dbItem.proposer,
        proposerLoginId: dbItem.proposerLoginId,
        proposerOaId: dbItem.proposerOaId,
        due_date: dbItem.dueDate,
        dueDate: dbItem.dueDate,
        due_date_type: dbItem.dueDateType,
        dueDateType: dbItem.dueDateType,
        priority: dbItem.priority,
        status: dbItem.status,
      }));
    }

    // 如果数据库中没有数据，使用会议JSON中的数据作为兜底
    const legacyItems = Array.isArray(meeting.actionItems) ? meeting.actionItems : [];
    return legacyItems;
  } catch (error) {
    console.warn('[lock] 读取行动项表失败，回退使用会议内 actionItems:', error instanceof Error ? error.message : error);
    // 出错时使用会议JSON中的数据
    return Array.isArray(meeting.actionItems) ? meeting.actionItems : [];
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;

    const meeting = await getMeetingById(meetingId);
    if (!meeting) {
      return NextResponse.json(
        { success: false, error: '会议不存在' },
        { status: 404 }
      );
    }

    const actionItems = await getMeetingActionItemsForOAPush(meetingId, meeting);
    const newVersion = (meeting.version || 1) + 1;

    // 更新会议状态为锁定（不更新actionItems字段，行动项数据在hyzs_action_items表中）
    await updateMeeting(meetingId, {
      status: 'locked',
      version: newVersion,
      locked_version: newVersion,
    });

    await logOperation({
      action: 'meeting_lock',
      targetType: 'meeting',
      targetId: meetingId,
      summary: `锁定归档会议「${meeting.title || meetingId}」（v${newVersion}）`,
      detail: { meetingId, title: meeting.title, version: newVersion },
    });

    console.log(`[lock] 会议 ${meetingId} 已锁定 v${newVersion}`);

    let oaPush: {
      status: 'success' | 'failed' | 'skipped';
      pushed: number;
      failed: number;
      errors: string[];
      message: string;
      summary?: {
        added: number;
        updated: number;
        cancelled: number;
        unchanged: number;
        skippedProcessedUpdates: number;
        preservedProcessedDeletes: number;
      };
      notices?: string[];
    };

    // 每次归档都做 OA 差分同步（pushMeetingTasksToOA 内部自动处理：无变化跳过/已填回传保护/有变更才更新）
    if (actionItems.length > 0) {
      try {
        const result = await pushMeetingTasksToOA({ ...meeting, actionItems }, false);
        console.log(`[lock] OA推送完成 meeting=${meetingId}:`, result);
        const summaryParts = [
          result.summary.added > 0 ? `新增 ${result.summary.added} 条` : '',
          result.summary.updated > 0 ? `更新 ${result.summary.updated} 条` : '',
          result.summary.cancelled > 0 ? `作废 ${result.summary.cancelled} 条` : '',
          result.summary.unchanged > 0 ? `无变化 ${result.summary.unchanged} 条` : '',
          result.summary.skippedProcessedUpdates > 0 ? `已处理未覆盖 ${result.summary.skippedProcessedUpdates} 条` : '',
          result.summary.preservedProcessedDeletes > 0 ? `已处理删除保留 ${result.summary.preservedProcessedDeletes} 条` : '',
        ].filter(Boolean).join('，');
        oaPush = {
          status: result.failed > 0 ? 'failed' : 'success',
          pushed: result.pushed,
          failed: result.failed,
          errors: result.errors,
          summary: result.summary,
          notices: result.notices,
          message: result.failed > 0
            ? `OA同步部分失败：成功 ${result.pushed} 条，失败 ${result.failed} 条${summaryParts ? `；${summaryParts}` : ''}`
            : `OA同步完成${summaryParts ? `：${summaryParts}` : ''}`,
        };

        // 记录/更新 OA 推送时间
        if (oaPush.status !== 'failed') {
          await updateMeeting(meetingId, {
            oaPushedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'OA推送异常';
        console.error('[lock] OA推送失败（不影响锁定）:', e);
        oaPush = {
          status: 'failed',
          pushed: 0,
          failed: actionItems.length,
          errors: [message],
          message: `OA推送失败：${message}`,
        };
      }
    } else {
      oaPush = {
        status: 'skipped',
        pushed: 0,
        failed: 0,
        errors: [],
        message: '当前会议没有可推送的行动项',
      };
    }

    // 从会议数据中获取参会人员和主持人（企业微信与 IM 推送共用）
    const participants = (meeting as any).participants || [];
    const organizer = (meeting as any).organizer;

    // 合并主持人和参会人员（去重）
    const allRecipients = new Set<string>();
    if (organizer && typeof organizer === 'string' && organizer.trim()) {
      allRecipients.add(organizer.trim());
    }
    participants.forEach((p: string) => {
      if (p && typeof p === 'string' && p.trim()) {
        allRecipients.add(p.trim());
      }
    });
    const recipientList = Array.from(allRecipients);

    // 生成直连链接（企业微信 OAuth 免密登录后直达会议页；收件人需在系统有账号）
    let shareUrl: string | null = null;
    const ensureShareUrl = async () => {
      if (shareUrl) return shareUrl;
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || '';
      shareUrl = `${baseUrl}/meeting/${meetingId}?shared=true`;
      return shareUrl;
    };

    // ── IM 推送（自建 OA IM）──
    // 每次锁定都尝试推送，靠 IM 系统的幂等键(meeting-archive-{id})去重，
    // 不依赖企业微信的 wecomPushedAt 标记
    let imPush: {
      status: 'success' | 'failed' | 'skipped';
      sent: number;
      failed: number;
      error?: string;
    } = { status: 'skipped', sent: 0, failed: 0 };

    try {
      if (recipientList.length === 0) {
        imPush = { status: 'skipped', sent: 0, failed: 0, error: '会议无参会人员和主持人' };
      } else {
        const url = await ensureShareUrl();
        const meetingTitle = (meeting as any).title || '会议';
        const meetingDate = (meeting as any).meeting_date || (meeting as any).meetingDate || '';
        const imContent = JSON.stringify({
          noticeType: '1000',
          title: '📋 会议纪要已归档',
          text: `${meetingTitle} · ${meetingDate}`,
          body: `会议纪要已完成归档，点击查看完整内容。`,
          url,
          footer: '查看完整纪要',
        });
        const imEx = JSON.stringify({ source: 'hyzs', businessType: 'meeting-archive', meetingId, title: meetingTitle, date: meetingDate, url });

        // 姓名 → OA 用户 ID（精确匹配优先，与 todo-push 一致）
        const oaIds: string[] = [];
        const unresolvedNames: string[] = [];
        await Promise.all(recipientList.map(async (name) => {
          try {
            const matches = await searchOAUsers(name);
            const exact = matches.find((u) => u.lastname === name) || matches[0];
            const oaId = exact?.oaId ? String(exact.oaId).trim() : '';
            if (oaId) oaIds.push(oaId);
            else unresolvedNames.push(name);
          } catch {
            unresolvedNames.push(name);
          }
        }));

        if (oaIds.length === 0) {
          imPush = { status: 'skipped', sent: 0, failed: 0, error: '未匹配到 IM 用户' };
          console.warn(`[lock] IM 推送：未匹配到任何 OA 用户，姓名: ${recipientList.join(', ')}`);
        } else {
          console.log(`[lock] IM 推送给: ${recipientList.join(', ')} → OA IDs: ${oaIds.join(', ')}`);
          const response = await batchSendOAUserMessage({
            oaUserIds: oaIds,
            content: imContent,
            ex: imEx,
            idempotencyKey: `meeting-archive-${meetingId}-v${newVersion}`,
          });
          const failed = response.data.failedOaUserIds?.length || 0;
          const sent = response.data.results?.length || 0;
          const idempotentHit = response.data.results?.some((r) => r.idempotentHit);
          imPush = {
            status: sent > 0 ? 'success' : 'failed',
            sent,
            failed,
          };
          console.log(`[lock] IM 推送完成: ${sent}/${oaIds.length} 人 (幂等命中=${!!idempotentHit})${unresolvedNames.length ? '，未解析: ' + unresolvedNames.join(', ') : ''}`);
        }
      }
    } catch (e) {
      console.error('[lock] IM 推送异常（不影响归档）:', e);
      imPush = { status: 'failed', sent: 0, failed: 0, error: e instanceof Error ? e.message : '推送异常' };
    }

    // ── 企业微信推送（首次归档时推送，靠 wecomPushedAt 去重）──
    let wecomPush: {
      status: 'success' | 'failed' | 'skipped';
      sent: number;
      failed: number;
      error?: string;
    } = { status: 'skipped', sent: 0, failed: 0 };

    try {
      const alreadyPushed = !!(meeting as any).wecomPushedAt;

      if (alreadyPushed) {
        console.log('[lock] 会议已推送过企业微信，跳过推送');
        wecomPush = {
          status: 'skipped',
          sent: 0,
          failed: 0,
          error: '已推送过，跳过重复推送',
        };
      } else if (recipientList.length === 0) {
        console.log('[lock] 会议无参会人员和主持人，跳过企业微信推送');
        wecomPush = {
          status: 'skipped',
          sent: 0,
          failed: 0,
          error: '会议无参会人员和主持人',
        };
      } else {
        const url = await ensureShareUrl();

        // 解析所有人的企业微信userid
        const nameToUserId = await resolveUserIdsByNames(recipientList, false);
        const userIds = Array.from(nameToUserId.values());

        if (userIds.length > 0) {
          const title = `📋 会议纪要已归档`;
          const meetingTitle = (meeting as any).title || '会议';
          const meetingDate = (meeting as any).meeting_date || (meeting as any).meetingDate || '';
          const description = `${meetingTitle}\n日期：${meetingDate}\n\n点击查看完整会议纪要`;

          const result = await sendTextCardMessage(userIds, title, description, url);

          if (result.success) {
            wecomPush = {
              status: 'success',
              sent: userIds.length - (result.invalidUsers?.length || 0),
              failed: result.invalidUsers?.length || 0,
            };
            console.log(`[lock] 企业微信推送成功: ${wecomPush.sent}/${userIds.length} 人`);

            // 记录推送时间
            await updateMeeting(meetingId, {
              wecomPushedAt: new Date().toISOString(),
            });
          } else {
            wecomPush = {
              status: 'failed',
              sent: 0,
              failed: userIds.length,
              error: result.error,
            };
            console.error('[lock] 企业微信推送失败:', result.error);
          }
        } else {
          wecomPush = {
            status: 'skipped',
            sent: 0,
            failed: 0,
            error: '未匹配到企业微信用户',
          };
          console.warn('[lock] 未匹配到企业微信用户');
        }
      }
    } catch (e) {
      console.error('[lock] 企业微信推送异常（不影响归档）:', e);
      wecomPush = {
        status: 'failed',
        sent: 0,
        failed: 0,
        error: e instanceof Error ? e.message : '推送异常',
      };
    }

    // ── IM 行动项待办推送：归档后给每个责任人发他的待办清单 ──
    let todoPush: { status: 'success' | 'failed' | 'skipped'; sent: number; failures: number; message?: string } = { status: 'skipped', sent: 0, failures: 0 };
    try {
      if (actionItems.length > 0) {
        const todoResult = await sendScheduledTodos({
          meetingId,
          format: 'card',
          scheduleLabel: `归档推送-${meetingId}-v${newVersion}`,
          idempotencyPrefix: `archive-${meetingId}-v${newVersion}`,
          includeHeader: true,
        });
        todoPush = {
          status: todoResult.failures > 0 && todoResult.sent === 0 ? 'failed' : 'success',
          sent: todoResult.sent,
          failures: todoResult.failures,
          message: `待办推送：${todoResult.sent} 人成功${todoResult.failures > 0 ? `，${todoResult.failures} 人失败` : ''}`,
        };
        console.log(`[lock] IM 待办推送完成 meeting=${meetingId}: sent=${todoResult.sent} failures=${todoResult.failures}`);
      }
    } catch (e) {
      console.error('[lock] IM 待办推送异常（不影响归档）:', e);
      todoPush = { status: 'failed', sent: 0, failures: 0, message: e instanceof Error ? e.message : '推送异常' };
    }

    // ── 企微行动项推送（并行新通道：按责任人发汇总卡片，OAuth 直达 mytasks 填写）──
    let wecomActionPush: {
      status: 'success' | 'failed' | 'skipped' | 'timeout';
      sent: number;
      skipped: number;
      failed: number;
      errors: string[];
    } = { status: 'skipped', sent: 0, skipped: 0, failed: 0, errors: [] };

    try {
      if (actionItems.length > 0) {
        const timeout = Promise.resolve({ status: 'timeout' as const, sent: 0, skipped: 0, failed: 0, errors: ['推送后台进行中'] });
        const wait = new Promise<typeof wecomActionPush>(resolve => setTimeout(() => resolve(timeout), 3000));
        wecomActionPush = await Promise.race([
          syncMeetingActionsToWeCom(meeting, actionItems, newVersion),
          wait,
        ]);
      }
    } catch (e) {
      console.error('[lock] 企微行动项推送异常（不影响归档）:', e);
      wecomActionPush = { status: 'failed', sent: 0, skipped: 0, failed: 0, errors: [e instanceof Error ? e.message : '推送异常'] };
    }

    return NextResponse.json({
      success: true,
      message: '版本已锁定',
      data: {
        version: newVersion,
        oaPush,
        wecomPush,
        imPush,
        todoPush,
        wecomActionPush,
      },
    });
  } catch (error) {
    console.error('锁定版本失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '服务器内部错误',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;

    const meeting = await getMeetingById(meetingId);
    if (!meeting) {
      return NextResponse.json(
        { success: false, error: '会议不存在' },
        { status: 404 }
      );
    }

    const actionItems = await getMeetingActionItemsForOAPush(meetingId, meeting);

    // 检查 OA 中是否有已处理的行动项（最多等待 5s，超时则放行）
    const taskIds: string[] = actionItems
      .map((a: any) => a.id ? `${meetingId}__${a.id}` : null)
      .filter(Boolean) as string[];
    if (taskIds.length > 0) {
      const timeout = new Promise<{ canUnlock: true; blockedTasks: [] }>(resolve =>
        setTimeout(() => {
          console.warn('[unlock] OA检查超时（5s），放行解锁');
          resolve({ canUnlock: true, blockedTasks: [] });
        }, 5000)
      );
      const { canUnlock, blockedTasks } = await Promise.race([
        checkOATasksCanUnlock(taskIds),
        timeout,
      ]);
      if (!canUnlock) {
        return NextResponse.json({
          success: false,
          error: `OA中有 ${blockedTasks.length} 条行动项已填写回传内容，解锁会导致数据丢失，请确认后操作`,
          blockedTasks,
        }, { status: 400 });
      }
    }

    // 解锁：只解除编辑锁，不自动清理 OA / 行动项台账
    // 注意：不清除 wecomPushedAt，保持"只推送一次"的逻辑
    await updateMeeting(meetingId, {
      status: 'draft',
      locked_version: undefined,
    });

    await logOperation({
      action: 'meeting_unlock',
      targetType: 'meeting',
      targetId: meetingId,
      summary: `解除归档会议「${meeting.title || meetingId}」`,
      detail: { meetingId, title: meeting.title },
    });

    console.log(`[unlock] 会议 ${meetingId} 已解锁`);

    return NextResponse.json({
      success: true,
      message: '版本已解锁',
      data: {
        cleanup: {
          actionLedgerDeleted: 0,
          oaDeleted: 0,
          skipped: true,
          message: '解锁不会自动删除 OA 数据和行动项台账',
        },
      },
    });
  } catch (error) {
    console.error('解锁失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '服务器内部错误',
      },
      { status: 500 }
    );
  }
}
