import { getCurrentUser } from '@/lib/session';
import { createOperationLog } from '@/storage/database/operation-log-storage';

export interface LogOperationInput {
  action: string;                    // audit / status_change / reassign / delete / create / import / batch_push / meeting_create / meeting_update / meeting_lock / meeting_unlock / meeting_delete / export / oa_sync
  targetType?: string;               // action_item / batch / meeting / import / system
  targetId?: string;
  summary?: string;
  detail?: { before?: unknown; after?: unknown; changes?: unknown; count?: number; [k: string]: unknown };
}

/**
 * 记录操作日志（异步 fire-and-forget，失败不影响主流程）
 * 仅服务端调用；在前端展示用读取接口 /api/operations
 */
export async function logOperation(input: LogOperationInput): Promise<void> {
  try {
    const user = await getCurrentUser();
    await createOperationLog({
      operatorLoginId: user?.loginid || null,
      operatorName: user?.name || '未知',
      action: input.action,
      targetType: input.targetType || null,
      targetId: input.targetId || null,
      summary: input.summary || null,
      detail: input.detail ? JSON.stringify(input.detail) : null,
    });
  } catch (e) {
    console.warn('[oplog] 写入失败（不影响主流程）:', e instanceof Error ? e.message : e);
  }
}
