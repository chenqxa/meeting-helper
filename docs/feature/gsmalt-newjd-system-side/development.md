# GSMALT「绩效面谈·未达成KPI」新节点回填 系统侧

> 触发场景：OA 后续不回写，所有重派后产生的新节点都活在 hyzs_action_items；
> 月度看板绩效面谈·未达成KPI 板块，X 项末列「新节点」原本只查 OA `uf_GSMALT_dt1` 主表，无法找到系统侧重派出来的新节点 → 显示空。

## 改动

`src/app/api/gsmalt/route.ts`：

1. 同步加载 `hyzs_action_items`（`source_type='gsmalt' AND original_id IS NOT NULL`）时，多取一列 `due_date`，构建 `sysNewJdMap: Map<OA dt1.id, due_date_max>`；
2. 算 `newJd` 时，候选 1（OA 主表 maxJd）和候选 2（系统侧 sysNewJdMap）取更晚且 > 原 `jd` 的。

## 验证

`pnpm tsx` 探针（已删除）：沈旭日 8-10 月 gsmalt 行确认——
- 原 X：`original_id=1188, due_date=2026-08-13, oa_score=-1`
- 重派新项：`original_id=1188, due_date=2026-09-28, reassigned_from=<原 X 的系统 id>`
- 修复后 /api/gsmalt 对这条会返回 `newJd="2026-09-28"`

## 影响

- 不影响 X 项本身的统计口径（仍是 OA `audit===1`）
- 不影响 V 项（`newJd` 计算条件是 `audit===1`）
- 不影响「已完成项」详情弹窗（用 `dt1Id` 匹配系统行的逻辑没动）
- typecheck 通过
