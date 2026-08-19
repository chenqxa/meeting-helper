# 操作日志（操作审计）开发文档

> 版本：v1.0  ·  对应需求：`requirement.md`
> 技术栈：Next.js 16 / React 19 / TypeScript 5 / shadcn/ui / Tailwind 4 / SQL Server（mssql）

---

## 一、技术选型

| 层 | 方案 |
|----|------|
| 存储 | 新建 `hyzs_operation_logs` 表（SQL Server），沿用 `mssql` + `parseConnectionString()` |
| 写入 | 服务端 `lib/operation-log.ts` 的 `logOperation()`，在业务 API 路由内调用，**异步 fire-and-forget** |
| 读取 | 扩展现有 `api/operations/route.ts`（GET 加筛选/分页） |
| 展示 | 新建 `app/logs/page.tsx`（admin 查询页）+ 复用 `components/operation-log.tsx`（会议时间线） |

**写入方式说明**：不在前端调 POST 记日志（易被伪造、漏记），而是**后端在业务处理成功后**同步调用 `logOperation()`。失败只 `console.warn`，不影响主流程。

---

## 二、改动点清单

### 2.1 新建文件

| 文件 | 内容 |
|------|------|
| `src/storage/database/operation-log-storage.ts` | 建表迁移 + `createOperationLog()` + `getOperationLogs()` |
| `src/lib/operation-log.ts` | `logOperation()` 助手：取当前用户、组装记录、写库 |
| `src/app/logs/page.tsx` | 日志查询页（admin） |
| `src/app/api/logs/route.ts` | 日志查询接口（分页 + 筛选，admin 校验） |

### 2.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/app/api/actions/[id]/route.ts` | PUT 记录 audit（oa_score 前后值）/status 变更/转派；DELETE 记录删除 |
| `src/app/api/actions/batch/route.ts` | POST 记录批量导入（条数） |
| `src/app/api/actions/batch/[id]/route.ts` | DELETE 记录批次删除 |
| `src/app/api/actions/batch/[id]/push/route.ts` | POST 记录推送 OA |
| `src/app/api/meetings/route.ts` | POST 记录创建会议 |
| `src/app/api/meetings/[id]/route.ts` | PATCH/DELETE 记录编辑/删除会议 |
| `src/app/api/meetings/[id]/lock/route.ts` | POST 记录锁定/解除归档 |
| `src/app/api/meetings/[id]/export/route.ts` | 记录导出（如可定位） |
| `src/app/api/oa/pull-results/route.ts` | POST 记录 OA 同步条数 |
| `src/app/api/operations/route.ts` | 改为走 storage（修复表缺失导致的报错），保留 `meeting_id` 过滤 |
| `src/components/layout/dashboard-layout.tsx` | 侧边栏加「操作日志」入口（admin） |

---

## 三、核心实现

### 3.1 建表（`operation-log-storage.ts`）

沿用项目既有 `ensureTable` 模式（参考 `action-storage.ts:106-107`），首次 `getPool()` 时建表：

```ts
// operation-log-storage.ts
const ensureTable = async (p: sql.ConnectionPool) => {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_operation_logs')
    CREATE TABLE hyzs_operation_logs (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      operator_login_id NVARCHAR(64) NULL,
      operator_name NVARCHAR(64) NULL,
      action NVARCHAR(32) NOT NULL,
      target_type NVARCHAR(32) NULL,
      target_id NVARCHAR(64) NULL,
      summary NVARCHAR(500) NULL,
      detail NVARCHAR(MAX) NULL,
      ip_address NVARCHAR(45) NULL,
      created_at NVARCHAR(30) NOT NULL
    );
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='idx_oplog_time' AND object_id=OBJECT_ID('hyzs_operation_logs'))
      CREATE INDEX idx_oplog_time ON hyzs_operation_logs(created_at DESC);
  `);
};
```

### 3.2 写入助手（`lib/operation-log.ts`）

```ts
// lib/operation-log.ts
import { getCurrentUser } from '@/lib/session';
import { createOperationLog } from '@/storage/database/operation-log-storage';

export interface LogOperationInput {
  action: string;          // audit / status_change / create / delete / import / ...
  targetType?: string;     // action_item / meeting / batch
  targetId?: string;
  summary?: string;
  detail?: { before?: unknown; after?: unknown; changes?: unknown; count?: number; [k: string]: unknown };
}

export async function logOperation(input: LogOperationInput) {
  try {
    const user = await getCurrentUser();
    await createOperationLog({
      operatorLoginId: user?.loginid || null,
      operatorName: user?.name || '未知',
      action: input.action,
      targetType: input.targetType || null,
      targetId: input.targetId || null,
      summary: input.summary || null,
      detail: input.detail ? JSON.stringify(input.detail) : null,
    });
  } catch (e) {
    console.warn('[oplog] 写入失败（不影响主流程）:', e instanceof Error ? e.message : e);
  }
}
```

### 3.3 接入示例（行动项稽核，`api/actions/[id]/route.ts` PUT）

在 `updateActionItem` 成功后对比前后 `oaScore`：

```ts
const existing = await getActionItemById(actionId);
// ... 执行更新得到 updated ...
if (body.oa_score !== undefined && Number(body.oa_score) !== (existing.oaScore ?? null)) {
  await logOperation({
    action: 'audit',
    targetType: 'action_item',
    targetId: updated.id,
    summary: `人工稽核 ${fmt(existing.oaScore)} → ${fmt(updated.oaScore)}：${updated.description?.slice(0, 30)}`,
    detail: { before: existing.oaScore, after: updated.oaScore, description: updated.description },
  });
}
```

### 3.4 查询接口（`api/logs/route.ts` + 扩展 `api/operations/route.ts`）

```ts
// GET /api/logs?operator=&action=&start=&end=&page=&pageSize=
// 仅 admin；走 getOperationLogs({ operator, action, start, end, page, pageSize })
// 复用 OperationLog 组件的 /api/operations?meeting_id= 保持兼容
```

### 3.5 前端日志页（`app/logs/page.tsx`）

- `use client`；进入时 `fetch('/api/auth/me')` 校验 role==='admin'，非 admin 提示无权限。
- 顶部筛选：操作人下拉（`/api/org/employees`）、动作下拉（固定枚举）、时间范围（近7天/近30天/自定义起止）。
- 表格：时间 / 操作人 / 动作 / 对象 / 摘要；行展开显示 `detail` JSON。
- 分页：`WeaverPagination`（每页 20）。

---

## 四、动作类型枚举（前后端约定）

| action | 说明 | target_type |
|--------|------|-------------|
| audit | 人工稽核 V/X/0 设置/清除 | action_item |
| status_change | 状态变更（done/blocked/in_progress） | action_item |
| reassign | 重新派发 | action_item |
| delete | 删除行动项/批次/会议 | action_item/batch/meeting |
| create | 新增行动项 | action_item |
| import | 批量导入 | import |
| batch_push | 批次推送 OA | batch |
| meeting_create / meeting_update / meeting_lock / meeting_unlock | 会议操作 | meeting |
| export | 导出 | meeting |
| oa_sync | OA 结果同步 | system |

---

## 五、字段映射

- `operator_login_id/operator_name` ← `getCurrentUser()`（`lib/session.ts`）。
- `created_at` ← `new Date().toISOString()`。
- `detail` 统一存 JSON 字符串，读取时 `JSON.parse`（兼容 `operation-log.tsx:93` 现有解析）。

---

## 六、已知限制

- 日志只覆盖**服务端写操作**；前端本地行为（如本地排序/筛选）不记录。
- 历史无日志（建表前的操作无法追溯）。
- IP 通过 `request.headers.get('x-forwarded-for')` 取，代理环境下可能为空。

---

## 七、验证命令

```bash
pnpm ts-check        # 类型检查
pnpm dev             # 启动本地验证
```

手工验证步骤见 `test.md`。
