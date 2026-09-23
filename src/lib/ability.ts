// CASL 能力定义（前后端共用）
// 规则来源：用户"生效权限点"（系统管理员 > 人员级 > 角色矩阵 > 硬编码）。
// 资源条件（ABAC）在此集中表达：本人汇报、未归档主持人改结构等。
import { AbilityBuilder, createMongoAbility, subject } from '@casl/ability';
import type { MongoAbility } from '@casl/ability';

export type AppAction =
  | 'manage' | 'create' | 'read' | 'update' | 'delete' | 'audit' | 'push';

export type AppSubject =
  | 'all' | 'Meeting' | 'ActionItem' | 'Continuous' | 'Batch'
  | 'Org' | 'Role' | 'System' | 'Board' | 'Feedback';

export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/**
 * 权限点 → CASL (action, subject) 映射（增量补全即可，未映射的权限点不影响旧逻辑）
 */
export const PERMISSION_ABILITY: Record<string, [AppAction, AppSubject]> = {
  canCreateMeeting: ['create', 'Meeting'],
  canLockMeeting: ['update', 'Meeting'],
  canUnlockMeeting: ['delete', 'Meeting'],
  canEditActionOwner: ['update', 'ActionItem'],
  canAudit: ['audit', 'ActionItem'],
  canRedelegate: ['update', 'ActionItem'],
  canSettle: ['update', 'ActionItem'],
  canBatchImport: ['create', 'Batch'],
  canPushContinuous: ['push', 'Continuous'],
  canManagePushConfig: ['update', 'System'],
  canManageOrg: ['update', 'Org'],
  canManageFeedback: ['update', 'Feedback'],
  canManageRoles: ['update', 'Role'],
  canViewTracking: ['read', 'ActionItem'],
  canViewAllTasks: ['read', 'ActionItem'],
  canViewContinuous: ['read', 'Continuous'],
  canViewOrg: ['read', 'Org'],
  canViewBoard: ['read', 'Board'],
  canViewWeeklyBoard: ['read', 'Board'],
  canViewMonthlyBoard: ['read', 'Board'],
  canViewProductionBoard: ['read', 'Board'],
};

export interface AbilityUser {
  name: string;
  loginid: string;
}

/**
 * 依据"生效权限点"构建 ability。
 * @param perms 权限点集合（可为 record 或数组）
 * @param isSystemAdmin 系统管理员恒有全部权限
 */
export function defineAbilityFor(
  user: AbilityUser,
  perms: Record<string, boolean> | string[],
  isSystemAdmin = false,
): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility as any);

  if (isSystemAdmin) {
    can('manage', 'all');
    return build();
  }

  const has = (k: string): boolean =>
    Array.isArray(perms) ? perms.includes(k) : perms[k] === true;

  for (const [key, [action, subj]] of Object.entries(PERMISSION_ABILITY)) {
    if (has(key)) can(action, subj);
  }

  // ── 资源条件（ABAC）──
  // 行动项本人：只能汇报自己名下（字段级仍由接口黑名单约束）
  can('update', 'ActionItem', { owner: user.name } as any);
  // 会议主持人：未归档时可改本会议行动项结构（责任人/描述/日期等）
  can('update', 'ActionItem', {
    'meeting.organizerLoginId': user.loginid,
    'meeting.status': { $ne: 'locked' },
  } as any);

  return build();
}

/** 便捷：构造带类型标记的 subject，用于条件判断 */
export function asSubject(type: AppSubject, obj: object) {
  return subject(type as string, obj as any);
}
