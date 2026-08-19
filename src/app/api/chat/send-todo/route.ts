import { NextRequest, NextResponse } from 'next/server';
import { getActionItemsByOwner, getAllTaskBatches } from '@/storage';
import { batchSendOAUserMessage } from '@/lib/chat-client';
import { formatActionItemsToTodoList, formatActionItemsToStructuredCard } from '@/lib/action-formatter';
import { searchOAUsers } from '@/lib/weaver-notify';
import { resolveHrmIdsByLoginIds } from '@/lib/oa-task-push';
import { getPool } from '@/storage/database/sqlserver-storage';
import { canPushActionItems } from '@/lib/meeting-status';

// POST /api/chat/send-todo - 发送某人的行动项待办清单
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      oaUserId,
      owner,
      ownerLoginId,
      ownerOaId,
      format = 'text',
      maxItems = 20,
      dryRun = false,
    } = body;

    if (!owner && !ownerLoginId && !ownerOaId) {
      return NextResponse.json(
        { success: false, error: '缺少 owner、ownerLoginId 或 ownerOaId 参数' },
        { status: 400 }
      );
    }

    // 查询行动项
    let actionItems = await getActionItemsByOwner(owner, ownerLoginId, ownerOaId);

    // 过滤掉未归档会议的行动项（只推送已归档会议的待办）
    if (actionItems.length > 0) {
      const meetingIds = [...new Set(actionItems.map(i => i.meetingId).filter(Boolean))] as string[];
      if (meetingIds.length > 0) {
        const pool = await getPool();
        const idList = meetingIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(',');
        const res = await pool.request().query(
          `SELECT id, status FROM hyzs_meetings WHERE id IN (${idList})`
        );
        // 使用统一的工具函数判断会议是否可以推送行动项
        const unarchivedIds = new Set(
          res.recordset.filter((r: any) => !canPushActionItems(r.status)).map((r: any) => r.id)
        );
        actionItems = actionItems.filter(i => !i.meetingId || !unarchivedIds.has(i.meetingId));
      }

      // 过滤未推送批次的行动项
      try {
        const allBatches = await getAllTaskBatches();
        const unpublishedBatchIds = new Set(allBatches.filter(b => b.status !== 'pushed').map(b => b.id));
        if (unpublishedBatchIds.size > 0) {
          actionItems = actionItems.filter(i => !(i.sourceType === 'batch' && i.sourceId && unpublishedBatchIds.has(i.sourceId)));
        }
      } catch { /* batch table may not exist yet */ }
    }

    if (actionItems.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          message: '该用户暂无待办事项',
          sent: false,
        },
      });
    }

    const resolvedOwnerName =
      (owner || '').trim() ||
      (actionItems.find((item) => (item.owner || '').trim())?.owner || '').trim();
    let resolvedLoginId =
      (ownerLoginId || '').trim() ||
      (actionItems.find((item) => (item.ownerLoginId || '').trim())?.ownerLoginId || '').trim();

    let matchedOaIdFromName = '';
    if (!resolvedLoginId && resolvedOwnerName) {
      const matches = await searchOAUsers(resolvedOwnerName);
      const exact = matches.find((user) => user.lastname === resolvedOwnerName) || matches[0];
      resolvedLoginId = (exact?.loginid || '').trim();
      matchedOaIdFromName = exact?.oaId ? String(exact.oaId).trim() : '';
    }

    const liveOaIdByLogin = resolvedLoginId
      ? await resolveHrmIdsByLoginIds([resolvedLoginId])
      : new Map<string, string>();
    const targetOaUserId =
      (resolvedLoginId ? liveOaIdByLogin.get(resolvedLoginId.toLowerCase()) : '') ||
      matchedOaIdFromName;

    console.log(`[SendTodo] resolvedLoginId=${resolvedLoginId} liveOaIdMap=${JSON.stringify(Object.fromEntries(liveOaIdByLogin))} matchedOaIdFromName=${matchedOaIdFromName} targetOaUserId=${targetOaUserId}`);

    if (!targetOaUserId) {
      return NextResponse.json(
        {
          success: false,
          error: '无法根据责任人的实时 OA 信息解析 hrmresource.id，请先确认 ownerLoginId 或 OA 人员信息正确',
          data: {
            owner: resolvedOwnerName || undefined,
            ownerLoginId: resolvedLoginId || undefined,
            providedOaUserId: (oaUserId || '').trim() || undefined,
            providedOwnerOaId: (ownerOaId || '').trim() || undefined,
          },
        },
        { status: 400 }
      );
    }

    // 格式化待办清单
    let content: string;
    if (format === 'card') {
      content = formatActionItemsToStructuredCard(actionItems, {
        showCompleted: false,
        maxItems,
      });
    } else {
      // 纯文本格式
      content = formatActionItemsToTodoList(actionItems, {
        showCompleted: false,
        showPriority: true,
        showDueDate: true,
        maxItems,
        groupByStatus: true,
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        data: {
          message: '预览生成成功，未实际发送',
          sent: false,
          dryRun: true,
          actionItemCount: actionItems.length,
          oaUserId: targetOaUserId,
          content,
        },
      });
    }

    // 生成幂等键（基于用户ID和日期）
    const idempotencyKey = `todo-${targetOaUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    console.log(`[SendTodo] owner=${resolvedOwnerName} loginId=${resolvedLoginId} oaUserId=${targetOaUserId} items=${actionItems.length} key=${idempotencyKey} contentLen=${content.length}`);

    // 发送消息
    const result = await batchSendOAUserMessage({
      oaUserIds: [targetOaUserId],
      content,
      ex: JSON.stringify({ source: 'hyzs', businessType: 'todo' }),
      idempotencyKey,
    });

    console.log(`[SendTodo] result errCode=${result.errCode} results=${JSON.stringify(result.data.results?.map(r => ({ oaUserId: r.oaUserId, recvID: r.recvID, sendTime: r.sendTime, idempotentHit: r.idempotentHit })))} failed=${JSON.stringify(result.data.failedOaUserIds)}`);

    // 处理发送结果
    const successCount = result.data.results.length;
    const failedCount = result.data.failedOaUserIds.length;

    if (failedCount > 0) {
      return NextResponse.json({
        success: false,
        error: '部分用户发送失败',
        data: {
          successCount,
          failedCount,
          failedUsers: result.data.failedOaUserIds,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        message: '待办清单发送成功',
        sent: true,
        actionItemCount: actionItems.length,
        content,
      },
    });
  } catch (error) {
    console.error('发送待办清单失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '发送失败',
      },
      { status: 500 }
    );
  }
}
