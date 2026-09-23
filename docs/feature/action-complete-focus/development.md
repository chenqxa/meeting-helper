# 行动项完成通知「聚焦显示」开发文档

> 对应需求：`docs/feature/action-complete-focus/requirement.md`
> 版本：v1.0 · 2026-09-20

---

## 一、技术栈

- Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind CSS 4
- 纯前端改动为主（`src/app/tracking/page.tsx`），无新增接口/表。

---

## 二、改动清单

| 文件 | 位置 | 改动 |
|------|------|------|
| `src/app/tracking/page.tsx` | `filtered`（约 545-626） | ①`focusId` 命中时短路，只保留该条；②日期范围默认与显隐处理 |
| `src/app/tracking/page.tsx` | 顶部聚焦区（约 887-897） | （可选）渲染「完成详情」卡 |
| `src/lib/wecom-action-push.ts` | `117-170` | （配套）持续项不再发完成卡片；可选：卡片文案强化 |
| `src/app/api/actions/[id]/route.ts` | `311-324` | （配套）持续项不触发 `notifyProposerOnComplete` |

---

## 三、具体改法

### 3.1 聚焦短路（必做）

`src/app/tracking/page.tsx` 的 `filtered` 回调**第一行**加：

```ts
const filtered = items.filter(i => {
  // 完成通知聚焦：只显示该条，绕过所有其它筛选（含默认日期窗口）
  if (focusId) return i.id === focusId || (i as any).dbId === focusId;
  if (i.due_date_type === 'continuous') return false;
  // ... 原有逻辑
});
```

并把原 `545-549` 里的 `if (focusId && ...) return false;` 删除（已被短路覆盖）。

> 说明：`items` 来自 `/api/actions`，已由服务端按登录人做过权限过滤，因此短路不会越权。
> 若聚焦条不在 `items`（无权限/已删），列表为空态、提示条显示（0条），符合预期。

### 3.2 日期范围默认与显隐（建议）

现状：`customDateStart/End` 默认"最近 30 天"且无条件执行（`252-259`、`621-623`）。两种改法二选一：

- **方案 A（最小改动）**：把默认值改为"全部"。即 `dateRange` 保持 `'all'`，并让自定义区间默认**不填**：
  ```ts
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd]     = useState('');
  ```
  用户主动选日期时才过滤。

- **方案 B（更稳）**：保留默认 30 天，但在筛选条上**显著显示**当前区间（如「日期：2026-08-21 ~ 2026-09-20 ✕」），点 ✕ 即清空为全部。

推荐 **方案 B**，避免"老记录突然全冒出来"影响日常使用；若追求简单选 A。

### 3.3 完成详情卡（可选，体验最佳）

聚焦态（`focusId` 命中）时，在提示条下渲染一个只读卡：

```tsx
{focusId && filtered[0] && (
  <div className="mb-3 p-4 bg-white border border-emerald-100 rounded-2xl">
    <p className="text-sm font-medium text-slate-800">{filtered[0].description}</p>
    <div className="text-xs text-slate-500 mt-1">
      责任人 {filtered[0].owner || '—'} · 提出人 {filtered[0].proposer || '—'}
      · 截止 {filtered[0].due_date || '未设定'}
    </div>
    <div className="text-xs text-slate-700 mt-2 whitespace-pre-wrap">
      完成说明：{filtered[0].oa_result || '（未填说明）'}
    </div>
    <div className="text-[10px] text-slate-400 mt-1">
      完成时间：{filtered[0].oa_result_at || filtered[0].completed_at || '—'}
    </div>
    {/* 附件：filtered[0].oa_attachments?.map(...) */}
  </div>
)}
```

字段来源：`/api/actions` 返回的 `description / owner / proposer / due_date / oa_result / oa_result_at / completed_at / oa_attachments`。

### 3.4 配套：持续项不发完成卡片

`src/app/api/actions/[id]/route.ts:311-324` 的触发条件加持续项判断：

```ts
if (body.status === 'done' && existing.status !== 'done'
    && existing.dueDateType !== 'continuous' && updated?.dueDateType !== 'continuous') {
  // notifyProposerOnComplete(...)
}
```

避免"持续项自动判分/稽核完成"给提出人发卡片（该场景本就不该有"完成"语义）。

---

## 四、数据流

```
责任人完成 → PUT /api/actions/[id] (status=done)
   → notifyProposerOnComplete() → 企微 textcard
        url = /tracking?shared=true&focusId=<id>
   → middleware shared OAuth → /tracking
   → GET /api/actions（服务端按人过滤）
   → filtered: focusId 短路 → 仅 1 条 → 展示完成说明
```

---

## 五、影响面与回归

- 只影响 `/tracking` 的展示层；`/api/actions`、看板、持续项页不受影响。
- 回归重点：非 focusId 的常规筛选/排序/导出/内联编辑仍正常。
- 员工/经理/管理员视角的行数与提示条逻辑不变。

---

## 六、已知限制

- 若聚焦条在服务端就不可见（无权限），仍会空态——这是有意的权限边界。
- 可选完成详情卡与下方表格会重复展示同一信息，可按需"聚焦时隐藏表格"。

---

## 七、验证命令

```bash
pnpm lint
pnpm ts-check
# 可选：pnpm build
```

---

## 八、实施顺序建议

1. 3.1 聚焦短路（解决空页核心问题）
2. 3.2 日期范围显隐（消除"老记录默认看不到"）
3. 3.4 持续项不通知（与 `audit-auto-detect` 同批）
4. 3.3 完成详情卡（体验增强）
