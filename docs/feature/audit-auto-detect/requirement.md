# 关闭「文字自动判分」与稽核口径修正 需求文档

> 版本：v1.0
> 创建：2026-09-20
> 状态：待实施
> 关联代码：`src/lib/action-status.ts`、`src/app/api/actions/[id]/route.ts`、`src/app/api/oa/callback/route.ts`、`src/app/mytasks/page.tsx`、`src/app/kanban/page.tsx`、`src/app/continuous/page.tsx`

---

## 一、背景

系统存在一条规则：**汇报文字里出现"完成"等关键词就自动把事项判为已完成并打 V（+1）**。

该规则近期造成两类问题：
1. **持续项被自动打 V**：持续项本无"完成/未完成"口径，却因进展文字含"完成"被自动判为 done+V。
2. **无人稽核也能出现 V**：责任人只是在"我的任务/待办中心"填进展文字，没有稽核权限，却被系统自动打分。

### 典型样例（线上数据实测）

| 事项 | 责任人 | 现象 |
|------|--------|------|
| 每月25日销售提供签字版出货计划 | 沈旭日 | 09:37 提交进展文字"已完成" → 系统自动判 done、`oa_score=1`、`oa_auto_detected=true` |
| 客诉整改须在下一批订单生产时再验证确认是否闭环 | 沈建凯 | 8/20 报 done 打 V → 5 分钟后改回"进行中"，但 **V 未清除**，一直残留 |

全库统计：`due_date_type='continuous'` 共 98 条，其中 31 条 `status='done'`、22 条 `oa_score=1`、**12 条 `oa_auto_detected=1`**（均系文字自动判分产生）。

---

## 二、现状与根因

### 2.1 自动判分规则

`src/lib/action-status.ts:21-40`：

```ts
const DONE_KEYWORDS = ['完成', '已完', '通过', '完毕', '达成', '落实', '已执行', '已实现', '已处理', '已解决', '已上线', '已发布', '验收'];
const FAIL_KEYWORDS = ['未完成', '无法', '取消', '放弃', '阻塞', '超期', '拒绝', '不通过', '失败', '暂停'];
```

问题点：
- FAIL 先于 DONE 判断，"未完成"能挡住，但 **"末完成""1个没完成"挡不住**，会命中"完成"→ 判 V（廖新平一条即为"末完成"）。
- 只要文字命中即判分，**不区分行动项 / 持续项**。

### 2.2 触发位置

1. **系统内汇报**：`src/app/api/actions/[id]/route.ts:287-297`
   ```ts
   if (patch.oaResult && body.status !== 'done' && body.status !== 'blocked' && patch.oaScore == null) {
     const detected = autoDetectStatus(patch.oaResult);
     if (detected.autoDetected && detected.status === 'done') {
       patch.status = 'done'; patch.oaScore = detected.score; patch.oaAutoDetected = true;
     }
   }
   ```
   前端持续项汇报只传 `status:'in_progress'` + 文字（`mytasks/page.tsx:581-588`、`kanban/page.tsx:2265-2267`），到这里被自动翻成 done+V。

2. **OA 回传**：`src/app/api/oa/callback/route.ts:31` 起，用 `autoDetectStatus(result_remark, explicitStatus)`；OA 无显式状态时按文本判分（三处 patch：57 / 87 / 119）。

### 2.3 关联缺陷

- **持续项未排除自报完成**：`route.ts:144-159、281-285`，`FORBIDDEN_KEYS` 不含 `oa_score/status`，责任人自报 done/blocked 即 `oa_score=±1`（沈建凯 8/20 即此路径）。
- **状态回退不清分**：`route.ts:281-285` 对 `in_progress` 只是 `delete patch.oaScore`（不改库里旧值），故 done→进行中后 V 残留。
- **服务端无审计鉴权**：V/X 按钮仅前端按 admin 隐藏（`continuous/page.tsx:767,794`、`tracking/page.tsx:1111`），后端 `oa_score` 变更未强制 `canAudit`。

---

## 三、目标

1. **暂时关闭"凭文字自动判分"**（系统内 + OA 回传两处都关，可随时开关恢复）。
2. **持续项彻底不参与 V/X 稽核**：只写进展，不写分。
3. **状态回退即清分**：取消/回退状态时清掉残留 V/X。
4. **服务端收紧审计权限**：改 `oa_score` 需 `canAudit`（admin）。
5. **存量纠错**：清理 12 条持续项自动 V（及点名的两条残留 V）。
6. **通知联动**：持续项完成不再发"已完成"卡片。

---

## 四、功能范围

### 含

- 新增环境开关 `AUTO_DETECT_STATUS_ENABLED`（**默认 false**），关闭时 `autoDetectStatus` 仅认**显式状态**，纯文本不判分。
- `route.ts` 对持续项的**责任人自报**强制 `status='in_progress'`、`oa_score=null`、`oa_auto_detected=false`（管理员手动稽核不受此限）。
- 持续项进展上报时显式清 `oa_score`。
- `route.ts` 对 `oa_score` 变更的审计鉴权。
- 存量数据一次性清理（先导出清单）。
- 持续项不触发完成通知。

### 不含

- 不改 OA 表单本身。
- 不改各看板 V/X 展示（仍保留管理员手动稽核能力）。
- 不引入新的自动判分算法（关闭而非改良）。

---

## 五、行为规格

### 5.1 开关语义

| 场景 | 开关关（默认） | 开关开 |
|------|----------------|--------|
| 系统内汇报文字含"完成"，状态=进行中 | **不改变状态/不打分**（只存文字） | 现状：自动判 done+V |
| OA 回传带显式状态 | 按显式状态判分（不变） | 同左 |
| OA 回传仅文字、无显式状态 | **不写状态/不写分**（只写回传内容与附件） | 现状：按文字判分 |

> OA 关后，"无显式状态"回落为 `in_progress`（`score=null`），**不使用 `0`**，避免 `oa_score===0` 导致看板/待办隐藏。

### 5.2 持续项规则

- **责任人自报进展**（`isSelfReport`）：忽略其传来的 `status`/`oa_score`，一律 `status='in_progress'`、`oa_score=null`、`oa_auto_detected=false`，并清 `completed_at/completed_by`。
- **管理员手动稽核**（走 `guardWrite('admin')` 或具备 `canAudit`）：**保留**，可给持续项手动打 V/X/0。
- 持续项进展只写 `oa_result` / `oa_result_at` / 附件 / 周期进展表。

### 5.3 审计鉴权

- 请求体含 `oa_score` 且值有变化时：
  - 非持续项、责任人自报 done(→+1)/blocked(→-1)：允许（分数与服务端对齐）。
  - 其它情形：需 `hasPermission(loginid,'canAudit')`（admin），否则 403。

---

## 六、数据清理（需人工确认后执行）

**范围**：`due_date_type='continuous' AND oa_score IS NOT NULL`（建议先全量导出人工确认），至少包括：

```sql
-- 1) 导出待清理清单
SELECT id, description, owner, status, oa_score, oa_auto_detected, completed_at, completed_by
FROM hyzs_action_items
WHERE due_date_type='continuous' AND oa_score IS NOT NULL
ORDER BY oa_auto_detected DESC, completed_at DESC;

-- 2) 清理：持续项清除稽核分/自动标记，状态回退进行中
UPDATE hyzs_action_items
SET oa_score=NULL, oa_auto_detected=0, status='in_progress',
    completed_at=NULL, completed_by=NULL
WHERE due_date_type='continuous' AND oa_score IS NOT NULL;

-- 3) 点名两条（含 oa_auto_detected=0 的自报残留）
UPDATE hyzs_action_items
SET oa_score=NULL, oa_auto_detected=0, status='in_progress',
    completed_at=NULL, completed_by=NULL
WHERE id IN ('ACT_1785487032584_U6ESN','ACT_1785487033104_80OPV');
```

- 每次 UPDATE 同步写一条 `hyzs_operation_logs`（action=`audit`，summary 注明"存量纠错"），便于追溯。
- 清理前建议对 `hyzs_action_items` 相关行做备份/快照。

---

## 七、影响面

- 关闭自动判分后，需人工稽核的量增加（这是本需求的预期代价）。
- 持续项不再产生 V/X；贡献榜/看板中持续项口径不变（本就另算）。
- OA 回传若长期"无显式状态"，将不再自动给分，需要人工在系统内稽核。

---

## 八、验收标准

- [ ] `AUTO_DETECT_STATUS_ENABLED=false` 时，系统内填写含"完成/末完成/1个没完成"的进展，**不会**自动变 done、不产生 V。
- [ ] OA 回传仅文字时，不写状态、不写分（只写回传内容）。
- [ ] 任何持续项更新后 `oa_score` 必为 NULL、`status` 为 in_progress。
- [ ] 持续项 done→进行中后不再有残留 V。
- [ ] 非 admin 无法通过接口把 `oa_score` 改成任意值（除自报 done/blocked 对齐）。
- [ ] 存量 12 条自动 V 与两条点名项清理完成，操作日志留痕。
- [ ] 持续项完成不再给提出人发完成卡片。
- [ ] 管理员在看板/台账手动打 V/X/0 的能力不受影响。

---

## 九、工期估计

| 项 | 工期 |
|----|------|
| 开关 + 两处调用点改造 | 0.5 天 |
| 持续项强制规则 + 回退清分 | 0.3 天 |
| 服务端审计鉴权 | 0.3 天 |
| 存量清单导出 + 清理 + 留痕 | 0.3 天 |
| 自测 + 文档 | 0.3 天 |
| **合计** | **约 1.5～2 天** |
