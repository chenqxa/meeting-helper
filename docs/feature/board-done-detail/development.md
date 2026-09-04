# 会议看板「已完成项」详情查看 开发文档

> 版本：v1.0  ·  状态：已实现（2026-09-03）
> 对应需求：`docs/feature/board-done-detail/requirement.md`

## 1. 技术栈与目录

- Next.js App Router / React 19 / TypeScript / Tailwind CSS 4；三块看板为同构的三份独立页面（共用函数级组件，未跨文件抽取）。
- 后端接口 `GET /api/actions` 已返回全部所需字段，**本次无任何接口/后端改动**。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| `src/components/board/action-done-detail-dialog.tsx`（新增） | 共享「已完成项详情」弹窗组件 + 大图预览 + 附件判定逻辑 |
| `src/app/weekly-board/page.tsx` | `BoardItem` 补可选完成字段；`Row` 支持点击；已完成区行传 `onDoneClick`；空态条件放宽（无未完成但有已完成也显示）；挂载弹窗 |
| `src/app/monthly-board/page.tsx` | 同上；`SectionRow` 支持 `emerald`；**新增**「✓ 已完成项」分区（memo `lastMonthDoneItems`，口径=公司月会+数据月内到期，与 `lastMonthItems` 同源） |
| `src/app/production-board/page.tsx` | 同 weekly |
| 后端 / OA / 持续项表 | 无改动 |

## 3. 数据流与字段映射

```
GET /api/actions（已在返回）
  → 各看板 items(BoardItem[])
  → 页面 useMemo 过滤（保留原始对象引用，运行时字段不丢，仅补类型）
  → 已完成集：weekly lastWeekDoneItems / monthly lastMonthDoneItems / production lastMonthDoneItems
  → OverdueNoticeSlide.doneRows → Row onClick(item)
  → ActionDoneDetailDialog(item)
```

弹窗字段映射：

| 弹窗字段 | 来源字段 | 处理 |
|----------|----------|------|
| 责任人/部门/提出人/原节点 | owner/dept/proposer/due_date | 空值占位 |
| 完成于 | completed_at(+completed_by) | 东八区 `formatDateTime`，空则"—" |
| 稽核徽标 | oa_score | 1=V、-1=X、0=0、空=未稽核（仅展示） |
| 完成情况说明 | oa_result → completion_note | `getDisplayOaResult()` 清洗导入元数据后主显，兜底同清洗；都空显示"（无说明）" |
| 附件 | oa_attachments | 仅 `/api/files/*` 白名单可开；图片内嵌+放大+下载；其余打开/下载 |
| 文件名兜底 | evidence_files | 附件为空时只读列出并标注"仅文件名" |
| OA 历史 token | oa_attachments 非 `/api/files` 项 | 计数置灰提示，不做抓取 |

## 4. 交互/样式要点

- 已完成行：整行 `cursor-pointer`，hover `bg-emerald-50/40`，末列显示「查看详情 ›」；打X/未处理行不可点。
- 弹窗挂页面根部（不在 SlideFrame 内，规避等比缩放的 `transform`），`z-[400]`（沉浸层 `z-[200]` 之上）；大图预览 `z-[500]`。
- Esc 关闭弹窗（弹窗仅在客户端点击后渲染，无 SSR/hydration 风险）；点遮罩关闭。
- 空态优化：周/产销/月度三块若"无未完成但存在已完成"，改为展示表格+已完成分区（原先整页空态会吞掉已完成）。

## 5. 已知限制

- 月度看板月度行动项少时已完成分区可能为空，属正常。
- OA 历史 token 附件不可预览（设计如此）；`evidence_files` 纯文件名不可打开。
- 附件 MIME 以扩展名推断图片类型，个别异常命名文件会落入"打开/下载"而非内嵌。

## 6. 验证

- 类型检查：`pnpm exec tsc --noEmit`
- 页面编译：dev 打开 `/weekly-board`、`/monthly-board`、`/production-board`（需登录 admin/manager/secretary）
