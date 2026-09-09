# 绩效面谈·未达成KPI · ✓ 已完成项详情查看 需求方案

> 版本：v1.0  ·  状态：已实现（2026-09-09）
> 涉及页面：月度看板 `/monthly-board`「绩效面谈·未达成KPI」页
> 对应需求文档：与「未完成项通报」中的「✓ 已完成项」详情查看能力对齐（见 `docs/feature/board-done-detail/requirement.md`）

---

## 1. 背景

月度看板「绩效面谈·未达成KPI」页内有三块：✕ 打X项 / 未处理项 / ✓ 已完成项（V 达标）。前两块是「问题」展示，老板投屏重点是「未达成」；但「✓ 已完成项」也有意义——能看到本月 GSMALT 上"达标"的指标当时**填报的具体结果**（完成情况说明 / 证明附件）。

现状根因：
- 「✓ 已完成项」行的 `GsmaltRow` 没有任何点击事件（`monthly-board/page.tsx:674`），末列只显示「新节点」占位；
- 行内即便有点击，弹窗也没有：本次第一版曾用 OA 侧字段（kpi/xdjh/cl/hl/yyfx）做自定义弹窗，与"未完成项通报"用的助手填报字段不一致——投屏时老板看到的是 OA 的指标定义，不是责任人当时**填的结果**。

业务对齐：详情应与「未完成项通报 ✓ 已完成项」一致——展示的是「助手填报侧」数据（来源：系统 `hyzs_action_items` 表，`source_type='gsmalt'`），与 OA 主表无关。

## 2. 目标

点击「绩效面谈·未达成KPI → ✓ 已完成项」任一行 → 弹出**任务完成详情**（与「未完成项通报 ✓ 已完成项」共用同一个弹窗 `ActionDoneDetailDialog`），展示：任务基本信息 + 完成情况说明 + 证明附件。

## 3. 用户故事

| 编号 | 角色 | 场景 | 期望 |
|------|------|------|------|
| GX-01 | 老板 / 管理者 | 投屏翻到「绩效面谈·未达成KPI」，想看本月 V 达标项的填报情况 | 点击「✓ 已完成项」任意行 → 弹窗显示责任人填的完成说明、附件 |
| GX-02 | 责任人 | 想确认自己 GSMALT 项是否被采纳完成证据 | 弹窗与自己「我的任务」看到的详情一致（同一份数据） |

## 4. 功能范围

**包含：**
- 「✓ 已完成项」行可点击，hover 提示「查看详情 ▶」（绿色），与「未完成项通报」一致；
- 弹窗复用 `ActionDoneDetailDialog`，不新增组件；
- 数据源：系统内 `hyzs_action_items` 表 `source_type='gsmalt'` 的行，**不**展示 OA 主表的 kpi/xdjh/cl/hl/yyfx 等定义字段；
- OA dt1.id ↔ 系统行通过 `original_id` 关联。

**不含：**
- ✕ 打X项、未处理项不增加点击查看（与「未完成项通报」保持一致——只对「✓ 已完成项」开放）；
- 不修改「✓ 已完成项」统计口径（仍以 OA `audit===0` 为准）；
- 不修改 GSMALT KPI汇总页（`gsmalt-stats`）。

## 5. 数据来源与口径

```
GET /api/gsmalt?month=<上月>          ← OA dt1Id + 稽核 audit
GET /api/actions                       ← 系统内全部行动项（含 source_type='gsmalt' 的同步行，含 completion_note/attachments）
```

匹配：`/api/gsmalt` 行的 `dt1Id` === `/api/actions` 行的 `original_id`（同 `source_type='gsmalt'`）。

弹窗字段映射（与「未完成项通报 ✓ 已完成项」一致）：

| 弹窗字段 | 来源（系统 BoardItem 字段） |
|----------|----------------------------|
| 任务信息 | `description` / `owner` / `dept` / `proposer` / `due_date` / `completed_at` / `completed_by` |
| 稽核徽标 | `oa_score`（V/X/0/未稽核） |
| 完成情况说明 | `oa_result`（经 `getDisplayOaResult` 清洗） → 回退 `completion_note` |
| 证明附件 | `oa_attachments`（仅 `/api/files/` 白名单内嵌图片预览） |
| 登记文件名 | `evidence_files` |
| 副标题 | `meeting_title` 缺省回退 `绩效面谈 · {monthLabel}` |

## 6. 页面与交互

1. 鼠标悬停「✓ 已完成项」行 → 行底色泛绿，末列文字变「查看详情 ▶」绿色（继承「未完成项通报」样式）。
2. 点击 → 弹出 `ActionDoneDetailDialog`。
3. Esc / 点遮罩 / 右上 X / 底部「关闭」→ 关闭弹窗。
4. 未在 `hyzs_action_items` 找到匹配行（极少数 GSMALT 项未同步进系统侧）：弹窗仍打开，但所有完成详情字段为空（不报错），仅显示基本信息。
5. 沉浸（F）/ 自动播放 行为不受影响：弹窗 z-index 400，在 deckRef 内，沉浸下也浮在画面之上（与 `ActionDoneDetailDialog` 既有行为一致）。

## 7. 验收标准

- [ ] 「绩效面谈·未达成KPI」页 ✓ 已完成项 行可点击，hover 高亮+末列「查看详情」
- [ ] 弹窗为 `ActionDoneDetailDialog`，展示完成说明 / 附件
- [ ] 数据源是系统 `hyzs_action_items`（source_type='gsmalt'），不是 OA 主表字段
- [ ] 「未完成项通报 ✓ 已完成项」与「绩效面谈·未达成KPI ✓ 已完成项」共用同一弹窗
- [ ] 未匹配行兜底正常，不报错
- [ ] 翻页、沉浸、自动播放、周期切换不受影响

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| 部分 GSMALT 项暂未同步进系统行 | 兜底弹空详情，不阻断 click |
| `/api/actions` 响应体变大（新增 `original_id` 字段） | 单字段、可忽略 |
| `/api/gsmalt` 响应体变大（新增 `dt1Id` 字段） | 单字段、可忽略 |

## 9. 权限

与「未完成项通报 ✓ 已完成项」一致——看板可看即可点（admin / manager / secretary）。
