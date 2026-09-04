# 月度看板·战略稽核（GSMALT）开发文档

## 1. 技术栈

沿用项目栈：Next.js App Router + TypeScript + mssql + Tailwind；无新依赖。

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/app/api/gsmalt/route.ts` | **新增** `GET /api/gsmalt`：直连 FWsv 查询、新节点计算、60s 缓存 |
| `src/app/monthly-board/page.tsx` | 新增 `GsmaltItem` 结构、`GsmaltXSlide`/`GsmaltStatsSlide`/`GsmaltRow` 组件、gsmalt 状态与随月加载 effect、slides 清单插两页 |

## 3. 数据流

```
OA FWsv.ecology.dbo
  └─ /api/gsmalt?month=YYYY-MM ──(mssql getAppPool + 四段表名)──▶ 2 条 SQL
       ① 数据月明细：LEFT(jd,7)=@month，join KPI/部门/人员
       ② 全表聚合：GROUP BY clzbkpi, zrr, ISNULL(yyfx2,'') → MAX(jd)
  Node 侧：keyOf = clzbkpi|zrr|trim(yyfx2)；X 项 newJd = maxJd 仅当 maxJd > 原节点
       ──▶ { month, items[] }（60s 内存缓存，按 month 键）
monthly-board：useEffect 依赖 lastMonthLabel 自动 fetch → gsmalt / gsmaltXItems memo → slides
```

## 4. 字段映射

| 前端字段 | OA 字段 | 说明 |
| --- | --- | --- |
| kpi | `uf_KPI.kpiz` | b.clzbkpi = c.id |
| dept | `hrmdepartment.departmentname` | b.zrbm = d.id |
| owner | `hrmresource.lastname` | b.zrr = e.id |
| audit | `uf_GSMALT_dt1.jh` | 0=V 1=X 2=0；前端原值展示映射 |
| jd / newJd | `b.jd` / 全表 `MAX(jd)` | 归一化 `replace(/,-/).slice(0,10)` 字符串比较 |
| yyfx / xdjh / cl / hl | `b.yyfx2 / b.xdjh2 / b.cl / b.hl` | 原因分析/行动计划/策略/衡量 |

## 5. 组件结构

- `GsmaltXSlide`：深红渐变标题栏（对齐 OverdueNoticeSlide 视觉，头部双徽标：打X / 未处理）+ 复用 `SectionRow` 分块（✕打X项红 / 未处理项·未稽核黄，各块独立计数，无则显示"无"）+ 10 列表格（长文本 `line-clamp-2` + `title` 悬浮全文）+ 底部 Metric 统计栏（总/V/X/0/未稽核）。
- `GsmaltStatsSlide`：`SlideShell` 外壳 + 4 统计卡 + 部门 V/0/X/未稽核 堆叠条（宽度按部门最大值归一）+ 达成率环（V÷(V+X)，0 与未稽核不计入）。
- 未处理项口径：`audit === null`（API 已把 OA 的 NULL/空串/空白归一为 null，避免 `Number('') === 0` 误判为 V）。
- 状态兜底：`loading` / `error` / 空数据三分支，互不影响其它幻灯片。

## 6. 扩展机制

- 后续若需 V/0 明细页：`gsmalt` 已含全量明细，加 slide 过滤 `audit===0/2` 即可。
- 若改定时同步本地表：仅替换 route 内两条 SQL 为本地表查询，前端零改动。

## 7. 已知限制

- 「同一项」依赖 OA 录入时保持 KPI/责任人/原因分析一致；原因分析文本改动会被视为新项。
- 跨月匹配扫描全表（GROUP BY），表量级小无压力；表极大时需改按 X 键过滤查询。
- 链接服务器断连时该两页显示错误提示（不缓存失败结果）。

## 8. 验证命令

```bash
pnpm ts-check
pnpm exec eslint src/app/api/gsmalt/route.ts src/app/monthly-board/page.tsx
pnpm dev   # 手工访问 /monthly-board 与 /api/gsmalt?month=2026-08
```
