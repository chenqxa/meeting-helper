# 开发文档：行动项企微直连推送与填写闭环

> 版本：v1.0
> 日期：2026-08-26
> 对应需求：`docs/feature/wecom-action-push/requirement.md`

---

## 1. 技术栈

沿用现有栈，无新增依赖：

- Next.js 16 App Router / React 19 / TypeScript 5
- mssql（复用 `getPool`/`getAppPool` 连接池）
- 企微服务端 API（`qyapi.weixin.qq.com`，复用 `getWeComToken`）

## 2. 目录与改动清单（v1.1 实际落地：textcard 方案，apptodo 验证不通过后按用户要求回归应用消息）

```
新增：
src/lib/wecom-action-push.ts                 # 企微行动项推送引擎：分桶 + 快照diff + textcard
scripts/test-wecom-apptodo.ts                # 阶段零验证脚本（apptodo 404，留档）

修改：
src/middleware.ts                            # /mytasks?shared=true 走企微 OAuth 免密（复用 meeting shared 逻辑）
src/app/api/meetings/[id]/lock/route.ts      # 挂载企微行动项推送（3s 熔断，结果进响应 wecomActionPush）
.env / .env.example                          # WECOM_ACTION_PUSH_ENABLED 开关

建表（首次推送时自动建）：
hyzs_wecom_action_push_snapshots(meeting_id, owner_name, payload, pushed_at, UNIQUE(meeting_id, owner_name))
```

**明确不改**：`oa-task-push.ts`、`todo-push.ts`、`chat-client.ts`、`continuous-push.ts`、`mytasks/page.tsx`（填写弹窗已完备，直接复用）、`/api/actions/*`。

**为什么不用 apptodo**：实测 `todo/addtodo`/`todo/donetodo` 对应用 1000043 返回 404（网关层无权限），应用无"应用待办"能力；按用户决策回归与归档通知同款的 textcard 应用消息。

**防刷屏设计（textcard 版）**：
- 快照 diff：同责任人同会议内容 hash 无变化 → 不发
- 每人每次锁定至多 1 条汇总卡片（列出待办+截止日+新增数）
- 行动项全部处理完/移除 → 静默清空快照，不发消息

## 3. 组件结构与数据流

```
lock/route.ts (POST)
   │ …现有 #1/#2/#4 推送原样…
   │
   └─并行(Promise, 3s熔断)─► wecom-todo-sync.syncMeetingToWeCom(meeting, actionItems, version)
                               │
                               ├─ resolveUserIdsByNames()      # 复用 wecom-message.ts
                               ├─ loadSnapshots(meetingId)     # 上次推送快照
                               ├─ diff → {add, del, chg, protect…} # 见需求 3.3
                               ├─ wecom-apptodo.createTodo()   # 增/改（upsert by todo_code）
                               ├─ wecom-apptodo.finishTodo()   # 删/完成
                               ├─ sendTextCardMessage()        # 有实际变更时发一条汇总
                               ├─ saveSnapshots() + 写 push_logs
                               └─ 返回摘要 {added, updated, cancelled, skipped, failed}

/mytasks?from=wecom (OAuth session)
   └─ 提交 POST /api/action-items/[id]/result
        ├─ 校验 session 用户 == item.owner
        ├─ 更新 resultRemark/resultSubmittedAt/By/Source + status
        └─ 异步：finishTodo(该项) + textcard 回执（可配置）
```

## 4. 数据库设计

```sql
-- action_items 增列（ALTER，存量数据不动）
ALTER TABLE hyzs_action_items ADD
  cancelled_at       NVARCHAR(64) NULL,
  result_remark      NVARCHAR(MAX) NULL,
  result_submitted_at NVARCHAR(64) NULL,
  result_submitted_by NVARCHAR(128) NULL,
  result_source      NVARCHAR(16) NULL;  -- wecom / web

-- 推送快照（diff 依据）
CREATE TABLE hyzs_wecom_push_snapshots (
  id            INT IDENTITY PRIMARY KEY,
  meeting_id    NVARCHAR(64)  NOT NULL,
  version       INT           NOT NULL,
  owner_loginid NVARCHAR(128) NOT NULL,
  owner_userid  NVARCHAR(128) NOT NULL,   -- 企微 userid
  payload       NVARCHAR(MAX) NOT NULL,   -- JSON: [{taskId,description,dueDate,priority,…}]
  pushed_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  UNIQUE(meeting_id, version, owner_loginid)
);

-- 推送日志（M4-5 查询用）
CREATE TABLE hyzs_wecom_push_logs (
  id            INT IDENTITY PRIMARY KEY,
  meeting_id    NVARCHAR(64)  NOT NULL,
  version       INT           NOT NULL,
  owner_loginid NVARCHAR(128) NOT NULL,
  todo_code     NVARCHAR(128) NOT NULL,
  action        NVARCHAR(16)  NOT NULL,   -- create/update/finish/card/error
  ok            BIT           NOT NULL,
  error         NVARCHAR(500) NULL,
  created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
```

## 5. 字段映射（action_item → 企微待办）

| 本系统 | 企微 create_todo | 说明 |
|---|---|---|
| `meetingId__itemId`（task_id 同款拼接） | `todo_code` | 唯一键，upsert 依据 |
| `{description}` | `summary` | 截断 20 字内（企微限制） |
| `[会议标题] 截止 {dueDate} · {item_type}` | `description` | 详情区 |
| `dueDate` | `deadline` | Unix 时间戳（当日 23:59:59） |
| `owner → 企微userid` | `creator_userid` 的接收对象 | 见下 |
| 应用 AgentId 1000043 | `agentid` | 与归档通知同一应用 |

> 待办创建者固定为应用（服务端 API 以应用身份建待办），接收人为责任人 userid。

## 6. 扩展机制

- **开关矩阵**：`WECOM_TODO_PUSH_ENABLED`（总）× `WECOM_TEST_MODE`+`WECOM_TEST_WHITELIST`（白名单灰度，沿用现有变量语义）
- **回执开关**：`WECOM_TODO_RECEIPT_ENABLED`（默认 false，防打扰）
- **熔断**：推送引擎整体包 3s 超时，超时记日志放弃，不影响归档响应
- **手动重推**：`POST /api/wecom/todo-push {meetingId, version}`（管理员），复用同一 diff 逻辑天然幂等

## 7. 样式要点

- `/mytasks?from=wecom`：移动端单列布局，卡片式行内编辑（沿用现有行内编辑模式）
- 填写表单：状态用分段按钮（segmented），完成说明 textarea，提交按钮吸底

## 8. 已知限制

- apptodo upsert 语义以阶段零实测为准；若企微侧每次 create 都当新待办，需在阶段一补"先 finish 再 create"策略
- 待办 summary 20 字截断可能丢关键信息，完整内容依赖 description 与填写页
- 企微待办中心入口随企微版本可能改版，展示效果需真机验证

## 9. 验证命令

```powershell
pnpm lint
pnpm build
# 本地（.env.development.local 已指向 localhost:5000）
pnpm dev
# 阶段零接口验证脚本（待办 upsert 语义）
npx tsx scripts/test-wecom-apptodo.ts   # 新增，见阶段零交付
```
