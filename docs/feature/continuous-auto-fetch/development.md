# 持续项自动取数 开发文档

> 版本：v0.1  ·  状态：框架已实现，数据源 SQL 待接入
> 对应需求：`docs/feature/continuous-auto-fetch/requirement.md`

## 1. 改动清单

| 文件 | 改动 |
|------|------|
| `src/storage/database/action-storage.ts` | `hyzs_action_items` 自迁移加列 `auto_fetch INT NULL`；`ActionItem` 加 `autoFetch?`；`rowToActionItem` 读出；新增 `updateActionAutoFetch(id, enabled)` 轻量更新并失效列表缓存 |
| `src/app/api/actions/route.ts` | GET 响应补 `auto_fetch: 1/0`（供持续项页/看板读取） |
| `src/app/api/actions/[id]/route.ts` | `auto_fetch` 进 FORBIDDEN_KEYS（仅 admin）；body 含 `auto_fetch` 时走 `updateActionAutoFetch` 并直接返回 |
| `src/app/continuous/page.tsx` | 列表加「自动取数」列：admin Switch / 其他角色徽标；`toggleAutoFetch` 调 PUT |
| `src/lib/continuous-auto-fetch.ts`（新增） | 引擎：窗口计算 + **数据源接入点占位** + `runAutoFetch` 写入进度表 |
| `src/lib/continuous-push.ts` | 候选过滤 `&& !autoFetch`（自动/手动推送都不带自动取数项） |
| `src/app/api/continuous/auto-fetch/route.ts`（新增） | 手动触发（admin），支持 `{ weekEnd }` 补任意周 |
| `src/server.ts` | 新增 `scheduleContinuousAutoFetch()`：每天 00:30 检查，仅北京时间周一执行 |

## 2. 关键实现说明

### 2.1 自动取数引擎（`continuous-auto-fetch.ts`）
- `resolvePrevNaturalWeek(now)`：上一自然周 周一~周日。
- `runAutoFetch(now)`：
  1. `getAllActionItems()` 筛 `dueDateType==='continuous' && autoFetch && status∉{cancelled,done}`
  2. `fetchAutoContinuousRecords(window, candidates)` —— **SQL 接入点**，当前返回 `[]`
  3. 对每个候选若取到 → `upsertContinuousProgress({..., cycleDate: 上周日, source:'自动取数', isNone:false, oaTaskId:'AUTO_<id>_<date>'})`
  4. 返回 `{window, candidates, written, missing}`
- 接入点函数内注释写明待补 SQL 的形态与关联建议；接入前空跑、不写数据。

### 2.2 调度（`server.ts`）
- 每日 `computeNextFire('00:30')` 自我重排；命中时用 `getBeijingParts` 判 `dayOfWeek===1` 才执行，避免跨时区误触发。

### 2.3 "不催"
- `continuous-push.ts` 主过滤与 `itemIds` 过滤均加 `!i.autoFetch`；对自动取数项，手动"按 itemIds 单推"同样被挡（测试需另开临时代码或去掉标记）。

### 2.4 数据库
- 列通过既有 `ensureTable` ALTER 模式自动补（`IF NOT EXISTS ... ADD auto_fetch INT NULL`），无需手工 DDL。
- 老数据 `auto_fetch` 为 NULL → `rowToActionItem` 读出 `false`，等同关闭。

## 3. 验证命令

- `pnpm exec tsc --noEmit`
- dev 重启后：持续项跟进页开关「自动取数」（需 admin），再 `POST /api/continuous/auto-fetch` 看返回（SQL 未接入时 `written:0`）。

## 4. 已知限制

- 周期仅自然周；月会/产销会 data_month 口径自动取数未做（引擎写 `dataMonth:null`）。
- 取数缺失项既不写也不催（需 SQL 接入后按业务再定告警/占位策略）。
- 自动取数写入进度文本为纯文本（含 attachments 可选字段，但写入层暂只存文本）。

## 5. 2026-09-03 迭代：格子简洁化 + 明细表格

- `hyzs_continuous_progress` 加 `detail NVARCHAR(MAX)`（结构化明细 JSON：按单据分组 `{bill,date,status,use,lines:[{itemNo,itemName,qty,unit}]}`）。
- 呆滞出库源写 `progress` = 简短文字（"呆滞出库 · 本周 N 张单"）+ `detail` = 完整单据/物料明细。
- 新增共享弹窗 `src/components/board/continuous-detail-dialog.tsx`：点击格子弹"按单据分组"明细表（单号/日期/状态/用途 + 物料代码/名称/数量/单位）。
- 周例会/月度/产销会看板「本期填报」格子：进度记录带 `detail` 且非空 → 整格变可点按钮（蓝字 + ›），点击弹表；人工填报/无 detail 的记录仍按原文字展示。
- 数据链路：`/api/continuous/progress` 直接透出 `ProgressRecord.detail`（JSON 已 parse），各看板 load 时随记录带入。
