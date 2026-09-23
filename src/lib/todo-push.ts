import { getAllActionItems } from '@/storage';
import type { ActionItemRecord, Project } from '@/storage';
import { getProjects } from '@/storage';
import { getEmployees } from '@/storage/database/org-storage';
import { getPool } from '@/storage/database/sqlserver-storage';
import { getAllTaskBatches } from '@/storage';
import { batchSendOAUserMessage } from '@/lib/chat-client';
import { formatActionItemsToTodoList, formatActionItemsToStructuredCard } from '@/lib/action-formatter';
import { searchOAUsers } from '@/lib/weaver-notify';
import { resolveHrmIdsByLoginIds } from '@/lib/oa-task-push';
import { canPushActionItems } from '@/lib/meeting-status';
import { recordPushLog } from '@/storage/database/push-log-storage';

const ACTIVE_STATUSES = new Set<NonNullable<ActionItemRecord['status']>>([
  'pending',
  'confirmed',
  'in_progress',
  'blocked',
  'candidate',
]);

interface RecipientBucket {
  oaUserId: string;
  ownerName: string;
  ownerLoginId: string;
  ownerOaId?: string;
  actionItems: ActionItemRecord[];
}

interface BuildRecipientsOptions {
  projectId?: string;
  meetingId?: string;
  includeStatuses?: string[];
  minActions?: number;
}

interface SendTodosOptions {
  projectId?: string;
  meetingId?: string;
  format?: 'text' | 'card';
  maxItems?: number;
  scheduleLabel?: string;
  idempotencyPrefix?: string;
  includeHeader?: boolean;
  dryRun?: boolean;
}

interface RecipientResult {
  oaUserId: string;
  ownerName: string;
  sent: boolean;
  skipped?: string;
  count: number;
  error?: string;
  idempotentHit?: boolean;
  previewContent?: string;
  previewEx?: string;
}

interface SendTodosResult {
  totalRecipients: number;
  recipientsWithTodos: number;
  sent: number;
  skipped: number;
  failures: number;
  details: RecipientResult[];
}

async function loadProjectsMap(): Promise<Map<string, Project>> {
  try {
    const projects = await getProjects();
    return new Map(projects.map((p) => [p.id, p]));
  } catch (error) {
    console.warn('[TodoPush] 获取项目列表失败:', error);
    return new Map();
  }
}

async function buildRecipientBuckets(options: BuildRecipientsOptions = {}): Promise<RecipientBucket[]> {
  const { projectId, meetingId, includeStatuses, minActions = 1 } = options;

  const employees = await getEmployees();
  const employeeByLogin = new Map<string, typeof employees[number]>();
  const employeeByName = new Map<string, typeof employees[number]>();
  employees.forEach((emp) => {
    if (emp.loginid) employeeByLogin.set(emp.loginid.toLowerCase(), emp);
    employeeByName.set(emp.name.trim(), emp);
  });

  const allItems = await getAllActionItems();

  // 过滤掉未归档会议的行动项
  let items = allItems;
  const meetingIds = [...new Set(allItems.map(i => i.meetingId).filter(Boolean))] as string[];
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
    items = allItems.filter(i => !i.meetingId || !unarchivedIds.has(i.meetingId));
  }

  // 过滤未推送批次的行动项
  try {
    const allBatches = await getAllTaskBatches();
    const unpublishedBatchIds = new Set(allBatches.filter(b => b.status !== 'pushed').map(b => b.id));
    if (unpublishedBatchIds.size > 0) {
      items = items.filter(i => !(i.sourceType === 'batch' && i.sourceId && unpublishedBatchIds.has(i.sourceId)));
    }
  } catch { /* batch table may not exist yet */ }

  const statusFilter = includeStatuses ? new Set(includeStatuses) : ACTIVE_STATUSES;

  const nameResolutionCache = new Map<string, { loginid: string; oaId: string }>();
  const unresolvedNames = [...new Set(
    items
      .filter((item) => {
        if (!item || !item.status || !statusFilter.has(item.status)) return false;
        if (item.reassignedTo) return false; // 已重派原记录不推送
        if (projectId && item.projectId !== projectId) return false;
        if (meetingId && item.meetingId !== meetingId) return false;
        const ownerName = (item.owner || '').trim();
        const ownerLoginId = (item.ownerLoginId || '').trim();
        if (!ownerName || ownerLoginId) return false;
        const emp = employeeByName.get(ownerName);
        return !emp?.loginid;
      })
      .map((item) => (item.owner || '').trim())
      .filter(Boolean)
  )];

  await Promise.all(unresolvedNames.map(async (ownerName) => {
    const matches = await searchOAUsers(ownerName);
    const exact = matches.find((user) => user.lastname === ownerName) || matches[0];
    if (exact?.loginid && exact?.oaId) {
      nameResolutionCache.set(ownerName, {
        loginid: exact.loginid.trim(),
        oaId: String(exact.oaId).trim(),
      });
    }
  }));

  const loginidsToResolve = [...new Set(
    items
      .filter((item) => {
        if (!item || !item.status || !statusFilter.has(item.status)) return false;
        if (projectId && item.projectId !== projectId) return false;
        if (meetingId && item.meetingId !== meetingId) return false;
        return true;
      })
      .map((item) => {
        const ownerName = (item.owner || '').trim();
        const ownerLoginId = (item.ownerLoginId || '').trim();
        const emp = ownerLoginId
          ? employeeByLogin.get(ownerLoginId.toLowerCase())
          : (ownerName ? employeeByName.get(ownerName) : null);
        return ownerLoginId || emp?.loginid || nameResolutionCache.get(ownerName)?.loginid || '';
      })
      .filter(Boolean)
      .map((loginid) => loginid.trim())
  )];
  const liveOaIdByLogin = await resolveHrmIdsByLoginIds(loginidsToResolve);

  const recipients = new Map<string, RecipientBucket>();
  const missingOwners: Record<string, number> = {};

  for (const item of items) {
    if (!item) continue;
    if (!item.status || !statusFilter.has(item.status)) continue;
    // 已重派的原记录（打X后被新记录替代）不再推送给用户，避免重复
    if (item.reassignedTo) continue;
    if (projectId && item.projectId !== projectId) continue;
    if (meetingId && item.meetingId !== meetingId) continue;

    const ownerName = (item.owner || '').trim();
    const ownerLoginId = (item.ownerLoginId || '').trim();

    // 优先匹配 OA 用户
    let emp = ownerLoginId ? employeeByLogin.get(ownerLoginId.toLowerCase()) : null;
    if (!emp && ownerName) {
      emp = employeeByName.get(ownerName);
    }

    const resolvedLoginId = ownerLoginId || emp?.loginid || nameResolutionCache.get(ownerName)?.loginid || '';
    const oaUserId = resolvedLoginId
      ? (liveOaIdByLogin.get(resolvedLoginId.toLowerCase()) || nameResolutionCache.get(ownerName)?.oaId || '')
      : '';

    if (!oaUserId) {
      const missingKey = ownerName || resolvedLoginId || item.id;
      missingOwners[missingKey] = (missingOwners[missingKey] || 0) + 1;
      continue;
    }

    const key = oaUserId.toLowerCase();
    if (!recipients.has(key)) {
      recipients.set(key, {
        oaUserId,
        ownerName: ownerName || emp?.name || oaUserId,
        ownerLoginId: resolvedLoginId || oaUserId,
        ownerOaId: oaUserId,
        actionItems: [],
      });
    }

    recipients.get(key)!.actionItems.push(item);
  }

  const buckets = Array.from(recipients.values()).filter((bucket) => bucket.actionItems.length >= minActions);

  if (Object.keys(missingOwners).length > 0) {
    console.warn('[TodoPush] 无法解析以下责任人对应的OA账号，已跳过:', missingOwners);
  }

  return buckets;
}

function formatMessageContent(
  bucket: RecipientBucket,
  projectsMap: Map<string, Project>,
  format: 'text' | 'card',
  maxItems?: number,
  includeHeader = true
): { content: string; ex?: string } {
  const items = [...bucket.actionItems];

  if (format === 'card') {
    const content = formatActionItemsToStructuredCard(items, {
      maxItems,
      showCompleted: false,
      projectsMap,
    });
    return {
      content,
      ex: JSON.stringify({
        source: 'hyzs',
        businessType: 'todo',
        format: 'card',
        projectCount: new Set(items.map((i) => i.projectId || 'none')).size,
      }),
    };
  }

  const options = {
    showCompleted: false,
    showPriority: true,
    showDueDate: true,
    maxItems,
    groupByStatus: true,
  } as const;

  const projectGroups = new Map<string, ActionItemRecord[]>();
  const projectOrder: string[] = [];
  for (const item of items) {
    const key = item.projectId || 'none';
    if (!projectGroups.has(key)) {
      projectGroups.set(key, []);
      projectOrder.push(key);
    }
    projectGroups.get(key)!.push(item);
  }

  const sections: string[] = [];
  for (const key of projectOrder) {
    const projectItems = projectGroups.get(key)!;
    const projectName = key === 'none'
      ? '未关联项目'
      : projectsMap.get(key)?.name || key;
    const body = formatActionItemsToTodoList(projectItems, options, false).trim();
    if (body) {
      sections.push(`【${projectName}】\n${body}`);
    }
  }

  const head = includeHeader
    ? `📋 待办清单（共 ${items.length} 项）\n${'─'.repeat(20)}`
    : '';
  const content = head ? `${head}\n\n${sections.join('\n\n')}` : sections.join('\n\n');

  return {
    content: content.trim(),
    ex: JSON.stringify({
      source: 'hyzs',
      businessType: 'todo',
      projectCount: projectOrder.length,
      format: 'text',
    }),
  };
}

function buildIdempotencyKey(oaUserId: string, scheduleLabel?: string, prefix?: string) {
  const date = new Date().toISOString().slice(0, 10);
  const label = scheduleLabel ? scheduleLabel.replace(/[^0-9a-zA-Z-_]/g, '-') : 'default';
  const base = prefix ? `${prefix}-${date}` : `${date}`;
  return `todo-${oaUserId}-${base}-${label}`;
}

export async function sendScheduledTodos(options: SendTodosOptions = {}): Promise<SendTodosResult> {
  const {
    projectId,
    meetingId,
    format = 'text',
    maxItems,
    scheduleLabel,
    idempotencyPrefix,
    includeHeader = true,
    dryRun = false,
  } = options;

  const recipients = await buildRecipientBuckets({ projectId, meetingId });
  const projectsMap = await loadProjectsMap();

  const result: SendTodosResult = {
    totalRecipients: recipients.length,
    recipientsWithTodos: recipients.length,
    sent: 0,
    skipped: 0,
    failures: 0,
    details: [],
  };

  for (const bucket of recipients) {
    const { content, ex } = formatMessageContent(bucket, projectsMap, format, maxItems, includeHeader);
    if (!content) {
      result.skipped += 1;
      result.details.push({
        oaUserId: bucket.oaUserId,
        ownerName: bucket.ownerName,
        sent: false,
        skipped: '无有效待办内容',
        count: 0,
      });
      continue;
    }

    const idempotencyKey = buildIdempotencyKey(bucket.oaUserId, scheduleLabel, idempotencyPrefix);

    if (dryRun) {
      result.skipped += 1;
      result.details.push({
        oaUserId: bucket.oaUserId,
        ownerName: bucket.ownerName,
        sent: false,
        skipped: 'dry-run 预览，未实际发送',
        count: bucket.actionItems.length,
        previewContent: content,
        previewEx: ex,
      });
      continue;
    }

    try {
      const response = await batchSendOAUserMessage({
        oaUserIds: [bucket.oaUserId],
        content,
        ex,
        idempotencyKey,
      });

      const failedList = response.data.failedOaUserIds || [];
      const success = failedList.length === 0 && response.data.results.length > 0;
      const idempotentHit = response.data.results.some((r) => r.idempotentHit);

      console.log(`[TodoPush] ${bucket.ownerName}(${bucket.oaUserId}) key=${idempotencyKey} hit=${idempotentHit} results=${JSON.stringify(response.data.results?.map(r => ({ recvID: r.recvID, sendTime: r.sendTime, idempotentHit: r.idempotentHit })))} failed=${JSON.stringify(failedList)}`);

      if (success) {
        result.sent += 1;
        result.details.push({
          oaUserId: bucket.oaUserId,
          ownerName: bucket.ownerName,
          sent: true,
          count: bucket.actionItems.length,
          idempotentHit,
        });
        void recordPushLog({ pushType: 'todo', channel: 'oa', recipient: bucket.ownerName, taskIds: bucket.actionItems.map(i => i.id), success: true });
      } else {
        result.failures += 1;
        const reason = failedList[0]?.reason || '未知错误';
        result.details.push({
          oaUserId: bucket.oaUserId,
          ownerName: bucket.ownerName,
          sent: false,
          count: bucket.actionItems.length,
          error: reason,
        });
        void recordPushLog({ pushType: 'todo', channel: 'oa', recipient: bucket.ownerName, taskIds: bucket.actionItems.map(i => i.id), success: false, error: reason });
      }
    } catch (error) {
      result.failures += 1;
      result.details.push({
        oaUserId: bucket.oaUserId,
        ownerName: bucket.ownerName,
        sent: false,
        count: bucket.actionItems.length,
        error: error instanceof Error ? error.message : '发送异常',
      });
      void recordPushLog({ pushType: 'todo', channel: 'oa', recipient: bucket.ownerName, taskIds: bucket.actionItems.map(i => i.id), success: false, error: error instanceof Error ? error.message : '发送异常' });
    }
  }

  return result;
}
