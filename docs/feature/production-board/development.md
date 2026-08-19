# 产销会看板（/production-board）开发文档

> 版本：v1.0  ·  对应代码：`src/app/production-board/page.tsx`
> 依赖：`src/components/slide-frame.tsx`、`GET /api/actions`、`GET /api/continuous/progress`

## 1. 技术栈

与周例会/月度看板一致：Next.js 16 App Router（客户端组件）+ Embla Carousel + Tailwind 4 + SlideFrame（1600×900 设计稿等比缩放）。

## 2. 目录与改动清单

```
src/app/production-board/page.tsx       新增  产销会看板主体（复制 monthly-board 改造）
src/components/layout/dashboard-layout.tsx  改动  +侧边栏「产销会看板」+PAGE_TITLES['/production-board']
```

## 3. 与 monthly-board 的差异

| 项 | monthly-board | production-board |
|----|---------------|------------------|
| 数据过滤 | `meeting_type === '公司月会'` | `meeting_type === '产销会'` |
| 第1页标题 | MONTHLY OVERDUE REVIEW | PRODUCTION-SALES OVERDUE REVIEW |
| 统计周期 | 上一个自然月（monthRange） | 同左（按月） |
| 打0口径 | 打0不算完成 | 同左（不归属任何板块、不计完成率）——2026-08-18 补齐 stats/持续项/完成率/上月通报四处 |
| 完成情况列 | w-48、不截断、悬停全文 | 同左 |
| 表头 | 18px 加粗 sticky 吸顶 | 同左 |

其余组件结构（OverdueNoticeSlide / ContinuousSlide / StatsSlide / 工具栏 / NavArrow）完全一致。

## 4. 数据流

```
mount → fetch('/api/actions') + fetch('/api/continuous/progress')
      → 前端 filter(meeting_type==='产销会') + monthRange(上月)
      → 三页幻灯片
```

## 5. 已知限制

- 无独立缓存，每次进入页面拉取全量 actions（与周例会看板一致）。
- 产销会批次导入项（source_text='产销会'）仅进持续项页，不进第 1 页周期核算（无 due_date 落月的保障）。

## 6. 验证命令

```bash
pnpm ts-check
pnpm exec eslint src/app/production-board/page.tsx
```
