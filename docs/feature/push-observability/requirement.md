# 推送可观测性与重试（统一 push_log + 企微自测）需求文档

> 版本：v1.0 · 状态：待开发 · 创建：2026-09-18
> 背景：2026-09-18 用户反馈"9 点推送没收到"、戎双娇 9/17 未收到 9/18 到期提醒；排查发现企微送达结果不落库、失败仍标记已提醒、无重试。

## 1. 背景与问题

| 问题 | 现状 |
|---|---|
| 企微送达不可查 | `pushContinuousByType` 有 `wecomSent/wecomFailed`，但 `recordPushLog` 只写 OA 结果；到期提醒/打X/待办推送**完全不写日志** |
| 失败静默 | `pushWeCom` 姓名未匹配/发送失败只 `failed++`，无记录 |
| 失败仍标记 | `runDueReminder` 无论成功与否都写 `due_reminder_at`（`auto-overdue-processor.ts:134-142`）→ 永久"已提醒"且不再推 |
| 无重试 | 一次失败不重试 |
| 空 baseUrl | `pushWeCom` 直接 return（0 发 0 败），但仍标记 |
| 死配置 | `WECOM_TEST_MODE` / `WECOM_TEST_WHITELIST` 代码未生效，误导排查 |

## 2. 目标

1. 每次推送（待办/到期提醒/打X/持续项）都能查到：谁、通过哪个渠道、成功/失败、失败原因；
2. 发送失败不标记"已提醒"，且**当天重试 1 次**；
3. 提供 admin「企微推送自测」入口，核验 userid 匹配与到达；
4. 移除死配置，避免误判。

## 3. 用户故事

| 角色 | 诉求 |
|---|---|
| 管理员 | 出问题能一键查到"推没推、推给谁、为什么失败"；能对某人发测试卡片核验 |
| 责任人 | 该收到的提醒一定收到；一次没送到会有重试 |

## 4. 功能范围

### 含
- 新建 `hyzs_push_log` 表，四类推送统一写入（含企微 sent/failed 明细）；
- `runDueReminder` 改为"发送成功才标记 `due_reminder_at`"，失败当天重试 1 次；
- 企微发送结果（匹配失败/接口报错/baseUrl 缺失）落日志；
- `pushWeCom` 在 baseUrl 为空时返回明确错误且不标记；
- 新增 admin 接口 `POST /api/push/test`（企微推送自测）；
- 清理 `.env` 死配置 `WECOM_TEST_MODE` / `WECOM_TEST_WHITELIST`（方案 B，走全员）；
- 持续项推送日志补 `wecom_sent` / `wecom_failed`。

### 不含
- 推送内容的模板改版；
- 其它通知渠道（短信/邮件）。

## 5. 数据来源

`hyzs_action_items`（候选）、`hyzs_cadence_config`（持续项节奏）、企微通讯录（userid 解析）、`NEXT_PUBLIC_APP_URL`（落地页）。

## 6. 接口/页面结构

| 接口 | 方法 | 权限 | 说明 |
|---|---|---|---|
| `/api/push/logs` | GET | admin | 查询推送日志（按类型/日期/人） |
| `/api/push/test` | POST | admin | 企微自测：入参 name/taskId，返回匹配 userid 与发送结果 |
| `/api/overdue/auto-x` | POST | admin | 现有，补写日志 |

页面：推送日志页（持续项页或设置页新增 tab）+ 自测按钮。

## 7. 交互需求

- 自测入口展示：输入姓名 → 解析到的 userid → 发送结果（成功/错误码）；
- 日志列表支持按类型、日期、成功/失败筛选。

## 8. 非功能需求

- 写日志失败不得阻断主推送流程；
- 重试有次数上限（每责任人当天 1 次），避免风暴；
- 日志保留策略（如 90 天，可后续加）。

## 9. 验收标准

- [ ] 四类推送后，`hyzs_push_log` 有对应记录（含企微 sent/failed）；
- [ ] 模拟企微发送失败：不写 `due_reminder_at`，当天重试 1 次；
- [ ] 自测入口能对指定人发出卡片并返回 userid 匹配详情；
- [ ] 移除测试白名单后推送走全员，且无死配置误导；
- [ ] 持续项推送日志含企微送达数。
