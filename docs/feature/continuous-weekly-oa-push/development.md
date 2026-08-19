# 持续项推送配置与 OA 闭环 开发文档

> 版本：v3.1  ·  对应需求：`requirement.md` v3.1
> 技术栈：Next.js 16 / TypeScript 5 / SQL Server（mssql）/ OA 直连（FWsv.ecology）

---

## 一、技术选型

| 层 | 方案 |
|----|------|
| 调度配置 | 新建 `hyzs_cadence_config` 表 + 存储 `cadence-storage.ts` + 前台 `/settings` 标签页 |
| 推送引擎 | `lib/continuous-push.ts`（按配置的 meeting_type 取持续项 → 推 OA + 发 IM） |
| OA 推送 | 复用 `pushTasksToOA`，新增 `sourceApp` 可选参数 |
| OA 回传 | 扩展 `api/oa/pull-results/route.ts`，增加 `HYZS_CONT` 通道 |
| 进展归集 | 新建 `hyzs_continuous_progress` 表 + 存储 `continuous-progress-storage.ts` |
| IM 提醒 | 复用 `batchSendOAUserMessage` |
| 定时调度 | `server.ts` 每分钟检查 `hyzs_cadence_config` |
| 手动触发 | `POST /api/continuous/push`（按 meeting_type 触发） |

---

## 二、改动点清单

### 2.1 新建文件

| 文件 | 内容 |
|------|------|
| `src/lib/continuous-push.ts` | 核心引擎：按 meeting_type 打包推送 OA + IM |
| `src/storage/database/cadence-storage.ts` | `hyzs_cadence_config` 表 CRUD + ensureTable |
| `src/storage/database/continuous-progress-storage.ts` | `hyzs_continuous_progress` 表 CRUD + ensureTable |
| `src/app/api/cadence/route.ts` | 调度配置 CRUD 接口（admin） |
| `src/app/api/continuous/push/route.ts` | 手动触发推送（admin，按 meeting_type） |
| `src/app/api/continuous/progress/route.ts` | 查询进展归集记录 |

### 2.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/lib/oa-task-push.ts` | `pushTasksToOA` 新增 `sourceApp` 可选参数（默认 HYZS，持续项传 HYZS_CONT） |
| `src/app/api/oa/pull-results/route.ts` | 新增 `HYZS_CONT` 通道 |
| `src/storage/database/action-storage.ts` | 新增 `last_progress` / `last_progress_at` 列迁移 |
| `src/server.ts` | 新增 `scheduleContinuousPush()`：每分钟检查 cadence_config |
| `src/app/settings/page.tsx` | 新增「持续项推送配置」标签页 |
| `src/app/continuous/page.tsx` | 展示最新进展 + 上次回填 + 历史时间线 |

---

## 三、核心实现

### 3.1 调度配置表（`cadence-storage.ts`）

```ts
// hyzs_cadence_config
CREATE TABLE hyzs_cadence_config (
  id             NVARCHAR(64) PRIMARY KEY,
  meeting_type   NVARCHAR(32) NOT NULL,    -- '周例会' / '月度总结会' / '产销协调会' ...
  cadence        NVARCHAR(10) NOT NULL,    -- 'weekly' / 'monthly'
  trigger_day    INT NOT NULL,             -- weekly: 1-7; monthly: 1-28
  trigger_time   NVARCHAR(5) NOT NULL,     -- '09:00'
  enabled        BIT NOT NULL DEFAULT 1,
  last_pushed_at NVARCHAR(30) NULL,
  created_at     NVARCHAR(30) NOT NULL,
  updated_at     NVARCHAR(30) NOT NULL
);

// CRUD
export const getCadenceConfigs = async (): Promise<CadenceConfig[]>
export const createCadenceConfig = async (data): Promise<CadenceConfig>
export const updateCadenceConfig = async (id, data): Promise<CadenceConfig | null>
export const deleteCadenceConfig = async (id): Promise<boolean>
```

### 3.2 推送引擎（`continuous-push.ts`）

```ts
export async function pushContinuousByType(
  meetingType: string,
  now: Date = new Date()
): Promise<{ items: number; pushed: number; failed: number }> {
  const today = now.toISOString().slice(0, 10);

  // ① 取该类型的未完成持续项
  const items = (await getAllActionItems()).filter(i =>
    i.sourceText === meetingType &&
    i.dueDateType === 'continuous' &&
    i.status !== 'done' && i.status !== 'cancelled'
  );
  if (items.length === 0) return { items: 0, pushed: 0, failed: 0 };

  // 注意：持续项的 due_date 保持 NULL 不动，不回写系统
  // OA 任务的 due_date = 当天，只在 pushTasksToOA 参数里传，不修改 hyzs_action_items

  // ② 推 OA（source_app=HYZS_CONT，按周期唯一 task_id）
  const sourceId = `CONT_${meetingType}_${today}`;
  const oaResult = await pushTasksToOA({
    id: sourceId,
    title: `${meetingType}持续项跟进（${today}）`,
    date: today,
    sourceApp: 'HYZS_CONT',
    actionItems: items.map(item => ({
      id: `${item.id}_${today}`,
      description: item.description,
      owner: item.owner, assignee: item.owner,
      ownerLoginId: item.ownerLoginId,
      ownerOaId: item.ownerOaId,
      dept: item.dept,
      proposer: item.proposer, proposerLoginId: item.proposerLoginId,
      due_date: today, dueDate: today,
      priority: item.priority || 'medium',
      status: item.status || 'pending',
    })),
  }, false);

  // ③ 企业微信提醒（按责任人聚合）
  await sendContinuousIM(items, meetingType, today);

  // ④ 日志
  await logOperation({ action: 'oa_sync', targetType: 'system', targetId: `continuous-${meetingType}`,
    summary: `${meetingType}持续项打包：${items.length} 项，OA ${oaResult.pushed}`,
    detail: { meetingType, date: today, items: items.length, pushed: oaResult.pushed } });

  return { items: items.length, pushed: oaResult.pushed, failed: oaResult.failed };
}
```

### 3.3 定时调度（server.ts）

```ts
// 每分钟检查 cadence_config，命中则推送
function scheduleContinuousPush() {
  setInterval(async () => {
    try {
      const configs = await getCadenceConfigs();
      const now = new Date();
      const day = now.getDay();       // 0=Sun..6=Sat
      const dayOfWeek = day === 0 ? 7 : day;  // 转成 1=Mon..7=Sun
      const dateOfMonth = now.getDate();
      const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

      for (const cfg of configs) {
        if (!cfg.enabled) continue;
        if (cfg.lastPushedAt && cfg.lastPushedAt.slice(0,10) === now.toISOString().slice(0,10)) continue; // 今天已推

        const shouldFire =
          (cfg.cadence === 'weekly' && cfg.triggerDay === dayOfWeek) ||
          (cfg.cadence === 'monthly' && cfg.triggerDay === dateOfMonth);
        if (!shouldFire) continue;
        if (cfg.triggerTime !== hhmm) continue;  // 精确到分钟

        console.log(`[ContinuousPush] 命中: ${cfg.meetingType} (${cfg.cadence} ${cfg.triggerDay} ${cfg.triggerTime})`);
        const r = await pushContinuousByType(cfg.meetingType, now);
        await updateCadenceConfig(cfg.id, { lastPushedAt: now.toISOString() });
        console.log(`[ContinuousPush] ${cfg.meetingType}: ${r.items} 项, OA ${r.pushed}`);
      }
    } catch (e) {
      console.error('[ContinuousPush] 调度异常:', e);
    }
  }, 60_000);  // 每分钟
}
```

### 3.4 前台配置页

在 `settings/page.tsx` 新增标签页「持续项推送配置」：

```tsx
// 列表：每条显示 meeting_type / cadence / trigger_day / trigger_time / enabled
// 操作：新增（选 meeting_type + 设频率/日期/时间）→ 保存
//       编辑（改频率/日期/时间）→ 保存
//       启停开关
//       「立即推送」按钮 → POST /api/continuous/push { meeting_type }
```

接口：

```ts
// GET    /api/cadence              → 获取全部配置
// POST   /api/cadence              → 新增配置 { meeting_type, cadence, trigger_day, trigger_time }
// PUT    /api/cadence              → 修改 { id, ... }
// DELETE /api/cadence?id=xxx       → 删除
// POST   /api/continuous/push      → 手动触发 { meeting_type }
// GET    /api/continuous/progress  → 查进展归集
```

### 3.5 pull-results 扩展

```ts
// 拉取 HYZS_CONT 回传
const contRes = await pool.request().query(`
  SELECT task_id, status, wcjgsm, modedatamodifydatetime
  FROM ${tbl}
  WHERE CAST(source_app AS NVARCHAR(50)) = 'HYZS_CONT'
    AND (wcjgsm IS NOT NULL AND DATALENGTH(wcjgsm) > 0)
`);

for (const row of contRes.recordset) {
  const taskId = String(row.task_id).trim();          // CONT_周例会_2026-08-04__ACT_xxx_2026-08-04
  const parts = taskId.split('__');
  if (parts.length !== 2) continue;

  const itemIdPart = parts[1];                          // ACT_xxx_2026-08-04
  const lastUnderscore = itemIdPart.lastIndexOf('_');
  const actionId = itemIdPart.slice(0, lastUnderscore); // ACT_xxx
  const cycleDate = itemIdPart.slice(lastUnderscore + 1); // 2026-08-04

  await upsertContinuousProgress({
    actionId, cycleDate, oaTaskId: taskId,
    progress: String(row.wcjgsm || '').trim(),
    oaStatus: row.status,
  });
  // 冗余更新持续项最新进展
  await updateActionItem(actionId, {
    lastProgress: String(row.wcjgsm || '').trim(),
    lastProgressAt: String(row.modedatamodifydatetime || ''),
  });
}
```

### 3.6 进展归集表

```ts
// hyzs_continuous_progress
CREATE TABLE hyzs_continuous_progress (
  id          BIGINT IDENTITY(1,1) PRIMARY KEY,
  action_id   NVARCHAR(64) NOT NULL,
  cycle_date  NVARCHAR(10) NOT NULL,
  oa_task_id  NVARCHAR(200) NOT NULL,
  progress    NVARCHAR(MAX) NULL,
  oa_status   INT NULL,
  synced_at   NVARCHAR(30) NOT NULL
);
CREATE UNIQUE INDEX ux_contprog_task ON hyzs_continuous_progress(oa_task_id);
CREATE INDEX idx_contprog_action ON hyzs_continuous_progress(action_id, cycle_date DESC);

// 写入（MERGE 幂等）
export async function upsertContinuousProgress(data): Promise<void>
// 读取
export async function getProgressByActionId(actionId): Promise<ProgressRecord[]>
export async function getAllProgress(): Promise<Record<string, ProgressRecord[]>>
```

---

## 四、OA task_id 命名规则

```
CONT_<会议类型>_<日期>__<itemId>_<日期>
```

示例：
```
CONT_周例会_2026-08-04__ACT_1785835494682_NGDCM_2026-08-04
CONT_月度总结会_2026-08-25__ACT_xxx_2026-08-25
CONT_产销协调会_2026-08-05__ACT_xxx_2026-08-05
```

解析（pull-results 用）：
```ts
taskId.split('__')     → ['CONT_周例会_2026-08-04', 'ACT_xxx_2026-08-04']
itemIdPart.lastIndexOf('_') → actionId='ACT_xxx', cycleDate='2026-08-04'
```

---

## 五、多周归集示例

持续项 `due_date` 保持 NULL 不变；周期日期编码在 task_id 里，回传时解析出来：

```
持续项 ACT_xxx（due_date=NULL, status=pending, 不被回传改变）
├── W31  推送: task_id = CONT_周例会_2026-08-04__ACT_xxx_2026-08-04
│        OA due_date = 2026-08-04（只传 OA，系统不动）
│        回传: wcjgsm = "已联系3家，完成40%"
│        解析: cycle_date = 2026-08-04
│        continuous_progress: { cycle=08-04, progress="已联系3家，完成40%" }
│
├── W32  推送: task_id = CONT_周例会_2026-08-11__ACT_xxx_2026-08-11
│        OA due_date = 2026-08-11
│        回传: wcjgsm = "6家中完成5家，剩余1家下周交付"
│        解析: cycle_date = 2026-08-11
│        continuous_progress: { cycle=08-11, progress="6家中完成5家，剩余1家下周交付" }
│        ACT_xxx.last_progress 更新为最新（不覆盖行1）
│
└── W33  推送: task_id = CONT_周例会_2026-08-18__ACT_xxx_2026-08-18
         OA due_date = 2026-08-18
         未回填: wcjgsm = NULL → continuous_progress 不写入
         ACT_xxx.last_progress 保持 W32 的值
```

**统计查询**（某持续项从 8 月到现在的每周进展曲线）：
```sql
SELECT cycle_date, progress, oa_status
FROM hyzs_continuous_progress
WHERE action_id = 'ACT_xxx'
ORDER BY cycle_date ASC;
```

**注意**：系统侧持续项 `due_date` 始终为 NULL。OA 的截止节点（每周五/每月25号等）只作为参数传给 OA 的 `uf_meetingplan.due_date`，**不回写 `hyzs_action_items`**。周期信息从 `task_id` 解析获取，不依赖 OA 回传。

---

## 六、验证命令

```bash
pnpm ts-check
pnpm dev
# 配置页：打开 /settings → 持续项推送配置标签
# 手动触发：
curl -X POST http://localhost:5000/api/continuous/push -H 'Content-Type: application/json' -d '{"meeting_type":"周例会"}'
# 查进展：
curl http://localhost:5000/api/continuous/progress
```

手工验证步骤见 `test.md`。
