# 权限模型升级（CASL + 建会/归档/解锁 + 责任人）需求文档

> 版本：v1.0 · 状态：待开发 · 创建：2026-09-18
> 设计依据：Obsidian《2026-09-18-会议助手权限模型设计》

## 1. 背景

现有系统权限为「4 角色 × 18 权限点（`hyzs_role_permissions`）+ 人员级看板覆盖（`hyzs_board_permissions`）+ 系统管理员」。存在 4 个问题：

1. 人员级授权只覆盖看板，无法"给某人单独开建会/导入"；
2. "是不是本人/主持人""会议有没有归档"这类**资源关系**判断散落在各接口，角色矩阵表达不了；
3. `guardWrite` 只有 admin/manager 两档，表达不了精确权限点；
4. `canCreateMeeting` 是死权限（前端入口、后端接口都没校验）；归档/解锁接口**完全没有守卫**。

同时业务确认：**谁都能建会**；**未归档前，会议创建人（主持人）+ admin + manager 可改行动项责任人**；**归档可由创建人执行；解锁仅 admin/manager**。

## 2. 目标

1. 引入 CASL，把权限判断统一为 `ability.can(action, subject, resource?)`，前后端同源；
2. 新增人员级"任意权限点"授权 `hyzs_user_permissions`，优先级：系统管理员 > 人员级 > 角色矩阵 > 硬编码；
3. 落地建会（全员）/ 归档（创建人 + admin/manager/secretary）/ 解锁（admin/manager）；
4. 落地"未归档且主持人/admin/manager 可改责任人"的资源条件；
5. 补齐归档/解锁接口缺失的守卫。

## 3. 用户故事

| 角色 | 诉求 |
|------|------|
| 普通员工 | 能自己发起会议；能汇报自己名下任务；不能改别人任务 |
| 会议主持人（创建人） | 未归档前可改本会议行动项责任人；可归档自己的会议；不能解锁 |
| 部门管理员 manager | 可改责任人；可解锁；可归档 |
| 超级管理员 admin | 全部权限；可编辑权限矩阵 |
| 系统管理员 | 权限恒有；可任命超管 |

## 4. 功能范围

### 含
- 新增 `hyzs_user_permissions` 表（loginid × permission_key × allowed）；
- `hasPermission` 支持人员级覆盖（带缓存，变更即失效）；
- 新增 `src/lib/ability.ts`（CASL `defineAbilityFor`）、`guardAbility` / `guardPermission`；
- 拆分权限点：`canCreateMeeting`（全员）、`canLockMeeting`、`canUnlockMeeting`、`canEditActionOwner`（admin+manager）；
- `POST /api/meetings` 加建会校验；`lock` 路由 POST/DELETE 加归档/解锁校验；
- `PUT /api/actions/[id]` 增加"未归档主持人/admin/manager"条件放行；
- 会议详情页责任人字段只读/可编辑与后端同源；失败回滚。

### 不含
- 部门级数据行权限（manager 仍可见全部，维持现状）；
- `created_by` 独立字段（"谁建的会永久可改"，本期不做，用 organizer）；
- 权限管理页对人员级授权的可视化（本期后端+V1 接口可先不做 UI，二期补）。

## 5. 权限点与默认值

| 权限点 | admin | manager | secretary | employee | 条件 |
|---|---|---|---|---|---|
| canCreateMeeting | ✓ | ✓ | ✓ | **✓** | — |
| canLockMeeting | ✓ | ✓ | ✓ | — | 主持人可归档自己的会（条件） |
| canUnlockMeeting | ✓ | ✓ | — | — | — |
| canEditActionOwner | ✓ | ✓ | — | — | 会议主持人且未归档（条件） |

其余 18 个既有权限点默认值不变。

## 6. 页面/接口结构

| 接口 | 方法 | 权限 |
|---|---|---|
| `/api/meetings` | POST | `canCreateMeeting`（默认全员） |
| `/api/meetings/[id]/lock` | POST（归档） | `canLockMeeting` 或"创建人 + 未归档" |
| `/api/meetings/[id]/lock` | DELETE（解锁） | `canUnlockMeeting`（admin/manager） |
| `/api/actions/[id]` | PUT | 自报分支 / `canEditActionOwner` / 主持人条件 / admin |
| `/api/permissions/mine` | GET | 返回合并后的权限点数组（含人员级） |

页面：侧栏/顶栏「新建会议」按 `canCreateMeeting` 显隐；会议详情「归档/解锁」按钮按权限显隐；行动项「负责」字段按条件可编辑。

## 7. 交互需求

- 责任人编辑保存失败 → 回滚 UI 并提示（消除"闪改"）；
- 未授权用户不显示编辑入口（而非"点了报 403"）；
- 权限变更后 ≤ 10 分钟（缓存 TTL）内生效，管理操作触发的变更即时生效。

## 8. 非功能需求

- 鉴权失败响应 < 50ms（缓存命中路径不额外查库）；
- 人员级权限查询失败时降级为角色矩阵，不阻断业务；
- 越权尝试写 `operation_log`（action=`forbidden`）。

## 9. 验收标准

- [ ] employee 建会成功；`canCreateMeeting=false` 的人建会 403；
- [ ] 主持人（未归档）改本会责任人成功；其他 employee 改 → 403；归档后 → 只读；
- [ ] manager/admin 改责任人成功；解锁成功；employee 解锁 → 403；
- [ ] 创建人可归档自己的会；非创建人且无 `canLockMeeting` → 403；
- [ ] 归档/解锁接口不再无守卫；
- [ ] 现有 18 权限点行为回归无变化（26 个 `guardWrite` 接口）。
