# 推送可观测性与重试（统一 push_log + 企微自测）开发文档

> 版本：v1.0 · 对应需求：`docs/feature/push-observability/requirement.md`

## 1. 技术方案

- 新建统一日志表 `hyzs_push_log` + 存储模块 `push-log-storage.ts`（运行时 `ensureTable`）。
- 各推送入口在拿到结果后调用 `recordPushLog(...)`，**写日志失败 try/catch 吞掉**，不影响主流程。
- 到期提醒：把"先推送、后无条件标记"改为"按责任人发送结果决定标记 + 失败当天重试 1 次"。
- 企微自测：新增 admin 接口，复用 `resolveUserIdsByNames` + `sendTextCardMessage`，返回匹配详情。

## 2. 目录与改动清单

```
src/storage/database/push-log-storage.ts     新增  hyzs_push_log CRUD
src/lib/auto-overdue-processor.ts            改动  到期提醒/打X 写日志 + 成功才标记 + 重试
src/lib/continuous-push.ts                   改动  企微 sent/failed 写日志
src/lib/todo-push.ts                         改动  待办推送写日志
src/server.ts                                改动  runTodoPush 结果写日志
src/app/api/push/logs/route.ts               新增  GET 推送日志（admin）
src/app/api/push/test/route.ts               新增  POST 企微自测（admin）
.env / .env.example                          改动  移除 WECOM_TEST_MODE / WECOM_TEST_WHITELIST
src/app/settings/*（或持续项页）              改动  推送日志 tab + 自测按钮
docs/feature/push-observability/             新增  三件套
```

## 3. 数据层：`hyzs_push_log`

```sql
CREATE TABLE hyzs_push_log (
  id            NVARCHAR(64)  NOT NULL PRIMARY KEY,
  push_type     NVARCHAR(32)  NOT NULL,   -- todo | due_reminder | auto_x | continuous
  channel       NVARCHAR(16)  NOT NULL,   -- oa | wecom
  meeting_type  NVARCHAR(32)  NULL,       -- 持续项用
  recipient     NVARCHAR(64)  NULL,       -- 姓名/loginid/userid
  task_ids      NVARCHAR(MAX) NULL,       -- JSON 数组
  success       BIT            NOT NULL,
  error         NVARCHAR(500)  NULL,
  created_at    NVARCHAR(30)   NOT NULL
);
CREATE INDEX IX_push_log_created ON hyzs_push_log(created_at);
```

```ts
export interface PushLogInput {
  pushType: 'todo'|'due_reminder'|'auto_x'|'continuous';
  channel: 'oa'|'wecom';
  meetingType?: string;
  recipient?: string;
  taskIds?: string[];
  success: boolean;
  error?: string;
}
export async function recordPushLog(input: PushLogInput): Promise<void>; // 内部 try/catch
export async function getPushLogs(filter): Promise<PushLogRow[]>;
```

## 4. 到期提醒改造（核心）

现状：`runDueReminder` 推送后无条件给所有候选写 `due_reminder_at`。

目标：

```ts
// pushWeCom 返回 { sent, failed, failedRecipients: string[] }（新增失败名单）
const push = await pushWeCom(byOwner, title, body);

// 仅成功送达的责任人才标记
const successOwners = new Set([...byOwner.keys()].filter(k => !push.failedRecipients.includes(k)));
for (const c of candidates) {
  const key = String(c.ownerLoginId || c.owner || '').trim();
  if (successOwners.has(key)) {
    await updateActionItem(c.id, { dueReminderAt: now });
  }
}

// 失败责任人当天重试 1 次（延迟 30 分钟；带 retry=1 标记防重复）
scheduleDueReminderRetry(push.failedRecipients, candidates);
```

- `pushWeCom` 增加逐收件人结果记录，写 `hyzs_push_log`（success/fail + error）。
- `baseUrl` 为空：返回 `{ error: 'NEXT_PUBLIC_APP_URL 未配置' }`，**不标记**，并写失败日志。

## 5. 打X / 待办 / 持续项写日志

- `runAutoOverdueX`：对每个责任人推送结果写 `push_type='auto_x'`。
- `sendScheduledTodos`：在 `server.ts:206-211` 的汇总处按收件人写日志（成功/失败）。
- `pushContinuousByType`：`recordPushLog` 或统一表补 `wecomSent/wecomFailed`，并把 OA/企微分别写 `hyzs_push_log`。

## 6. 企微自测接口

```ts
// POST /api/push/test  body: { name, title?, content? }
const g = await guardPermission('canManagePushConfig'); // admin
if (!g.ok) return g.response;
const map = await resolveUserIdsByNames([name], false);
const userId = map.get(name);
if (!userId) return NextResponse.json({ success:false, error:`未匹配到企微用户: ${name}` });
const r = await sendTextCardMessage([userId], title ?? '会议助手推送自测', content ?? '这是一条测试卡片', baseUrl);
await recordPushLog({ pushType:'todo', channel:'wecom', recipient:name, success:r.success, error:r.error });
return NextResponse.json({ success:r.success, data:{ userId, result:r } });
```

## 7. 配置清理

- `.env` / `.env.example` 删除 `WECOM_TEST_MODE`、`WECOM_TEST_WHITELIST`；
- `wecom-message.ts` 的 `testMode` 形参保留（默认 false），但不再有配置来源；或彻底移除该分支（择一，建议保留形参避免大改）。

## 8. 已知限制

- 重试为进程内定时（服务重启会丢）；如需强保证需落"待重试队列"表（二期）；
- 日志无自动清理（保留策略待定）。

## 9. 验证命令

```bash
pnpm ts-check
pnpm exec eslint src/lib/auto-overdue-processor.ts src/lib/continuous-push.ts
# 手工：preview 接口 + 自测接口
curl -X POST /api/overdue/auto-x -d '{"action":"reminder-preview"}'
curl -X POST /api/push/test -d '{"name":"戎双娇"}'
```

## 10. 工期评估

| 项 | 工时 |
|---|---|
| `hyzs_push_log` + 四类写日志 | 0.5 天 |
| 到期提醒"成功才标记 + 重试" | 0.5~1 天 |
| 企微自测接口 + 前端入口 | 0.5 天 |
| 清死配置 + 回归 | 0.25 天 |
| **合计** | **约 1.5~2 天** |
