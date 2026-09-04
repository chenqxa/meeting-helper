# 周例会看板（/weekly-board）开发文档

> 版本：v1.1  ·  对应代码：`src/app/weekly-board/page.tsx`
> 依赖：`src/components/ui/carousel.tsx`（Embla）、`GET /api/actions`

---

## 1. 技术栈

| 项 | 选型 |
|----|------|
| 框架 | Next.js 16 App Router（客户端组件） |
| UI | shadcn/ui + Tailwind CSS 4 |
| 滑动 | Embla Carousel（已封装于 `components/ui/carousel.tsx`） |
| 图标 | lucide-react |
| 数据 | `fetch('/api/actions')`，前端计算 |

## 2. 目录与改动清单

```
src/app/weekly-board/page.tsx          新增  演示页主体（滑动壳 + 三页）
src/components/slide-frame.tsx         新增  固定 1920×1080 设计稿 + transform:scale
                                          等比缩放容器（2026-08-18，电视投屏字号不缩小）
src/components/layout/dashboard-layout.tsx  改动  +侧边栏导航项 /weekly-board
                                          +PAGE_TITLES['/weekly-board']
                                          +import Presentation 图标
src/app/tracking/page.tsx              改动  +顶部「演示」按钮跳转 /weekly-board
                                          +import Presentation 图标
                                          +重新派发（会议项）带 reassigned_from/due_date_type（2026-08-18）
src/app/api/meetings/[id]/route.ts     改动  PATCH addActionItem 持久化 reassigned_from、
                                          due_date_type、source_sentence→source_text，
                                          并回写原 X 项 reassigned_to（2026-08-18）
src/app/monthly-board/page.tsx         改动  同步接入 SlideFrame（2026-08-18）
```

## 3. 组件结构

```
WeeklyBoardPage（默认导出）
├─ 顶部工具栏（ToolbarBtn × 3：刷新 / 自动播放 / 沉浸）
├─ Carousel（Embla 滑动壳）
│  └─ CarouselItem × N
│     ├─ StatsSlide         第1页 统计汇总
│     ├─ ActionBoardSlide   第2页 待办明细
│     └─ PlaceholderSlide   占位页（后续异构插槽）
├─ NavArrow（左 / 右 翻页）
└─ 底部页码 + 圆点导航
```

### 3.1 通用外壳 `SlideShell`
统一 16:9 视觉：顶部色带（`accent` 渐变）+ 标题区（`eyebrow` / `title` / `subtitle`）+ 内容区。所有幻灯片页都套这层，保证视觉一致。

### 3.2 `StatsSlide`（统计汇总）
- `useMemo` 计算统计：`pending` / `done` / `dueThisWeek` / `overdue` / `high`。
- 部门分布：聚合 `dept`，取前 6，按最大值归一化条形宽度。
- 优先级：三环图，按 `priority` 计数 + 百分比。

### 3.3 `ActionBoardSlide`（待办明细）
- 入参 `items`（已过滤为未处理）。
- 卡片：优先级色点 + `description`（line-clamp-2）+ 三个 Chip（部门/节点/责任人）。
- 超期判断：`isOverdue()` → 节点标签变红。

## 4. 数据流

```
mount → fetch('/api/actions') → setItems(BoardItem[])
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              StatsSlide    ActionBoardSlide   (其他页)
             （全量 items）   （pending 过滤）
```

- 仅一次拉取，统计与明细共享同一份 `items`，避免重复请求。
- `pendingItems = items.filter(未处理)`，`useMemo` 缓存。

## 5. 关键字段映射

| 接口字段 | 演示用途 | 处理 |
|----------|----------|------|
| `description` | 卡片标题 | `line-clamp-2` |
| `due_date` + `due_date_type` | 节点标签 | `date`→格式化日期；`continuous`→「持续跟进」；空→「未定」 |
| `dept` | 部门标签 / 分布 | 空→「未分配」 |
| `owner` | 责任人标签 | 空→「待分配」 |
| `priority` | 色点 / 环图 | high→红 / medium→琥珀 / low→绿 |
| `status` | 过滤未处理 | `getActionDisplayStatus()` 映射 |
| `oa_score` | 完成判定 | **打 0（待定）的项不归属任何板块**：不算完成、不算待办、不计入完成率分子/分母（`isExcluded()` 全站过滤）；打 V(1) 或 status=done 才算已完成（2026-08-18 调整，仅周例会看板口径） |

## 6. 幻灯片扩展机制（重点）

异构页（每页主题不同）通过 `slides` 数组配置，无需改滑动壳：

```tsx
const slides = useMemo(() => [
  { id: 'stats',  label: '总览',   node: <StatsSlide items={items} /> },
  { id: 'board',  label: '明细',   node: <ActionBoardSlide ... /> },
  { id: 'next1',  label: '待补充', node: <PlaceholderSlide ... /> },
  // 新增一页：在此追加一行
], [items, pendingItems]);
```

**新增一页步骤：**
1. 写一个套 `SlideShell` 的页面组件。
2. 在 `slides` 数组追加一行 `{ id, label, node }`。
3. 如需该页数据，在 `useMemo` 依赖里加入。

## 7. 交互实现

| 功能 | 实现 |
|------|------|
| 滑动 | Embla `opts={{ loop:false, align:'start' }}` |
| 键盘 ←/→ | `window.addEventListener('keydown')`，过滤 INPUT/TEXTAREA/SELECT |
| 沉浸 F / Esc | 同上键盘监听，切 `immersive` 状态 |
| 自动播放 | `setInterval(6000)`，末页 `scrollTo(0)` 循环 |
| 页码同步 | `api.on('select', onSelect)` 更新 `current` |
| 圆点跳页 | `api.scrollTo(i)` |

## 8. 样式要点

- 非沉浸：`h-[calc(100vh-104px)]`（减去顶栏 56 + 内容 padding 48）。
- 沉浸：`fixed inset-0 z-[200] bg-slate-900/95`，覆盖全屏。
- **幻灯片缩放（2026-08-18）**：`SlideFrame` 组件按 1600×900 设计稿渲染，`ResizeObserver` 实测容器尺寸后 `transform: scale()` 等比缩放居中。电脑/4K 电视/投屏字号比例一致，解决"投屏后字变小"；设计稿取 1600×900（而非 1920×1080）使同屏字号放大约 1.2 倍，投屏更易读。
- 卡片圆角 `rounded-2xl` + `ring-1 ring-slate-100` + `shadow-2xl`，统一 PPT 视觉。
- 配色：每页 `accent` 渐变（蓝/翠/灰）区分主题。

## 9. 入口挂载点

### 9.1 侧边栏（dashboard-layout.tsx:189）
```tsx
{ icon: Presentation, label: '周例会看板', href: '/weekly-board', roles: ['admin','manager','secretary'] },
```

### 9.2 台账按钮（tracking/page.tsx）
刷新按钮旁，紫色描边按钮 `<Link href="/weekly-board">`。

## 10. 已知限制 / 后续

- 无导出 PPT 能力（可后续接 PptxGenJS）。
- 自动播放固定 6s，未做按页时长配置。
- 占位页待业务内容填充。
- 演示页内不能改状态（轻交互边界）。
- **填报窗口依赖"周例会固定周一"前提**：例会日若调整，需将 `contPeriod` 改为按真实会议记录动态计算（v2 扩展点，见需求文档 11.3）。

## 11. v1.1 统计周期实现（2026-08-31）

```ts
// dataPeriod（行动项数据周）：锚定今天 → 上一自然周（周一~周日）
const dataPeriod = useMemo(() => {
  const base = weekPeriod(new Date());          // 上周一 ~ 上周日
  if (weekOffset === 0) return base;
  const shift = weekOffset * 7;                  // 翻历史周
  ...
}, [weekOffset]);

// contPeriod（持续项填报窗口）：数据周整体后移一天（周二~周一 = 上次会次日~本次会日）
const contPeriod = useMemo(() => {
  const start = new Date(dataPeriod.start); start.setDate(start.getDate() + 1);
  const end = new Date(dataPeriod.end);     end.setDate(end.getDate() + 1);
  return { start, end };
}, [dataPeriod]);
```

- `progressInWeek`（持续项本期填报）改用 `contPeriod` 过滤，窗口内取最新一条；
- `ContinuousSlide` / `StatsSlide` 新增 `periodText` / `contPeriodText` props，界面明示填报窗口；
- 附带修复：翻历史周时 `weekStats.calcPeriod` 的 weekOffset 双重偏移 bug（`calcPeriod(0)` / `calcPeriod(1)`）。

## 12. 验证命令

```bash
pnpm ts-check                    # 类型检查（本项目无单测框架）
pnpm exec eslint src/app/weekly-board/page.tsx
```
