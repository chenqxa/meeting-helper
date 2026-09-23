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

## 6. 2026-09-22 迭代：首个产销会「月度源」+ 16~15 周期

- 背景：产销会持续项的取数窗口是**产销会周期（上月16日~本月15日）**，不是自然月/自然周；原引擎只写自然周且 `data_month` 恒空，产销会看板「本周期已填报」统计不到。
- 引擎（`continuous-auto-fetch.ts`）：
  - `AutoFetchRecord` 增加可选 `cycleDate` / `dataMonth`；`runAutoFetch` 写入时 `cycleDate = rec.cycleDate || win.endLabel`、`dataMonth = rec.dataMonth ?? null`（周例会源行为不变）。
  - 新增 `resolveProdCycle(win)`：按周窗口末日所在月推产销会周期 = 上月16 ~ 本月15，`dataMonth` = 周期起始月。
- 新取数源 `oa-inspection-inbound`（验货订单提前2天入库，产销会）：
  - SQL = OA `formtable_main_25`（验货申请单，按 `sqrq` 落窗）→ ddh2 拆分 → `SEOrder/SEOrderEntry` 取物料 → `ICStockBill(FTranType=2 cp其他入库)` 时间窗匹配 → 每张验货单取离验货日最近一张。
  - 输出 `progress` = "…验货N单，匹配M单，平均提前X.X天，早1-3天M单(P%)（未匹配K单）"；`detail.kind='inspection'` = 每张验货单一行（单号/申请/验货/销售订单/入库单/入库日期/提前情况），未匹配单也列出（提前情况="未匹配"）。
  - 写 `cycleDate=周期末日(15号)`、`dataMonth=周期起始月`，同周期重跑覆盖同一条。
- 调度（`server.ts`）：由"仅周一"改为 **周一 + 每月16日 00:30**（16日刷产销会周期，保证18号开会前数据完整）。
- 明细弹窗（`continuous-detail-dialog.tsx`）：`COLS` 增加 `inspection` 列定义。
- 持续项跟进页（`src/app/continuous/page.tsx`）：admin 的「自动取数」由 Switch 改为**下拉选源**（选项 = 注册表全部源 + 「关闭（不自动取数）」），切换即 PUT `{auto_fetch, auto_fetch_source}`；其余角色仍只读徽标。
- 文案：明细弹窗与三块看板的「本周」字样统一改为「本期」（月度源语义）。
- 验证：node 直连实测 2026-08-16~09-15 窗口通过（验货2单，平均-13.5天，649ms）；`pnpm exec tsc --noEmit` 通过。
- 已知限制：窗口按 `sqrq`（申请日期）落窗；周期末最后几天数据可能滞后（最近一次调度为周期内最后一个周一），16日那次刷新补齐。

## 7. 2026-09-22 迭代：账随物动（第二个真实源，支持按月/按周）

- 引擎：`AutoFetchCandidate` 增 `meetingType`；`runAutoFetch` 加载会议类型（批量 `getMeetings()`，批次项用 sourceText 兜底）。月度源据此区分窗口。
- 新源 `k3-ledger-move`（账随物动）：
  - SQL = K3 检验汇报单 `ICMORpt`（合格=无不合格且合格数>0）→ cp其他入库单（源单=汇报单 `FSourceTranType=551`），dy=入库日-汇报日；
  - 指标：`小于2天`(dy∈[0,2)) 单数与占比、平均天数；明细=逐月趋势 + 本期高亮（`detail.kind='ledger-move'`）；
  - 窗口按会议类型：公司月会=上一自然月（`data_month=该月`、`cycle_date=月末`）；周例会=上一自然周（`data_month=null`、`cycle_date=上周日`）。
- 明细弹窗（`continuous-detail-dialog.tsx`）新增 `LedgerMoveDetail`（kind='ledger-move'）。
- 两条「账随物动」持续项已绑定（`ACT_..._ONG97` / `ACT_..._R6FH3`，均公司月会）；实测 2026-08 = 224单、小于2天71.9%、平均1.6天，与原取数 SQL 一致。
- 已知限制：SQL 为公司全量口径，未按车间拆分；「光电车间账随物动」目前也显示全公司数（如需按车间需补过滤）。

## 8. 2026-09-22 迭代：委外按单领料（第三个真实源）

- 新源 `k3-subcontract-issue`（委外按单领料）：K3 委外订单 `ICSubContract` 是否下推领料单（`FTranType=5`），指标=订单数/有领料/下推率；窗口按会议类型（周例会=上一自然周、月会=上一自然月）；明细=逐月趋势+本期高亮（`detail.kind='subcontract-issue'`）。
- 明细弹窗（`continuous-detail-dialog.tsx`）新增 `SubcontractDetail`。
- 绑定：`ACT_1785487033409_X0YVQ`（周例会来源）。
- 注意：按周口径订单量少时可能为空（如 9/14~9/20 无委外订单），属正常。

## 9. 2026-09-22 迭代：采购来料匹配（第四个真实源）

- 新源 `k3-po-match`（采购来料匹配）：K3 外购入库分录（`FTranType=1`）→ 采购订单 → 投料单(PPBOM) → 任务单(ICMO) → 销售订单 全链路，统计匹配不上销售订单的条数与未匹配率。
- 明细（`detail.kind='po-match'`）：原因分布 + 逐月趋势（本期高亮）+ 未匹配明细（本期 Top300）。
- 窗口按会议类型（公司月会=上一自然月、周例会=上一自然周）；绑定 `ACT_1783687093260_18EMY`（公司月会）。
- 实测 2026-08：956 条 / 未匹配 693（72.5%）；原因以「任务单已删」为主。
- 注意：未匹配率高多为通用件/备件/打样不挂任务单所致，属"暴露问题"用，不代表全部异常。
