# 绩效面谈·未达成KPI · ✓ 已完成项详情查看 开发文档

> 版本：v1.0  ·  状态：已实现（2026-09-09）
> 对应需求：`docs/feature/gsmalt-x-completed-detail/requirement.md`
> 上游：`docs/feature/board-done-detail/`（同款弹窗与触发模式）

---

## 1. 技术栈与目录

- Next.js App Router / React 19 / TypeScript / Tailwind CSS 4
- 复用既有组件 `src/components/board/action-done-detail-dialog.tsx`
- 接口：`GET /api/actions` / `GET /api/gsmalt`（均已有，仅暴露新增字段）

## 2. 改动清单

| 文件 | 改动 | 类型 |
|------|------|------|
| `src/app/api/actions/route.ts` | 响应新增 `original_id`（系统行 ↔ OA dt1.id 关联键） | 接口 |
| `src/app/api/gsmalt/route.ts` | 响应新增 `dt1Id`（OA dt1.id） | 接口 |
| `src/app/monthly-board/page.tsx` | `BoardItem` 加 `original_id` / `source_type`；`GsmaltItem` 加 `dt1Id`；新增 `gsmaltItemMap`（`original_id → BoardItem`）+ `handleGsmaltDoneClick`；`GsmaltRow` 支持 `onClick`；`GsmaltXSlide` 接 `onDoneClick` 仅对 ✓ 已完成项生效；挂载复用既有 `ActionDoneDetailDialog` | 页面 |
| `src/components/board/gsmalt-done-detail-dialog.tsx` | **删除**（第一版错误实现，复用 `ActionDoneDetailDialog` 后不再需要） | 移除 |

> 无后端 / 数据库表 / 持续项 / OA 同步逻辑改动。

## 3. 数据流

```
GET /api/gsmalt?month=YYYY-MM          (dt1Id, kpi, dept, owner, audit, jd, ...)
GET /api/actions                       (含 source_type='gsmalt' 的行，带 original_id / completion_note / oa_attachments / ...)
        │
        ▼
monthly-board 父组件
  ├─ gsmalt  ─→ GsmaltXSlide (X/未处理/V 三个分区)
  └─ items   ─→ gsmaltItemMap (Map<original_id, BoardItem>)  // 仅 source_type='gsmalt' 的行
        │
        ▼
GsmaltXSlide ✓ 已完成项 行 onClick(GsmaltItem)
        │
        ▼
handleGsmaltDoneClick(g)
  ├─ matched = gsmaltItemMap.get(g.dt1Id)
  ├─ 若 matched：setDoneDetail({ ...matched, meeting_title: matched.meeting_title || `绩效面谈 · ${lastMonthLabel}` })
  └─ 若未匹配：setDoneDetail(兜底 BoardItem：基本信息从 g 拼出，完成字段全空)
        │
        ▼
<ActionDoneDetailDialog item={doneDetail} ... />  // 与「未完成项通报 ✓ 已完成项」共用同一弹窗
```

## 4. 字段映射（与 `ActionDoneDetailDialog.DoneDetailItem` 对齐）

| 弹窗 | 来源（BoardItem） | 兜底（GsmaltItem） |
|------|-------------------|---------------------|
| `description` | `description` | `g.xdjh \|\| g.kpi \|\| '—'` |
| `owner` / `dept` | `owner` / `dept` | `g.owner` / `g.dept` |
| `due_date` | `due_date` | `g.jd` |
| `proposer` / `meeting_title` | `proposer` / `meeting_title` 或 `绩效面谈 · ${lastMonthLabel}` | `绩效面谈 · ${lastMonthLabel}` |
| `oa_score` / `oa_result` / `completion_note` / `oa_attachments` / `evidence_files` / `completed_at` / `completed_by` | 直接透传 | 全部为空（弹窗渲染「（无说明）」「（无附件）」） |
| `status` | `status` | `'done'` |

## 5. 关键实现点

- `gsmaltItemMap` 用 `useMemo` 缓存 `[items]` 依赖；
- `handleGsmaltDoneClick` 用 `useCallback` 缓存；
- `slides` memo 依赖追加 `handleGsmaltDoneClick`；
- 弹窗**不**新增组件 → 无新状态、无新挂载点：`doneDetail` 复用、`<ActionDoneDetailDialog>` 复用；
- 「✓ 已完成项」以外的分区（打X项、未处理项）继续走 `GsmaltRow` 不传 `onClick` —— 行无 cursor-pointer、末列保持「新节点」/「—」。

## 6. 已知限制

- GSMALT 项未同步进 `hyzs_action_items` 的极少数场景：弹窗显示基本信息，完成字段为空（设计上不阻断 click，不静默吞掉）；
- 当前 `/api/actions` 列表不过滤 `source_type`，gsmalt 同步行量大时不影响本功能（仅在客户端建一次 Map）。

## 7. 验证命令

- 类型检查：`pnpm exec tsc --noEmit`
- 启动 dev：`pnpm dev` → `http://localhost:5000/monthly-board`
- 手工用例见 `test.md`。
