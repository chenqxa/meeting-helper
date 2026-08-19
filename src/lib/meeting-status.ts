/**
 * 会议状态工具函数
 * 统一管理会议状态判断逻辑
 */

/**
 * 判断会议是否已归档
 * 归档状态包括：locked（已锁定）和 exported（已导出）
 *
 * @param status 会议状态
 * @returns 是否已归档
 */
export function isMeetingArchived(status: string | null | undefined): boolean {
  if (!status) return false;
  // 只有 locked 和 exported 状态才算归档
  return status === 'locked' || status === 'exported';
}

/**
 * 判断会议是否可以推送行动项到个人待办
 *
 * @param status 会议状态
 * @returns 是否可以推送
 */
export function canPushActionItems(status: string | null | undefined): boolean {
  // 只有归档后的会议才能推送行动项
  return isMeetingArchived(status);
}

/**
 * 判断会议是否处于草稿状态
 * 草稿状态包括：draft（草稿）和 review（审核中）
 *
 * @param status 会议状态
 * @returns 是否为草稿
 */
export function isMeetingDraft(status: string | null | undefined): boolean {
  if (!status) return true;
  return status === 'draft' || status === 'review';
}
