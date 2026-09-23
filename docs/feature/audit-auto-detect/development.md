# 关闭「文字自动判分」与稽核口径修正 开发文档

> 对应需求：`docs/feature/audit-auto-detect/requirement.md`
> 版本：v1.0 · 2026-09-20

---

## 一、技术栈

- Next.js 16（App Router）+ TypeScript 5
- 存储：SQL Server（`hyzs_action_items`、`hyzs_operation_logs`），`mssql`
- 开关：环境变量 `AUTO_DETECT_STATUS_ENABLED`（默认关闭）

---

## 二、改动清单

| # | 文件 | 位置 | 改动 |
|---|------|------|------|
| 1 | `src/lib/action-status.ts` | 全文件 | 加开关；关闭时文本不判分 |
| 2 | `src/app/api/actions/[id]/route.ts` | `287-297` | 自动判分块加开关判断 |
| 3 | `src/app/api/actions/[id]/route.ts` | `updateActionItem` 之前 | 持续项强制 `in_progress + oa_score=null` |
| 4 | `src/app/api/actions/[id]/route.ts` | `311-324` | 持续项不触发完成通知 |
| 5 | `src/app/api/oa/callback/route.ts` | `31-120` | 关闭时无显式状态则不写状态/分 |
| 6 | 数据库 | `hyzs_action_items` | 一次性清理存量（脚本/SQL） |
| 7 | `src/lib/operation-log.ts` | 调用处 | 清理动作写 operation log |

---

## 三、具体改法

### 3.1 `action-status.ts`：加开关

```ts
// 是否启用"按文字自动判分"。默认关闭；设 AUTO_DETECT_STATUS_ENABLED=true 恢复旧行为。
export function isAutoDetectEnabled(): boolean {
  return process.env.AUTO_DETECT_STATUS_ENABLED === 'true';
}

export function autoDetectStatus(resultText: string, explicitStatus?: string) {
  if (explicitStatus === 'done')    return { status: 'done',    score: 1,  autoDetected: false };
  if (explicitStatus === 'blocked') return { status: 'blocked', score: -1, autoDetected: false };

  // 开关关闭：纯文本一律不判分，归为"进行中、无分"
  if (!isAutoDetectEnabled()) {
    return { status: 'in_progress', score: 0, autoDetected: false };
  }

  // ...以下保留原有关键词逻辑（DONE/FAIL/PROGRESS）
}
```

> 该模块也被客户端页面引用（`getActionDisplayStatus` 等），但 `autoDetectStatus` 仅服务端使用；`process.env` 在客户端会被内联为 `undefined`，不影响。

### 3.2 `route.ts`：自动判分块加开关（287-297）

```ts
import { autoDetectStatus, isAutoDetectEnabled } from '@/lib/action-status';

if (isAutoDetectEnabled()
    && patch.oaResult
    && body.status !== 'done' && body.status !== 'blocked'
    && patch.oaScore == null) {
  const detected = autoDetectStatus(patch.oaResult);
  if (detected.autoDetected && detected.status === 'done') {
    patch.status = 'done';
    patch.completedBy = currentUser?.name || existing.owner || '未知用户';
    patch.completedAt = now;
    patch.oaScore = detected.score;
    patch.oaAutoDetected = true;
  }
}
```

### 3.3 `route.ts`：持续项强制规则（在 `updateActionItem` 前）

在 `const updated = await updateActionItem(targetActionId, patch);`（约 299 行）**之前**插入：

```ts
// 持续项：责任人自报进展只记文字，不参与 V/X 稽核（管理员手动稽核不受此限）
if (existing.dueDateType === 'continuous' && isSelfReportFinal) {
  const isAuditor = currentUser ? await hasPermission(currentUser.loginid, 'canAudit') : false;
  if (!isAuditor) {
    patch.status = 'in_progress';
    patch.oaScore = null;
    patch.oaAutoDetected = false;
    patch.completedAt = null;
    patch.completedBy = null;
  }
}
```

这样同时解决：
- 文字自动判分翻 done（旧数据路径脏写）；
- 责任人自报 done/blocked 打 V/X；
- 状态回退 V 残留（每次进展上报都会把 V 清为 null）。
- 同时**保留**管理员手动稽核（`canAudit`）给持续项打 V/X/0。

### 3.4 `route.ts`：持续项不触发完成通知（311-324）

```ts
if (body.status === 'done'
    && existing.status !== 'done'
    && existing.dueDateType !== 'continuous'
    && updated?.dueDateType !== 'continuous') {
  // void import('@/lib/wecom-action-push').then(...)
}
```

### 3.5 `oa/callback/route.ts`：关闭时不写状态/分

当前三处 patch（57 / 87 / 119）直接写 `status/oaScore/oaAutoDetected`。改为：

```ts
import { autoDetectStatus, isAutoDetectEnabled } from '@/lib/action-status';

const hasExplicit = !!explicitStatus;
const autoOn = isAutoDetectEnabled();
const { status: mappedStatus, score, autoDetected } = autoDetectStatus(result_remark || '', explicitStatus);

// 仅当有显式状态，或开关开启时才写状态/分；否则只写回传内容与附件
const writeStatusScore = hasExplicit || autoOn;

const patch: Record<string, any> = {
  oaResult: result_remark || '',
  oaResultAt: now,
  oaAttachments: Array.isArray(attachments) ? attachments : (attachments ? [attachments] : undefined),
  ...(writeStatusScore
    ? { status: mappedStatus as any, oaScore: score, oaAutoDetected: autoDetected }
    : {}),
};
if (writeStatusScore && mappedStatus === 'done') { /* completedBy/completedAt */ }
if (writeStatusScore && mappedStatus === 'blocked') { /* blockReason */ }
```

> 说明：`autoDetectStatus` 关闭时无显式状态返回 `score=0`，因此**必须**用 `writeStatusScore` 拦截，避免把 `oa_score` 写成 0（0 会导致看板/个人待办把该条隐藏）。

### 3.6 存量数据清理

**前置**：先备份/快照 `hyzs_action_items` 中 `due_date_type='continuous'` 的行；导出待清理清单人工确认。

```sql
-- 1) 导出清单
SELECT id, description, owner, status, oa_score, oa_auto_detected, completed_at, completed_by
FROM hyzs_action_items
WHERE due_date_type='continuous' AND oa_score IS NOT NULL
ORDER BY oa_auto_detected DESC, completed_at DESC;
```

确认后执行（建议封装为一次性脚本 `scripts/_archive/cleanup-continuous-score.ts` 或直接 SQL，逐条留痕）：

```sql
-- 2) 持续项清分（含自动判分与自报残留）
UPDATE hyzs_action_items
SET oa_score=NULL, oa_auto_detected=0, status='in_progress',
    completed_at=NULL, completed_by=NULL
WHERE due_date_type='continuous' AND oa_score IS NOT NULL;

-- 3) 点名两条（兜底，若不在上一步范围内）
UPDATE hyzs_action_items
SET oa_score=NULL, oa_auto_detected=0, status='in_progress',
    completed_at=NULL, completed_by=NULL
WHERE id IN ('ACT_1785487032584_U6ESN','ACT_1785487033104_80OPV');
```

留痕：清理前记录受影响 id 列表，逐条写 `hyzs_operation_logs`：

```
action='audit', target_type='action_item', target_id=<id>,
summary='存量纠错：持续项清除稽核 V（原 oa_score=1, auto=1）'
```

> 脚本实现可复用 `src/storage/database/operation-log-storage.ts::createOperationLog`。

---

## 四、数据流（改造后）

```
系统内汇报 (status=in_progress + 文字)
  → route.ts: isAutoDetectEnabled()=false → 不自动判分
  → 若 due_date_type=continuous → 强制 in_progress + oa_score=null
  → 写周期进展表
  → 不触发完成通知

OA 回传 (仅文字, 无显式状态)
  → callback: writeStatusScore=false → 只写 oa_result/附件，不动 status/score

管理员手动稽核 V/X/0
  → tracking/continuous 页面 PUT oa_score
  → route.ts: 非持续项 → 允许（或 canAudit 校验）；持续项 → 强制清为 null
```

---

## 五、影响面与回归

- 关闭后：系统内/ OA 不再自动产生 V，需人工稽核（预期）。
- 持续项：不再有 done/V/X；看板与贡献榜中持续项口径本就走"填报情况"，不受影响。
- 回归重点：管理员手动稽核、责任人自报（非持续项的"已完成/未完成"）、OA 回传显式状态路径、未完成重派。

---

## 六、配置与回滚

- 新增 `.env`：`AUTO_DETECT_STATUS_ENABLED=false`（不配置即关闭）。
- 回滚：设 `AUTO_DETECT_STATUS_ENABLED=true` 即恢复旧自动判分；存量清理不可逆，需用备份还原。

---

## 七、验证命令

```bash
pnpm lint
pnpm ts-check
# 可选：pnpm build
```

---

## 八、实施顺序建议

1. 3.1 + 3.2（关系统内自动判分）
2. 3.3 + 3.4（持续项强制 + 不通知）
3. 3.5（OA 回传同步关）
4. 3.6（导出 → 确认 → 清理 → 留痕）
5. 观察一周，评估是否恢复/改良自动判定
