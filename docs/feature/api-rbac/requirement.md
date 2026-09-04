# 接口权限管控（RBAC 后端鉴权）需求文档

> 版本：v1.0  ·  状态：已上线（2026-08-19 自测 19/19 通过）
> 创建：2026-08-19  ·  负责人：admin

## 1. 背景

当前系统的权限控制存在"前端硬、后端软"的结构性风险：

- **前端已按角色控制按钮显隐**（台账稽核 V/X/0 仅 admin 可见，持续项编辑仅 admin 可见）；
- **后端接口大多没有角色校验**：任何登录用户绕过页面直接调 API（curl/Postman），即可修改稽核分、状态、任务内容。
- 实际案例：2026-08-17 曾发生 employee 角色账号（李玉英）通过接口批量修改稽核标记（X→V 5 条）的事件，事后靠操作日志才还原。

正规系统的权限必须是**前后端双层校验**：前端管"看得见"，后端管"做得到"。本需求补齐后端这一层。

## 2. 目标

1. 所有敏感写操作接口加上**后端角色校验**，非授权角色返回 403；
2. 台账（行动项）与持续项的**人为操作**（改 V/X/0、改状态、重派、编辑、删除）**仅超级管理员可执行**；
3. 保留现有登录校验（middleware 401）与操作日志（审计追责）能力；
4. 权限口径集中在一处定义（角色 → 接口），便于后续调整。

## 3. 用户故事

| 角色 | 诉求 |
|------|------|
| 超级管理员 | 正常执行稽核/重派/编辑等全部管理操作，行为有日志留痕 |
| 部门管理员/秘书 | 可以查看台账与持续项，但接口层无法修改稽核与任务数据 |
| 普通员工 | 仅"我的待办"汇报自己名下任务进展；无法篡改他人任务与稽核 |

## 4. 角色与权限矩阵（写操作）

角色优先级：admin > manager > secretary > employee。

### 4.1 仅 admin（超级管理员）

| 接口 | 操作 | 说明 |
|------|------|------|
| `PUT /api/actions/[id]` | 稽核（oa_score）、状态变更、重派、编辑字段 | 台账核心写口 |
| `POST /api/actions` | 新增/重新派发独立任务 | |
| `POST /api/actions/settle` | 超期自动结算 | 现有 canSettle=admin |
| `POST /api/actions/batch` | 批量导入 | |
| `POST/PUT+DELETE /api/cadence` | 推送节奏配置 | |
| `PUT+POST /api/settings/oa-pull` | OA 回拉配置 | |
| `POST+PUT+DELETE /api/roles` | 角色管理 | 管理员名单自身 |
| `POST /api/org/*`（init/pull/sync/sync-db/clear/employees/departments 写操作） | 组织架构维护 | |
| `POST+PUT+DELETE /api/meeting-types` | 会议类型维护 | |
| `PATCH+DELETE /api/feedback/[...]`（处理/删除反馈） | 反馈处置 | |
| `POST /api/continuous/attachment` | 持续项附件/编辑 | |
| `POST /api/admin/cleanup-orphans`、`/api/debug/*` | 清理/调试 | 建议同时收紧 PUBLIC 白名单 |

### 4.2 admin / manager

| 接口 | 操作 | 说明 |
|------|------|------|
| `POST /api/meetings`、会议 PATCH/锁定相关 | 创建/编辑会议、归档推送 | 现有 canCreateMeeting 口径 |
| `POST /api/continuous/push` | 手动推送 | 维持现状（已限 admin/chenqiaoxia） |

### 4.3 登录即可（不做角色限制）

- 汇报自己名下任务：`PUT /api/actions/[id]` 中**仅提交 oa_result/附件**且责任人是本人时放行（见 4.4）
- 转写/ASR/上传/AI 问答等工具接口（有登录态即可）
- 所有 GET 查询接口（数据可见范围维持现有 /api/actions 过滤逻辑）

### 4.4 特例：责任人自助汇报

普通员工在"我的待办"汇报进展（写 oa_result + 附件）是业务必需。规则：

- 当请求**只包含** `oa_result / oa_result_at / oa_attachments / status(in_progress)` 且 `owner === 当前用户` → 放行；
- 一旦涉及 `oa_score / next_due_date / owner 变更 / 删除` → 必须 admin。
- 后端在 `PUT /api/actions/[id]` 内部实现该分支判断（一个接口内分层校验）。

## 5. 功能范围

### 含
- 新增统一鉴权工具 `guardWrite()`，各敏感接口接入；
- 403 响应统一格式：`{ success: false, error: '无权限', code: 'FORBIDDEN' }`；
- 越权尝试写入操作日志（action='forbidden'）；
- 收紧 middleware PUBLIC 白名单中的 debug/seed 路径（生产隐患）；
- **（二期已提前实现）基础设置 → 权限管理页**：用户角色分配（增删改+搜索添加）、权限矩阵展示（单一数据源 roles.ts）、角色变更立即生效（清缓存）；
- **hasPermission 扩展点**：guardWrite 内部改走权限点判定，为升级完整 RBAC（DB 权限表）预留平滑迁移路径。

### 不含
- 前端按钮显隐改造（已符合目标口径，不动）；
- 数据行级权限增强（维持 /api/actions 现状）；
- 权限管理可视化界面（二期）。

## 6. 数据来源

- 角色：`resolveRole(loginid)`（roles.json admins 名单 + hyzs_user_roles 表 + 环境变量，已有 10 分钟进程内缓存）；
- 会话：`getCurrentUser()`（meeting_session cookie，middleware 已校验有效性）。

## 7. 入口与权限

- 不新增页面；改动全部在 API 层；
- 现有前端无需变更（按钮本就按 admin 控制）。

## 8. 非功能需求

- 鉴权失败响应 < 50ms（角色缓存命中路径不查库）；
- 不影响 OA 回拉等**服务端内部调用**（它们不经过 HTTP API，走存储层直写，不受影响）。

## 9. 验收标准

- [ ] employee/secretary/manager 账号直接调 4.1 表中任一接口 → 403，且不产生数据变更；
- [ ] admin 账号调上述接口 → 行为与改造前一致；
- [ ] 普通员工在"我的待办"汇报进展（仅 oa_result/附件）→ 正常成功；
- [ ] 同一账号伪造修改 oa_score → 403 + forblidden 日志留痕；
- [ ] 现有功能回归：登录、台账查看、看板、推送、OA 回拉均正常。
