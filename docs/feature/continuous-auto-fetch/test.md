# 持续项自动取数 测试文档

> 版本：v0.1  ·  状态：框架自测中（数据源 SQL 未接入）
> 测试形式：手工用例表

## 1. 测试范围与前置

- 环境：本地 dev；需 admin 账号（持续项跟进页、/api/actions、/api/continuous/auto-fetch）。
- 前提：数据库已自动加 `auto_fetch` 列（重启后首次访问生效）。

## 2. 测试用例表

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| AF-01 | 列展示 | 持续项跟进页有数据 | 打开列表 | 稽核列左侧出现「自动取数」列；admin 见 Switch，其他角色见徽标 | P0 |
| AF-02 | 开启标记 | admin | 打开某条持续项的「自动取数」 | 请求 `PUT /api/actions/[id] {auto_fetch:true}` 成功，Switch 置开；刷新仍为开 | P0 |
| AF-03 | 关闭标记 | AF-02 | 再关一次 | 置关并持久化 | P0 |
| AF-04 | 非 admin 拦截 | manager/employee | 尝试调用 PUT 带 auto_fetch | 返回 403/需 admin（FORBIDDEN_KEYS 兜底）；列表不可点开关 | P1 |
| AF-05 | GET 返回标记 | 某条已开启 | `GET /api/actions` 看该条 | 返回 `auto_fetch:1` | P0 |
| AF-06 | 手动触发（空跑） | admin、SQL 未接入 | `POST /api/continuous/auto-fetch` | `success:true`；`written:0`；返回 window/candidates/missing | P0 |
| AF-07 | 手动补某周 | admin | `POST {weekEnd:'2026-08-30'}` | window 对应 2026-08-24~08-30；空跑 written:0 | P1 |
| AF-08 | 候选筛选 | 无开启项 | 触发接口 | `candidates:0` | P1 |
| AF-09 | 不催（逻辑回归） | 开启一条 auto_fetch 且未被填 | 触发一次该会议类型手动 OA 推送 | 候选不含该条（`pushContinuousByType` 过滤 `!autoFetch`） | P1 |
| AF-10 | 写入正确性 | SQL 接入后 | 触发自动取数 | 进度表出现 source='自动取数'、cycleDate=上周日 的记录；周会看板当周显示已填报；同周再次触发只更新不新增 | P0(待SQL) |
| AF-11 | 定时调度 | SQL 接入后 | 等到周一 00:30（北京） | server 日志 `[ContinuousAutoFetch] ... 候选 N 写入 M` | P1(待SQL) |
| AF-12 | dry-run 预演 | 目标项已开启并绑定呆滞出库源 | `POST {weekEnd:'2026-09-06',dryRun:true}` | 返回 previews 含"呆滞出库（其他出库单·呆滞）· 本周汇总…共 1 张单 / 10 条明细 + Top明细"；不写库 | P0(已验证) |
| AF-13 | 真实补写某周 | dryRun 通过后 | 同参去掉 dryRun | 进度表出现 source='自动取数'、cycleDate=2026-09-06；重复跑只覆盖不新增 | P0 |
| AF-14 | 绑定源持久化 | 目标项开启 | `GET /api/actions` 看该条 | 返回 `auto_fetch:1, auto_fetch_source:'k3-scrap-issue'`；持续项页开关下显示源名 | P0(已验证) |

## 3. 回归清单

- 持续项人工填报/周催流程不受影响（未开启标记的项行为不变）。
- 看板已填报口径不变。
- `pnpm exec tsc --noEmit` 通过。
- 手动单推自动取数项被挡（AF-09 预期），如需测试单推请临时去掉标记。

## 4. 缺陷记录模板

| 编号 | 现象 | 复现步骤 | 期望 | 实际 | 定位 | 状态 |
|------|------|----------|------|------|------|------|

## 5. 2026-09-22 迭代：产销会月度源用例

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| AF-15 | 16~15 窗口 | 源已绑定某产销会持续项 | `POST /api/continuous/auto-fetch {weekEnd:'2026-09-20',dryRun:true}` | previews 的 progress 形如"…8/16~9/15 验货N单…" | P0 |
| AF-16 | data_month 写入 | AF-15 去掉 dryRun | 查 `hyzs_continuous_progress` | 该 action 最新记录 `data_month=2026-08`、`cycle_date=2026-09-15`、`source='自动取数'` | P0 |
| AF-17 | 产销会看板已填报 | AF-16 | 打开 `/production-board` 当前周期 | 格子显示自动取数文案+›，点击弹明细表；总览「本周期已填报」+1 | P0 |
| AF-18 | 同周期覆盖 | AF-16 | 同窗口再跑一次 | 只更新同一条（action_id+cycle_date），不新增 | P0 |
| AF-19 | 16日调度 | 生产 | 每月16日 00:30 | server 日志 `[ContinuousAutoFetch] …`，月度源写入完整周期数据 | P1 |

## 6. 2026-09-22 迭代：账随物动源用例

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| AF-20 | 月会按月 | 账随物动项绑定 `k3-ledger-move` | 触发自动取数 | progress="账随物动 · YYYY年M月 N单，小于2天P%（平均X.X天）"；`cycle_date=上月末`、`data_month=上月` | P0 |
| AF-21 | 明细高亮 | AF-20 | 打开明细弹窗 | 逐月趋势表，本期行高亮并标"◀ 本期" | P1 |
| AF-22 | 周例会按周 | 周例会持续项绑定同源 | 触发 | progress 标签为上周日范围（M/D~M/D）；`cycle_date=上周日`、`data_month=null` | P1 |
| AF-23 | 口径一致 | 源 SQL 与直连复算 | 对比 2026-08 | 单数224、小于2天71.9%、平均1.6天 一致 | P1 |

## 7. 2026-09-22 迭代：委外按单领料源用例

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| AF-24 | 周例会按周 | 委外项绑定 `k3-subcontract-issue` | 触发自动取数 | progress="委外按单领料 · M/D~M/D 订单N，有领料M（下推率P%）"；`cycle_date=上周日`、`data_month=null` | P0 |
| AF-25 | 明细高亮 | AF-24 | 打开明细弹窗 | 逐月表（订单数/有领料/无领料/下推率），本期行高亮 | P1 |

## 8. 2026-09-22 迭代：采购来料匹配源用例

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| AF-26 | 月会按月 | 采购来料项绑定 `k3-po-match` | 触发自动取数 | progress="采购来料匹配 · YYYY年M月 外购入库N条，未匹配M条（未匹配率P%）"；`cycle_date=上月末`、`data_month=上月` | P0 |
| AF-27 | 明细完整 | AF-26 | 打开明细弹窗 | 原因分布 + 逐月趋势（本期高亮）+ 未匹配明细 Top300 | P0 |
| AF-28 | 口径一致 | 源 SQL 与直连复算 | 对比 2026-08 | 956 / 693（72.5%）一致 | P1 |
