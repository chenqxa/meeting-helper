# 权限模型升级（CASL + 建会/归档/解锁 + 责任人）开发文档

> 版本：v1.0 · 对应需求：`docs/feature/permission-casl/requirement.md`

## 1. 技术方案

- **鉴权库**：CASL（`@casl/ability` 服务端/通用 + `@casl/react` 前端组件）。
- **规则同源**：`src/lib/ability.ts` 导出 `defineAbilityFor(user, perms)`，服务端与前端都 import。
- **权限点来源不变**：仍由 `hyzs_role_permissions` / `hyzs_user_permissions` / `hyzs_system_admins` 计算成 `perms: string[]`，再喂给 `defineAbilityFor`。
- **渐进兼容**：`guardWrite` 保留（内部走 `hasPermission`），新增 `guardPermission(key)` 与 `guardAbility(action, subject, resource?)`；26 个老接口零改动。
- **资源条件**：CASL conditions 表达"主持人且未归档"。涉及跨表关系时先查会议、把关系拍平到 subject。

## 2. 目录与改动清单

```
package.json                                 改动  新增 @casl/ability @casl/react
src/lib/ability.ts                           新增  CASL 规则定义（前后端共用）
src/lib/api-guard.ts                         改动  新增 guardPermission / guardAbility，保留 guardWrite
src/lib/roles.ts                             改动  权限点拆分、PERMISSION_MATRIX 更新
src/storage/database/user-permission-storage.ts 新增  hyzs_user_permissions CRUD + canXxx
src/storage/database/role-permission-storage.ts 改动  SEED 重算（幂等）
src/storage/database/board-permission-storage.ts 改动  canViewBoard 兼容（迁移到 user_permissions）
src/app/api/permissions/mine/route.ts        改动  合并人员级权限
src/app/api/permissions/matrix/route.ts      改动  新权限点展示
src/app/api/meetings/route.ts                改动  POST 加 guardPermission('canCreateMeeting')
src/app/api/meetings/[id]/lock/route.ts      改动  POST/DELETE 加归档/解锁守卫
src/app/api/actions/[id]/route.ts            改动  PUT 增加主持人条件放行
src/components/ability-provider.tsx          新增  前端 ability 注入
src/app/layout.tsx                           改动  包 AbilityProvider
src/app/meeting/[id]/page.tsx                改动  归档/解锁/责任人按钮与只读
src/components/layout/dashboard-layout.tsx   改动  「新建会议」按权限显隐
src/app/page.tsx                             改动  「发起协同会议」按权限显隐
docs/feature/permission-casl/                新增  三件套
```

## 3. 数据层

### 3.1 新表 `hyzs_user_permissions`

```sql
CREATE TABLE hyzs_user_permissions (
  loginid        NVARCHAR(64) NOT NULL,
  permission_key NVARCHAR(64) NOT NULL,
  allowed        BIT NOT NULL DEFAULT 1,
  updated_at     NVARCHAR(30) NOT NULL,
  updated_by     NVARCHAR(64) NULL,
  CONSTRAINT PK_user_permissions PRIMARY KEY (loginid, permission_key)
);
```

- `getUserPermissions(loginid): Record<string, boolean>`
- `setUserPermission(loginid, key, allowed, by)`
- `clearUserPermissions(loginid)`
- 进程内缓存（TTL 10 分钟，与 `roleCache` 一致），变更即清。

### 3.2 决策函数（优先级）

```ts
// src/lib/roles.ts
export async function getEffectivePermissions(loginid): Promise<{
  isSystemAdmin: boolean;
  role: UserRole;
  perms: Record<string, boolean>;
}> {
  if (await isSystemAdmin(loginid)) return { isSystemAdmin: true, role: 'admin', perms: ALL_TRUE };
  const role = await resolveRole(loginid);
  const rolePerms = await getRolePermissions(role);          // 角色矩阵
  const userPerms = await getUserPermissions(loginid);       // 人员级覆盖（可选）
  const merged = { ...rolePerms, ...userPerms };             // 人员级优先
  return { isSystemAdmin: false, role, perms: merged };
}
```

`canViewBoard` 改为读取 `merged` 中的 `canViewWeeklyBoard` 等，保留旧 `hyzs_board_permissions` 兜底（迁移期）。

### 3.3 种子与迁移

- `role-permission-storage.ts` 的 `SEED` 由 `RoleGuard` 重算；新增/拆分权限点用"仅补缺失行"逻辑（现有 `seedRolePermissions` 已实现）。
- `hyzs_board_permissions` → `hyzs_user_permissions` 映射：`weekly→canViewWeeklyBoard`、`monthly→canViewMonthlyBoard`、`production→canViewProductionBoard`。迁移脚本幂等；旧表保留。

## 4. CASL 规则（`src/lib/ability.ts`）

```ts
import { AbilityBuilder, createMongoAbility, MongoAbility, subject } from '@casl/ability';

export type Action  = 'manage'|'create'|'read'|'update'|'delete'|'audit'|'push';
export type Subject = 'Meeting'|'ActionItem'|'Continuous'|'Batch'|'Org'|'Role'|'System'|'Board'|'all';
export type AppAbility = MongoAbility<[Action, Subject]>;

const PERM_MAP: Record<string, [Action, Subject]> = {
  canCreateMeeting:  ['create', 'Meeting'],
  canLockMeeting:    ['update', 'Meeting'],
  canUnlockMeeting:  ['delete', 'Meeting'],
  canEditActionOwner:['update', 'ActionItem'],
  canAudit:          ['audit',  'ActionItem'],
  canBatchImport:    ['create', 'Batch'],
  canPushContinuous: ['push',   'Continuous'],
  // ...其余权限点按需映射
};

export function defineAbilityFor(
  user: { name: string; loginid: string },
  perms: Record<string, boolean> | string[],
  isSystemAdmin = false,
): AppAbility {
  const { can, build } = new AbilityBuilder(createMongoAbility);
  if (isSystemAdmin) { can('manage', 'all'); return build(); }

  const has = (k: string) => Array.isArray(perms) ? perms.includes(k) : perms[k] === true;
  for (const [k, [a, s]] of Object.entries(PERM_MAP)) if (has(k)) can(a, s);

  // 资源条件
  can('update', 'ActionItem', { owner: user.name });              // 本人汇报
  can('update', 'ActionItem', {                                  // 未归档主持人改结构
    'meeting.organizerLoginId': user.loginid,
    'meeting.status': { $ne: 'locked' },
  });
  return build();
}

// 便捷：构建带类型标记的 subject
export const asSubject = (type: Subject, obj: object) => subject(type as string, obj);
```

> 条件字段用拍平关系（`meeting.organizerLoginId` / `meeting.status`），调用前先 `getMeetingById`。

## 5. 守卫（`src/lib/api-guard.ts`）

```ts
export async function guardPermission(key: PermissionKey) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { isSystemAdmin, perms, role } = await getEffectivePermissions(user.loginid);
  const ability = defineAbilityFor(user, perms, isSystemAdmin);
  const [action, subjectType] = PERM_MAP[key] ?? [];
  if (!action || !ability.can(action, subjectType as any)) return forbidden(user, key);
  return { ok: true as const, user, ability };
}

export async function guardAbility(action: Action, subjectType: Subject, resource?: object) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { isSystemAdmin, perms } = await getEffectivePermissions(user.loginid);
  const ability = defineAbilityFor(user, perms, isSystemAdmin);
  const target = resource ? asSubject(subjectType, resource) : subjectType;
  if (!ability.can(action, target as any)) return forbidden(user, `${action}:${subjectType}`);
  return { ok: true as const, user, ability };
}
```

`guardWrite` 保持不变（内部已走 `hasPermission`），老接口不动。

## 6. 接口接入

### 6.1 建会 `POST /api/meetings`

```ts
const g = await guardPermission('canCreateMeeting');
if (!g.ok) return g.response;
```

### 6.2 归档/解锁 `api/meetings/[id]/lock`

```ts
// POST（归档）
const meeting = await getMeetingById(id);
const isOrganizer = meeting.organizerLoginId === user.loginid || meeting.organizer === user.name;
const g = await guardAbility('update', 'Meeting', { ...meeting, isOrganizer });
// canLockMeeting 通过 or 条件通过
if (!g.ok && !isOrganizer) return g.response;

// DELETE（解锁）
const g2 = await guardPermission('canUnlockMeeting');
if (!g2.ok) return g2.response;
```

### 6.3 责任人 `PUT /api/actions/[id]`

在现有 `FORBIDDEN_KEYS` 分层后追加：

```ts
const meeting = existing.meetingId ? await getMeetingById(existing.meetingId) : null;
const actionSubject = { ...existing, meeting: meeting ?? null };
const g = await guardAbility('update', 'ActionItem', actionSubject); // canEditActionOwner 或主持人条件
const canEditStructure = g.ok;
if (!isSelfReportFinal && !canEditStructure) return g.response;
```

> 保留自报分支与转派锁定判断顺序（锁定判断必须在最前）。

## 7. 前端

```tsx
// src/components/ability-provider.tsx（'use client'）
const ability = defineAbilityFor(user, permissions, isSystemAdmin);
<AbilityProvider value={ability}>{children}</AbilityProvider>;

// 按钮
<Can I="create" a="Meeting"><Link href="/?newMeeting=true">新建会议</Link></Can>
```

- ability 在客户端 `useEffect` 后基于 `/api/permissions/mine` 构建，避免 hydration 不一致；
- 责任人只读条件：`isLocked || !(ability.can('update', asSubject('ActionItem', { ...item, meeting })))`。

## 8. 样式要点

沿用现有 shadcn/ui + Tailwind；新增仅为按钮显隐与只读切换，无新视觉规范。

## 9. 已知限制

- 无部门级行权限（manager 可见全部数据）；
- 人员级授权暂无 UI（后端 + 接口先行，二期补设置页）；
- `created_by` 未独立存储，主持人变更会影响判定。

## 10. 验证命令

```bash
pnpm add @casl/ability @casl/react
pnpm ts-check
pnpm exec eslint src/lib/ability.ts src/lib/api-guard.ts
# 手工用例见 test.md
```

## 11. 工期评估

| 项 | 工时 |
|---|---|
| `hyzs_user_permissions` + `getEffectivePermissions` + 缓存 | 1 天 |
| CASL `ability.ts` + guards | 0.5 天 |
| 建会/归档/解锁三处接入 + 前端显隐 | 0.5~1 天 |
| 责任人条件 + 前端只读/回滚 | 0.5~1 天 |
| 回归 | 0.5 天 |
| **合计** | **约 3~4 天** |
