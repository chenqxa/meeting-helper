# 开发文档：持续项推送历史与时间修复

> 关联代码：`src/server.ts`、`src/lib/continuous-push.ts`、`src/lib/beijing-time.ts`、`src/storage/database/continuous-push-log-storage.ts`、`src/app/api/continuous/push-history/route.ts`、`src/app/api/continuous/push/route.ts`、`src/app/settings/page.tsx`

## 技术栈
- Next.js 16 App Router / TypeScript / mssql（SQL Server）。
- 无第三方 cron 依赖，调度沿用 `setInterval` 每分钟检查。

## 目录与改动清单

| 文件 | 改动 |
| --- | --- |
| `src/lib/beijing-time.ts` | **新增**。`getBeijingParts(date)`：`date + 8h` 后按 UTC getter 读北京的年/月/日/星期(1-7)/`HH:mm`/`yyyy-MM-dd`。不依赖进程时区。 |
| `src/server.ts` | `scheduleContinuousPush` 改用 `getBeijingParts`：`dayOfWeek/dateOfMonth/hhmm/todayStr`；"今天已推过"按北京日期比较（`getBeijingParts(new Date(lastPushedAt)).dateStr === todayStr`）。 |
| `src/lib/continuous-push.ts` | `pushContinuousByType` 增加第 4 参 `triggerSource: 'auto'|'manual' = 'auto'`；`today` 改用北京日期；推送成功后调用 `recordPushLog`。 |
| `src/storage/database/continuous-push-log-storage.ts` | **新增**。表 `hyzs_continuous_push_log(id, meeting_type, trigger_source, items, pushed, failed, created_at)` + `recordPushLog` / `getPushLogs`（分页、按类型过滤）。 |
| `src/app/api/continuous/push/route.ts` | 手动推送传 `triggerSource='manual'`；推送成功后按 `meetingType` 找到 cadence 配置并 `updateCadenceConfig(id, { lastPushedAt })`。 |
| `src/app/api/continuous/push-history/route.ts` | **新增**。`GET` 查询推送历史，透传 `meeting_type/page/pageSize`。 |
| `src/app/settings/page.tsx` | 新增 `PushLog` 类型、`pushHistory`/`historyLoading` 状态、`loadPushHistory()`；「推送记录」表；手动推送成功后 `loadCadences()+loadPushHistory()`。 |

## 数据流
```
scheduleContinuousPush(每60s) ─┐
                               ├─► pushContinuousByType(type, now, ids?, 'auto'|'manual')
POST /api/continuous/push ─────┘           │
     │(manual 时额外 updateCadenceConfig.lastPushedAt)
     └─► recordPushLog({meetingType, triggerSource, items, pushed, failed})
settings 页 loadPushHistory() ──► GET /api/continuous/push-history ──► getPushLogs()
```

## 关键设计点
- **北京时间计算**：北京 = UTC+8 且无夏令时，用 `getTime()+8h` + UTC getter 即可，比 `Intl.DateTimeFormat` 简洁且无解析开销。
- **lastPushedAt 存储**：仍存 UTC ISO 串，前端 `fmtLocal` 转本地显示，不改显示层。
- **空推送不记录**：`pushContinuousByType` 在 `items.length===0` 提前 return，不写历史、不写操作日志，保持记录干净。
- **记录失败不阻塞主流程**：`recordPushLog` 内部 try/catch，失败仅 warn。

## 已知限制
- 历史从本功能上线后开始记录，之前的推送无回溯数据。
- 部分旧代码仍使用 `now.getDay()/getHours()`（如 OA 拉取 cron），不在本次范围。

## 验证命令
- `pnpm ts-check`
- `pnpm lint`（仅需确认无新增 error；仓库存在大量历史 `no-explicit-any`）
