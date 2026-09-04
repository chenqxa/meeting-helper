# 接口权限管控（RBAC 后端鉴权）开发文档

> 版本：v1.0  ·  对应需求：`docs/feature/api-rbac/requirement.md`

## 1. 技术方案

**方案**：路由处理器内显式调用统一守卫函数（而非 middleware 层做角色判断）。

理由：
- middleware 需保持轻量（每请求执行），角色解析涉及 DB/文件读取，放路由层可复用 `resolveRole` 的 10 分钟缓存；
- 同一接口需要**字段级分层**（责任人自助汇报 vs 管理员稽核），middleware 做不了请求体判断；
- 显式守卫在代码 review 时一眼可见，漏加风险低。

## 2. 目录与改动清单

```
src/lib/api-guard.ts                       新增  统一写操作守卫
src/app/api/actions/[id]/route.ts          改动  PUT：分层校验（自助汇报 / admin 稽核）
src/app/api/actions/route.ts               改动  POST：仅 admin
src/app/api/actions/settle/route.ts        改动  POST：仅 admin
src/app/api/actions/batch/route.ts         改动  POST：仅 admin
src/app/api/cadence/route.ts               改动  POST/PUT/DELETE：仅 admin
src/app/api/settings/oa-pull/route.ts      改动  PUT/POST：仅 admin
src/app/api/roles/route.ts                 改动  POST：仅 admin
src/app/api/org/*/route.ts（写操作）        改动  POST：仅 admin
src/app/api/meeting-types/route.ts         改动  POST/PUT/DELETE：仅 admin
src/app/api/feedback/route.ts 及子路由      改动  PATCH/DELETE：仅 admin
src/app/api/continuous/attachment/route.ts 改动  POST：仅 admin
src/app/api/meetings/route.ts 等           改动  POST/PATCH：admin+manager（维持现状口径的补齐）
src/middleware.ts                          改动  PUBLIC 白名单移除 /api/debug/、/api/seed（生产收紧）
docs/feature/api-rbac/                     新增  三件套
```

## 3. 核心组件：`src/lib/api-guard.ts`

```ts
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resolveRole } from '@/lib/roles';
import { logOperation } from '@/lib/operation-log';

export type WriteRole = 'admin' | 'manager';

// ─────────────────────────────────────────────────────────────
// 权限模型说明（重要）：
// 本守卫是「全局角色」校验，不是「行级/部门级」校验——
// guardWrite('manager') 放行的 manager 可以操作【全部】会议/数据，
// 不区分"只限本部门"。未来若需要部门级行管，需在路由内叠加数据过滤，
// 不能只靠本守卫。
// ─────────────────────────────────────────────────────────────

/**
 * 写操作守卫：校验当前登录用户角色 ≥ 要求角色。
 * 用法（路由处理器首行）：
 *   const guard = await guardWrite('admin');
 *   if (!guard.ok) return guard.response;
 */
export async function guardWrite(min: WriteRole) {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false as const, response: NextResponse.json(
      { success: false, error: '未登录', code: 'UNAUTHORIZED' }, { status: 401 }) };
  }
  const role = await resolveRole(user.loginid);           // 带 10 分钟缓存
  const pass = min === 'admin' ? role === 'admin'
             : role === 'admin' || role === 'manager';
  if (!pass) {
    // 越权留痕：记录当时角色，便于排查「为何此人仍有权限」（角色缓存最多滞后10分钟）
    void logOperation({
      action: 'forbidden',
      targetType: 'api',
      summary: `越权尝试：${user.loginid}(role=${role}) 请求需 ${min} 的接口`,
    }).catch(() => {});
    return { ok: false as const, response: NextResponse.json(
      { success: false, error: '无权限执行此操作', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true as const, user };
}
```

要点：
- 角色判定复用 `resolveRole`（roles.json admins + hyzs_user_roles 表 + env，已有实现与缓存）；
- **缓存失效说明**：管理员被从名单移除后，缓存期内（≤10分钟）仍具权限；forbidden/audit 日志均记录 `role=` 值便于事后排查。二期做权限可视化时，必须提供**清缓存入口或版本号自增**（TODO，记入二期）。
- 403 响应统一 `code: 'FORBIDDEN'`，前端现有 alert(err.error) 直接可展示。

## 4. 接入模式（各路由统一）

```ts
export async function POST(request: NextRequest) {
  const guard = await guardWrite('admin');
  if (!guard.ok) return guard.response;
  // ...原有逻辑不动
}
```

## 5. 特殊接口：`PUT /api/actions/[id]` 分层校验

### 5.1 执行顺序（与既有逻辑的关系，重要）

```
1. 查 existing action → 不存在 → 404 提前返回
2. 「转派锁定 403」（原有逻辑）：reassigned_to 非空 && oa_score=-1
   且请求含稽核/状态字段 → 403（锁死项不给自助汇报机会，符合业务语义）
3. 本次分层校验（自助汇报 vs 管理操作）
4. 原有业务逻辑（自动判分、重派、progress 写入……）
```

顺序不可颠倒：锁定判断必须先于分层校验，避免锁定项借"自助汇报"通道解锁。

### 5.2 字段判定：禁止字段黑名单（优于白名单）

白名单方案（`every(k => SELF_REPORT_KEYS.includes(k))`）的缺陷：前端未来传任何辅助字段（如 `_tmpFlag`、`updatedAt`）都会使"纯汇报"被误判为管理操作而 403。**采用黑名单更稳**：

```ts
// 仅管理员可动的字段：出现任意一个 → 走 admin 校验
const FORBIDDEN_KEYS = [
  'oa_score', 'oa_auto_detected',
  'next_due_date',
  'owner', 'ownerLoginId', 'ownerOaId', 'dept',
  'proposer', 'proposerLoginId', 'proposerOaId', 'proposer_dept',
  'description', 'due_date', 'dueDate', 'due_date_type', 'priority',
];
const hasAdminOnlyFields = FORBIDDEN_KEYS.some(k => k in body);
// status 仅允许 in_progress（done/blocked 属管理判定）
const statusOk = body.status === undefined || body.status === 'in_progress';
const isOwner = existing.owner === user.name || existing.ownerLoginId === user.loginid;

const isSelfReport = !hasAdminOnlyFields && statusOk && isOwner;

if (!isSelfReport) {
  const guard = await guardWrite('admin');
  if (!guard.ok) return guard.response;
}
```

自助汇报分支仍走原有 upsertContinuousProgress / autoDetectStatus 逻辑，不受影响。

## 6. middleware 白名单拆分收紧

原 `PUBLIC_PATHS` 混装了"永久公开"与"调试用"两类路径。拆分为：

```ts
// 永久公开：无登录可访问（健康检查/登录本身/分享验证等）
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/',
  '/api/health', '/api/health/',
  '/task-confirm/',
  '/_next/',
  '/favicon',
  '/meeting/share/',
  '/api/meetings/share/',
];

// 调试/种子类：仅非生产环境放行；生产访问 → 落到统一 session 校验 → 401
const DEBUG_PATHS = [
  '/api/admin/cleanup-orphans',
  '/api/seed',
  '/api/debug/',
];

if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();

if (DEBUG_PATHS.some(p => pathname.startsWith(p)) && process.env.NODE_ENV !== 'production') {
  return NextResponse.next();
}
// 生产环境的 DEBUG_PATHS 不放行 → 走下方 session 校验
```

注意：`/api/health` 属永久公开（探活/容器健康检查依赖），**不随 debug 收紧**。

## 7. 权限矩阵速查（开发对照）

| 路由 | 方法 | 最低角色 |
|---|---|---|
| /api/actions | POST | admin |
| /api/actions/[id] | PUT | 分层（见 §5） |
| /api/actions/settle | POST | admin |
| /api/actions/batch | POST | admin |
| /api/cadence | POST/PUT/DELETE | admin |
| /api/settings/oa-pull | PUT/POST | admin |
| /api/roles | POST | admin |
| /api/org/*（写） | POST | admin |
| /api/meeting-types | POST/PUT/DELETE | admin |
| /api/feedback | PATCH/DELETE | admin |
| /api/continuous/attachment | POST | admin |
| /api/continuous/push | POST | admin（现状已限，统一走 guard） |
| /api/meetings 及锁定/推送 | POST/PATCH | manager |
| 其余写接口 | - | 登录即可（现状） |

## 8. 已知限制

- 数据行级权限未增强（manager 可看全部会议数据，维持现状）；
- `hyzs_user_roles` 表的管理界面暂未提供（改名单仍走 roles.json / SQL），二期做可视化；
- GET 接口不加守卫（信息泄露面由 /api/actions 现有过滤兜底）。

## 8.1 完整 RBAC 升级（2026-08-19）

从"固定角色硬编码"升级为"**权限点存库可配置**"：

- 新增 `hyzs_role_permissions` 表（role, permission_key, allowed），seed 默认值 = 原 RoleGuard 口径；
- `hasPermission` 改查库（`role-permission-storage`），表不可用降级硬编码；
- **系统管理员**：`chenqiaoxia` 唯一，`isSystemAdmin()` 判定，权限恒有 + 可编辑权限矩阵；
- `GET/POST /api/permissions/matrix`：GET 返回矩阵+isSystemAdmin；POST 仅 system 可写，写入后 `clearRoleCache()` 立即生效；
- 组织页新增「权限管理」tab（可编辑矩阵，system 可见编辑按钮）；
- 防呆：admin.canManageRoles 不可被关闭（防止锁死）；前端该格显示 Lock。
- 自测：system 编辑/非 system 403/立即生效/防呆 400 全部通过。

## 9. 验证命令

```bash
pnpm ts-check
pnpm exec eslint src/lib/api-guard.ts
# 手工验证（见 test.md 用例表）
```

## 10. 工期评估

| 项 | 工时 |
|---|---|
| api-guard.ts + 接入 18 个接口 | 0.5 天 |
| actions/[id] 分层校验 + 自测 | 0.5 天 |
| middleware 收紧 + 回归（登录/台账/看板/推送/回拉） | 0.5 天 |
| **合计** | **约 1.5 天** |
