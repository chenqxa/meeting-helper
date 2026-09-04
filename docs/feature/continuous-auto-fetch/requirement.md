# 持续项自动取数 需求方案

> 版本：v0.1（已实现框架，数据源 SQL 待接入）
> 创建：2026-09-03
> 关联：`src/lib/continuous-auto-fetch.ts`、`src/app/api/continuous/auto-fetch/route.ts`、持续项跟进页、`hyzs_action_items.auto_fetch`

## 1. 背景

持续项（如周例会持续项）目前按 `hyzs_cadence_config` 每周固定时间**催责任人人工填报**。其中有部分持续项的实际数据是**从业务报表/库里能自动取到的**（如每周指标类结果），不必再让人每周去填。

用户目标：对这类项做个别标记「自动取数」→ 每周定时自动把"上一周"数据写入本期进展，**不再催人**；老板在周例会看板上看到的就是自动取到的结果。

## 2. 范围

### 纳入
| 项 | 说明 |
|----|------|
| 个别标记 | 持续项跟进页给每条持续项加「自动取数」开关（仅 admin 可改） |
| 定时取数 | 每周一 00:30（北京时间）自动取**上一自然周（周一~周日）**数据 |
| 不催 | 开启自动取数的持续项，从周催 OA/IM/企微候选里剔除 |
| 入账 | 取到数据写入 `hyzs_continuous_progress`（source='自动取数'），各看板按现有"已填报"口径展示，同周期不再催 |
| 手动触发 | `POST /api/continuous/auto-fetch`（admin），SQL 接入后可立即跑/补某一周 |

### 不纳入（本期）
- **数据源 SQL 尚未接入**：取数函数 `fetchAutoContinuousRecords` 当前为占位（返回空、不写数据）。待用户提供报表表结构后，在函数内按"上一自然周窗口"查询映射。
- 取不到数据时的告警/兜底文案（本期仅记日志 + 返回 missing，不写、不催，风险见 9）。
- 自动取数的周期维度仅支持"自然周"；月会/产销会（按 data_month 口径）的自动取数本期不做，`data_month` 恒为空。

## 3. 交互

- 持续项跟进页（列表「稽核」列左侧）新增列「自动取数」：
  - admin：Switch 开/关，点击即 `PUT /api/actions/[id] {auto_fetch:true|false}`；
  - 其他角色：只读徽标（自动 / —）。
- 开启后该项本期不会被 OA/IM/企微周催。

## 4. 数据与口径

| 项 | 口径 |
|----|------|
| 数据窗口 | 上一自然周：周一 00:00 ~ 周日 23:59:59（`resolvePrevNaturalWeek`） |
| 写入 | `upsertContinuousProgress(actionId, cycleDate=上周日, progress=取回文本, source='自动取数', isNone=false)` |
| 周期去重 | `(action_id, cycle_date)` 唯一键：同周重复跑会覆盖同一条 |
| 已填报 | 现有看板"有进度记录=已填"，自动取数写入后即算已填 |
| 不催 | `continuous-push.ts` 候选过滤增加 `!autoFetch`，自动/手动推送都不带自动取数项 |

## 5. 权限

- 开关：仅 admin（PUT 的 `auto_fetch` 进 FORBIDDEN_KEYS，非 admin 走 admin 校验）。
- 手动触发接口：`guardWrite('admin')`。

## 6. 待接入（用户需提供）

1. 自动取数的**报表/数据表来源**（表名/库、字段样例），以及它和 `hyzs_action_items.id`/`description`/`owner` 的关联键。
2. 每条持续项取回内容拼接规则（自然语言或数值，允许多行）。
3. 若个别项数据缺失，是否要（a）保持空（本期默认）/（b）写占位 /（c）例外催一次。

## 7. 决策记录

| # | 决策 | 结论 |
|---|------|------|
| 1 | 范围 | 个别项勾选（非整类） |
| 2 | 取数时机 | 每周一 00:30 北京时间，取上一自然周 |
| 3 | 取到后怎么算 | 视为本期已填，不再催人（用户确认） |
| 4 | 入口 | 持续项跟进页「自动取数」列开关 |
| 5 | 取不到 | 本期：空跑+日志+返回 missing，不催（待 SQL 接入后再评估告警） |
| 6 | 周期维度 | 本期仅自然周；月会/产销会按 data_month 维度后续另做 |

## 8. 验收标准

- [ ] admin 在持续项跟进页可开关某条持续项「自动取数」，开关状态刷新保持。
- [ ] 开启后该项不再出现在 OA/IM/企微持续项催办候选。
- [ ] 手动触发 `/api/continuous/auto-fetch` 返回 {window,candidates,written,missing}。
- [ ] 数据源 SQL 接入后：周一看板能看到自动写入的上周进展，同周人工不再被催。
- [ ] 同周重复触发不产生重复记录（覆盖同一条）。

## 9. 已知风险

- 数据源未接入期间开启标记 = 该项彻底不再催人、也不会写入 → 会出现"既不催也不填"的空档。**上线生产前必须先接入 SQL 或保持标记关闭。**
- 历史无 auto_fetch 值视同关闭，不影响存量。

## 10. 2026-09-03 迭代（首个真实源已接入）

- **取数源注册表**：源在代码注册（`src/lib/auto-fetch-sources-meta.ts` 元数据 + `continuous-auto-fetch.ts` 的实现表），已接入首个源 `呆滞出库`：
  - 读**链接服务器** `K3SV / AIS20161019115614`（四段名 `[k3sv].[AIS20161019115614].dbo.*`），与业务库同实例、无需新连接串；库名可用 env `AUTO_FETCH_K3_LINKED` 覆盖。
  - SQL = 用户提供的 `ICStockBill(FTranType=29 且 FUse LIKE '%呆滞%') JOIN ICStockBillEntry LEFT JOIN t_ICItem`，自动加 `FDate between 周一~周日`。
  - 汇总样式 = "本周汇总：共 X 张单 / Y 条明细 + 每单 Top5 明细（物料代码 名称 x数量）+ 超长截断"。
- **绑定持久化**：`hyzs_action_items.auto_fetch_source` 存源 key；开启自动取数即绑定（UI 当前默认绑首个源，开关下显示源名）。一报表→一条持续项。
- **手动补跑/预演**：`POST /api/continuous/auto-fetch` body `{ weekEnd:'周日YYYY-MM-DD', dryRun:true }` → 返回 previews 不写库；去掉 dryRun 即正式写入。
- 真实项试点：ACT_1785487031836_PRD1T（沈旭挺·呆滞物料定期处理）已开启绑定；dry-run 预演通过（窗口 08-31~09-06 命中 QOUT015510 共 10 条明细）。

### 下一步待优化（可选）
- 明细行"单位"目前是内码（如 251），可再 join `t_MeasureUnit` 出单位名；客户/业务员同理可补名称。
- TopN 全局 vs 每单 top5 的口径、超过 N 张单时是否只列金额最大的单据。
