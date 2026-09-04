# 会议编辑稳定性与归档数据一致性修复 开发文档

> 版本：v1.0  ·  状态：已实施
> 需求文档：`requirement.md`
> 改动日期：2026-08-28

---

## 一、技术栈

Next.js 16 App Router + React 19 + TypeScript 5；存储：会议 JSON（存储层 `hyzs_meetings` 内容字段）+ SQL Server 台账表 `hyzs_action_items`。

## 二、改动清单

| 文件 | 改动 | 对应修复 |
|------|------|---------|
| `src/app/api/meetings/[id]/route.ts` | ① `syncActionItemsToDatabase` 删除分支改为软取消且默认不启用（`opts.allowRemove`）；② GET 合并改「台账 ∪ JSON」并集；③ `addActionItem` 重写：先台账后 JSON、`originalId` 用客户端临时 id、幂等查重、status 透传、新增 `createdAction` 单条返回；④ `minutes` PATCH 派生重写：描述优先→id 精确匹配（去掉序号兜底）、`isManuallyTouched` 判定、手动项保留、纯派生零编辑项软取消、`PRESERVE` 白名单扩充；⑤ 新增 `base_updated_at` 乐观锁（409） | 修复2/3 |
| `src/app/api/actions/[id]/route.ts` | ① PUT 增加 JSON-only 项惰性回填（首次编辑时补建台账行）；② DELETE 支持 JSON-only 项（仅移除 JSON，不再 404） | 修复3 |
| `src/app/meeting/[id]/page.tsx` | ① `nextTempActionId()` 临时 id 防撞；② `saveEdit`/`patchAction` 新增项改为单行回填 `dbId/originalId`（id 不变、不整表替换），失败弹提示不静默；③ `MeetingMinutesBlock` 外部重置加 `dirty` 守卫 + 他人归档时退出 Markdown 编辑；④ `InlineEdit` 聚焦中跳过 DOM 覆写；⑤ `upd()` 改路径级浅拷贝（去整树深克隆）；⑥ 新增 `saveMinutesToServer`（409 冲突 confirm 后可强制覆盖），纪要 Tab onSave 与摘要 Tab 行内保存统一走它 | 修复1/4 |

无表结构变更、无新增依赖。

## 三、关键设计

### 3.1 行动项标识链路（修复1/3 核心）

```
前端临时 id new-xxx ──PATCH addActionItem(id: new-xxx)──▶ 台账行 originalId=new-xxx
   ▲                                                        │
   └──── createdAction.id(dbId) 只回填该行的 dbId 字段 ◀──────┘
   行的 React key = item.id（临时 id），会话期内永不变化 → 不重挂载
重载页面后 id 变为 dbId（GET mergeItem + mapActionItems 口径）
PUT/DELETE 兼容三种 id：dbId 直查 → originalId 回退 → JSON-only 回填/移除
```

### 3.2 minutes PATCH 派生与保留算法（修复2 核心）

```
existing = 会议 JSON actionItems ∪ 台账行（originalId 去重）
fresh    = deriveActionItems(minutes.actionTable)   // id 固定 action-N

对每个 fresh:
  match = 描述前30字匹配（未消费的 existing）→ 无则 id 精确匹配
  // 不做序号兜底：会把手动项错配给表格行（本次实现中实际踩过并修复）
  merged = fresh + PRESERVE(手动字段) + 表格空值时保留现值
  merged.id = match.id   // id 稳定

未匹配的 existing:
  isManuallyTouched(有负责人/提出人/日期/非默认优先级/状态流转/OA回传) → 保留
  且 id 为 action-N（纯派生）→ 软取消台账行（status=cancelled 留痕）
```

`PRESERVE` 白名单：`due_date_type/dueDateType, status, ownerLoginId, ownerOaId, dept, proposer*, proposerDept, priority, oa_*, confirmed_*, completed_*, completion_note, evidence_files, block_*`。日期/负责人/描述遵循「表格有值以表格为准，表格空保留现值」。

### 3.3 双写一致性（修复3）

- 写入顺序：台账（主源）→ 会议 JSON；JSON 失败仅 `console.warn` 不判失败。
- 幂等：`getActionItemByMeetingAndOriginalId(meetingId, originalId)` 命中直接返回既有行，重试/双击不产生重复。
- GET 并集：台账为主（存储层默认过滤 `cancelled`，软删除项不会复活），JSON 独有项补入，日志 `[GET merge]` 标记数量。

### 3.4 乐观锁（修复4）

PATCH 携带 `base_updated_at`（前端取 `meeting.updatedAt ?? meeting.updated_at`）与服务端不一致 → `409 {conflict:true}`；前端 `confirm` 后去掉该字段强制重试覆盖。

## 四、已知限制

- 历史**已物理删除**的行动项无法恢复（并集仅能救回 JSON 残留项）。
- 纪要表格删行只联动删除「纯派生且零手动编辑」的项；其余需在行动项 Tab 手动删（行为变化，已在需求文档声明）。
- 极小窗口内同 id 并发两次 addActionItem（首写未落库时）仍可能双写；人为操作节奏下概率可忽略。
- PUT 惰性回填发生在鉴权检查之前（与 meeting PATCH 无 per-item 鉴权保持一致口径）。

## 五、验证命令

```bash
pnpm ts-check                 # 类型检查（通过）
npx eslint src/app/api/meetings/[id]/route.ts src/app/api/actions/[id]/route.ts "src/app/meeting/[id]/page.tsx"
node %TEMP%\opencode\smoke-meeting-fix.mjs   # 18 项冒烟全过（需 dev server 运行在 5000）
```

冒烟覆盖：创建会议 → addActionItem（单条返回/originalId/status 透传）→ 幂等 → 保存纪要派生+手动项保留 → 空表格软取消派生项 → GET 并集 → 409 乐观锁 → 三行表格删中间行重编号（手动 priority 不串行）→ 清理。
