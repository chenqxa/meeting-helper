import * as sql from 'mssql';
import { createHmac, randomUUID } from 'crypto';
import { parseConnectionString } from '@/storage/database/sqlserver-storage';

// priority 字符串 → int
const PRIORITY_MAP: Record<string, number> = { high: 1, medium: 2, low: 3 };
// status 字符串 → int
const STATUS_MAP: Record<string, number> = {
  pending: 0, in_progress: 1, confirmed: 1, done: 2, blocked: 3, cancelled: 3,
};

// source_app → OA 表中显示的条目类型（供负责人一眼区分行动项/持续项）
function itemTypeFromSourceApp(sourceApp: string): string {
  if (sourceApp === 'HYZS_CONT') return '持续项';
  if (sourceApp === 'HYZS') return '行动项';
  return '';
}

// uf_meetingplan 字段
export interface OATaskPayload {
  task_id: string;
  meeting_id: string;
  meeting_title: string;
  meeting_date: string;
  meeting_type?: string;   // 会议类型（写入 OA 表 hylx 字段）
  description: string;
  owner_loginid: string;
  owner_name: string;
  dept_name: string;
  due_date: string;
  priority: string;
  status: string;
  callback_token: string;
  source_app: string;
  zrrxm?: number | null;  // HrmResource.id（负责人在OA的用户ID）
  proposer_name?: string | null;
  proposer_loginid?: string | null;
  tcrxm?: number | null;  // HrmResource.id（提出人在OA的用户ID）
  force?: boolean;         // 强制覆写（解锁后重新锁定时使用）
}

interface ExistingOATaskRow {
  id?: number | null;
  task_id: string;
  meeting_title?: string | null;
  description?: string | null;
  owner_loginid?: string | null;
  owner_name?: string | null;
  dept_name?: string | null;
  due_date?: string | null;
  priority?: number | null;
  status?: number | null;
  wcjgsm?: string | null;
  source_app?: string | null;
}

interface OASyncSummary {
  added: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  skippedProcessedUpdates: number;
  preservedProcessedDeletes: number;
}

function normalizeDate(value?: string | null): string {
  return String(value || '').trim().slice(0, 10);
}

function isProcessedTask(row?: ExistingOATaskRow | null): boolean {
  return !!String(row?.wcjgsm || '').trim();
}

function buildTaskId(sourceId: string, itemId: string): string {
  return `${sourceId}__${itemId}`;
}

// 生成防篡改回调 token
export function genCallbackToken(taskId: string): string {
  const secret = process.env.TASK_CONFIRM_SECRET || 'hyzs-callback-secret';
  return createHmac('sha256', secret).update(taskId).digest('hex').slice(0, 16);
}

// 验证回调 token
export function verifyCallbackToken(taskId: string, token: string): boolean {
  return genCallbackToken(taskId) === token;
}

// 链接服务器名称和 OA 库名
const OA_LINKED = process.env.OA_LINKED_SERVER || 'FWsv';
const OA_DB = process.env.OA_DATABASE_NAME || 'ecology';
// 完整表前缀，如 [FWsv].[ecology].[dbo].
function oaTable(name: string) { return `[${OA_LINKED}].[${OA_DB}].[dbo].[${name}]`; }

// 复用 app 数据库连接池（通过链接服务器访问 OA 表）
let appPool: sql.ConnectionPool | null = null;
export async function getAppPool(): Promise<sql.ConnectionPool> {
  if (appPool && appPool.connected) return appPool;
  appPool = new sql.ConnectionPool({
    ...parseConnectionString(),
    pool: { max: 5, min: 0, idleTimeoutMillis: 60000 },
  });
  appPool.on('error', () => { appPool = null; });
  await appPool.connect();
  return appPool;
}

// 实时查询 OA HrmResource.id，避免使用本地缓存的旧 oaId
export async function resolveHrmIdsByLoginIds(loginids: string[]): Promise<Map<string, string>> {
  const normalized = [...new Set(
    loginids
      .map((loginid) => loginid.trim().toLowerCase())
      .filter(Boolean)
  )];
  const result = new Map<string, string>();
  if (normalized.length === 0) return result;

  try {
    const p = await getAppPool();
    const tbl = oaTable('HrmResource');
    const idList = normalized.map((loginid) => `'${loginid.replace(/'/g, "''")}'`).join(',');
    const res = await p.request().query(
      `SELECT CAST(id AS NVARCHAR(64)) AS oaId, loginid
       FROM ${tbl}
       WHERE status = 1 AND loginid IN (${idList})`
    );
    (res.recordset as any[]).forEach((row) => {
      const loginid = String(row.loginid || '').trim().toLowerCase();
      const oaId = String(row.oaId || '').trim();
      if (loginid && oaId) {
        result.set(loginid, oaId);
      }
    });
  } catch (error) {
    console.warn('[OA] 实时查询 HrmResource.id 失败:', (error as Error).message);
  }

  return result;
}

// 方式一：通过 OA Token API 写入（推荐）
async function pushViaOAApi(task: OATaskPayload, existingOATasks: Map<string, ExistingOATaskRow>, sourceApp: string = 'HYZS'): Promise<void> {
  const oaUrl = process.env.WEAVER_OA_URL!;
  const appid = process.env.WEAVER_OA_APPID!;
  const { getOAToken } = await import('./weaver-sso');
  const token = await getOAToken();

  const priorityInt = PRIORITY_MAP[task.priority] ?? 2;
  const statusInt = STATUS_MAP[task.status] ?? 0;

  const existingTask = existingOATasks.get(task.task_id);
  const isUpdate = !!existingTask;
  const isProcessed = isUpdate && (existingTask.status ?? 0) >= 1;

  if (isProcessed && !task.force) {
    console.log(`[OA API] task ${task.task_id} OA状态=${existingTask.status}（已处理），跳过不覆盖`);
    return;
  }

  const payload: any = {
    task_id: task.task_id,
    meeting_id: task.meeting_id,
    meeting_title: task.meeting_title,
    meeting_date: task.meeting_date.slice(0, 10),
    description: task.description,
    owner_loginid: task.owner_loginid,
    owner_name: task.owner_name,
    dept_name: task.dept_name,
    due_date: task.due_date ? task.due_date.slice(0, 10) : '',
    priority: priorityInt,
    callback_token: task.callback_token,
    source_app: sourceApp,
    item_type: itemTypeFromSourceApp(sourceApp),
    hylx: task.meeting_type || '',
    xdxlx: itemTypeFromSourceApp(sourceApp),
    zrrxm: task.zrrxm ?? null,
  };

  if (isUpdate && existingTask?.id) {
    payload.id = existingTask.id;
  }

  if (!isUpdate || task.force) {
    payload.status = statusInt;
    payload.remindflag = 0;
  } else {
    payload.remindflag = 0;
  }

  const body = {
    formid: -197,
    datas: [payload],
  };

  const res = await fetch(`${oaUrl}/api/ec/dev/formmodelext/saveOrUpdateData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', appid, token },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  console.log(`[OA API] ${res.status}`, text.slice(0, 300));

  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`OA返回非JSON(${res.status}): ${text.slice(0, 200)}`); }
  if (data.code !== 0 && data.status !== true && data.success !== true) {
    throw new Error(`OA API失败: ${data.msg || data.message || JSON.stringify(data).slice(0, 100)}`);
  }
}

// 方式二：通过链接服务器直接写入（备用）
async function pushViaSql(task: OATaskPayload): Promise<void> {
  const p = await getAppPool();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8);
  const priorityInt = PRIORITY_MAP[task.priority] ?? 2;
  const statusInt = STATUS_MAP[task.status] ?? 0;
  const tbl = oaTable('uf_meetingplan');
  const uuid = randomUUID();
  const esc = (v: string) => String(v ?? '').replace(/'/g, "''");
  const srcApp = task.source_app || 'HYZS';

  // 防御性列探测：tcrxm / proposer_name / proposer_loginid / item_type / hylx / xdxlx 列若不存在则忽略
  const colInfo = await p.request().query(`
    SELECT
      COL_LENGTH('${esc(OA_DB)}.dbo.uf_meetingplan','tcrxm') AS tcrxm,
      COL_LENGTH('${esc(OA_DB)}.dbo.uf_meetingplan','proposer_name') AS proposer_name,
      COL_LENGTH('${esc(OA_DB)}.dbo.uf_meetingplan','proposer_loginid') AS proposer_loginid,
      COL_LENGTH('${esc(OA_DB)}.dbo.uf_meetingplan','item_type') AS item_type,
      COL_LENGTH('${esc(OA_DB)}.dbo.uf_meetingplan','hylx') AS hylx,
      COL_LENGTH('${esc(OA_DB)}.dbo.uf_meetingplan','xdxlx') AS xdxlx
  `);
  const hasTcrxm = !!(colInfo.recordset?.[0]?.tcrxm);
  const hasProposerName = !!(colInfo.recordset?.[0]?.proposer_name);
  const hasProposerLoginid = !!(colInfo.recordset?.[0]?.proposer_loginid);
  const hasItemType = !!(colInfo.recordset?.[0]?.item_type);
  const hasHylx = !!(colInfo.recordset?.[0]?.hylx);
  const hasXdxlx = !!(colInfo.recordset?.[0]?.xdxlx);
  const itemTypeVal = itemTypeFromSourceApp(srcApp);
  const hylxVal = task.meeting_type || '';

  // 描述前缀：把"提出人"信息补在前面，方便责任人在 OA 里直接看到上下文
  const descWithProposer = task.proposer_name
    ? `[提出人: ${task.proposer_name}] ${task.description}`
    : task.description;

  // 检查是否已存在及当前 OA 状态
  const exist = await p.request().query(
    `SELECT id, status, zrrxm, wcjgsm FROM ${tbl} WHERE task_id = '${esc(task.task_id)}'`
  );

  if (exist.recordset.length > 0) {
    const oaStatus = exist.recordset[0].status ?? 0;
    const existingZrrxm = exist.recordset[0].zrrxm;
    const existingWcjgsm = String(exist.recordset[0].wcjgsm || '').trim();
    if (existingWcjgsm && !task.force) {
      console.log(`[OA SQL] task ${task.task_id} 已有完成说明（已处理），跳过不覆盖`);
      return;
    }

    // 若旧记录 zrrxm=NULL 而现在有值，DELETE+INSERT 重建 OA 用户索引
    // （直接 UPDATE zrrxm 不会触发 OA 的用户关联索引，导致负责人列仍显示空）
    if (existingZrrxm == null && task.zrrxm != null) {
      console.log(`[OA SQL] task ${task.task_id} zrrxm NULL→${task.zrrxm}，执行 DELETE+INSERT 重建用户关联`);
      await p.request().query(`DELETE FROM ${tbl} WHERE task_id = '${esc(task.task_id)}'`);
    } else {
      const extraSet = [
        hasProposerName ? `proposer_name = N'${esc(task.proposer_name || '')}',` : '',
        hasProposerLoginid ? `proposer_loginid = '${esc(task.proposer_loginid || '')}',` : '',
        hasTcrxm ? `tcrxm = ${task.tcrxm != null ? task.tcrxm : 'NULL'},` : '',
        (hasItemType && itemTypeVal) ? `item_type = N'${esc(itemTypeVal)}',` : '',
        hasHylx ? `hylx = N'${esc(hylxVal)}',` : '',
        (hasXdxlx && itemTypeVal) ? `xdxlx = N'${esc(itemTypeVal)}',` : '',
      ].filter(Boolean).join('\n          ');
      await p.request().query(`
        UPDATE ${tbl} SET
          meeting_title          = N'${esc(task.meeting_title)}',
          meeting_date           = '${esc(task.meeting_date.slice(0, 10))}',
          description            = N'${esc(descWithProposer)}',
          owner_loginid          = '${esc(task.owner_loginid)}',
          owner_name             = N'${esc(task.owner_name)}',
          dept_name              = N'${esc(task.dept_name)}',
          due_date               = '${esc(task.due_date ? task.due_date.slice(0, 10) : '')}',
          priority               = ${priorityInt},
          remindflag             = 0,
          ${task.force ? `status = 0,` : ''}
          zrrxm                  = ${task.zrrxm != null ? task.zrrxm : 'NULL'},
          ${extraSet}
          callback_token         = '${esc(task.callback_token)}',
          modedatamodifydatetime = '${esc(dateStr + ' ' + timeStr)}'
        WHERE task_id = '${esc(task.task_id)}'
      `);
      console.log(`[OA SQL] task ${task.task_id} 已更新 uf_meetingplan (remindflag重置为0)`);
      return;
    }
  }

  // 不存在则 INSERT
  const extraCols = [
    hasProposerName ? 'proposer_name,' : '',
    hasProposerLoginid ? 'proposer_loginid,' : '',
    hasTcrxm ? 'tcrxm,' : '',
    (hasItemType && itemTypeVal) ? 'item_type,' : '',
    hasHylx ? 'hylx,' : '',
    hasXdxlx ? 'xdxlx,' : '',
  ].filter(Boolean).join('');
  const extraVals = [
    hasProposerName ? `N'${esc(task.proposer_name || '')}',` : '',
    hasProposerLoginid ? `'${esc(task.proposer_loginid || '')}',` : '',
    hasTcrxm ? `${task.tcrxm != null ? task.tcrxm : 'NULL'},` : '',
    (hasItemType && itemTypeVal) ? `N'${esc(itemTypeVal)}',` : '',
    hasHylx ? `N'${esc(hylxVal)}',` : '',
    (hasXdxlx && itemTypeVal) ? `N'${esc(itemTypeVal)}',` : '',
  ].filter(Boolean).join('');
  await p.request().query(`
    INSERT INTO ${tbl}
      (formmodeid, form_biz_id, MODEUUID,
       modedatacreater, modedatacreatertype,
       modedatacreatedate, modedatacreatetime, modedatamodifier, modedatamodifydatetime,
       task_id, meeting_id, meeting_title, meeting_date, description,
       owner_loginid, owner_name, dept_name, due_date,
       priority, status, remindflag, zrrxm,
       ${extraCols}
       callback_token, source_app)
    VALUES
      (90, '1000197', '${esc(uuid)}',
       0, 0, '${esc(dateStr)}', '${esc(timeStr)}', 0, '${esc(dateStr + ' ' + timeStr)}',
       '${esc(task.task_id)}', '${esc(task.meeting_id)}', N'${esc(task.meeting_title)}',
       '${esc(task.meeting_date.slice(0, 10))}', N'${esc(descWithProposer)}',
       '${esc(task.owner_loginid)}', N'${esc(task.owner_name)}', N'${esc(task.dept_name)}',
       '${esc(task.due_date ? task.due_date.slice(0, 10) : '')}',
       ${priorityInt}, ${statusInt}, 0,
       ${task.zrrxm != null ? task.zrrxm : 'NULL'},
       ${extraVals}
       '${esc(task.callback_token)}', '${esc(srcApp)}')
  `);
  console.log(`[OA SQL] task ${task.task_id} 新增写入 uf_meetingplan`);
}

// 主推送函数：优先用 OA API，失败则降级到链接服务器 SQL
async function pushOneTask(task: OATaskPayload, existingOATasks: Map<string, ExistingOATaskRow>): Promise<void> {
  await pushViaSql(task);
}

// 检查会议的 OA 行动项是否允许解锁
// 判断标准：OA 中已有回传内容（wcjgsm 不为空）才算已处理，仅有 status>=1 不阻止解锁
export async function checkOATasksCanUnlock(
  taskIds: string[]
): Promise<{ canUnlock: boolean; blockedTasks: string[] }> {
  if (!taskIds.length) return { canUnlock: true, blockedTasks: [] };
  try {
    const p = await getAppPool();
    const tbl = oaTable('uf_meetingplan');
    const idList = taskIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
    // 只有 OA 中填写了完成说明（wcjgsm）才视为已处理，阻止解锁
    const res = await p.request().query(
      `SELECT task_id FROM ${tbl}
       WHERE task_id IN (${idList})
         AND wcjgsm IS NOT NULL AND LTRIM(RTRIM(wcjgsm)) != ''`
    );
    const blockedTasks: string[] = res.recordset.map((r: any) => r.task_id);
    return { canUnlock: blockedTasks.length === 0, blockedTasks };
  } catch (e) {
    console.warn('[OA] checkOATasksCanUnlock 查询失败（允许解锁）:', (e as Error).message);
    return { canUnlock: true, blockedTasks: [] };
  }
}

// 删除会议对应的所有 OA 行动项记录（会议删除时调用）
export async function deleteOATasksBySourceId(sourceId: string): Promise<{ deleted: number }> {
  try {
    const p = await getAppPool();
    const tbl = oaTable('uf_meetingplan');
    const safe = sourceId.replace(/'/g, "''");
    const result = await p.request().query(
      `DELETE FROM ${tbl} WHERE task_id LIKE '${safe}__%'`
    );
    const deleted = (result.rowsAffected?.[0] ?? 0);
    console.log(`[OA Delete] 已删除 ${sourceId} 的 ${deleted} 条 OA 行动项`);
    return { deleted };
  } catch (e) {
    console.warn('[OA Delete] 删除OA行动项失败（不影响会议删除）:', (e as Error).message);
    return { deleted: 0 };
  }
}

async function getExistingOATasksBySourceId(sourceId: string): Promise<Map<string, ExistingOATaskRow>> {
  const rows = new Map<string, ExistingOATaskRow>();
  const p = await getAppPool();
  const tbl = oaTable('uf_meetingplan');
  const safe = sourceId.replace(/'/g, "''");
  // 包含被作废的记录（source_app='HYZS_CANCELLED'），以便：
  // 1. 内容相同时识别为"无变化"而非重复新增
  // 2. 需要时重新激活（reset remindflag）
  const result = await p.request().query(`
    SELECT id, task_id, meeting_title, description, owner_loginid, owner_name, dept_name, due_date, priority, status, wcjgsm, source_app
    FROM ${tbl}
    WHERE task_id LIKE '${safe}__%'
  `);
  for (const row of result.recordset as ExistingOATaskRow[]) {
    const taskId = String(row.task_id || '').trim();
    if (taskId) rows.set(taskId, row);
  }
  return rows;
}

function isSameAsExistingTask(task: OATaskPayload, row?: ExistingOATaskRow | null): boolean {
  if (!row) return false;
  // OA 存储的描述实际带有 [提出人: xxx] 前缀，payload 的 description 不带，
  // 二者都去掉前缀再比对，避免每次全量更新
  const stripProposerPrefix = (s: string) => s.replace(/^\[提出人:[^\]]+\]\s*/, '');
  const fields = {
    meeting_title: String(row.meeting_title || '') === String(task.meeting_title || ''),
    description: stripProposerPrefix(String(row.description || '')) === String(task.description || ''),
    owner_loginid: String(row.owner_loginid || '') === String(task.owner_loginid || ''),
    owner_name: String(row.owner_name || '') === String(task.owner_name || ''),
    dept_name: String(row.dept_name || '') === String(task.dept_name || ''),
    due_date: normalizeDate(row.due_date) === normalizeDate(task.due_date),
    priority: Number(row.priority ?? 2) === (PRIORITY_MAP[task.priority] ?? 2),
  };
  const allMatch = Object.values(fields).every(Boolean);
  if (!allMatch) {
    const diffs = Object.entries(fields).filter(([,v]) => !v).map(([k]) => k);
    console.log(`[OA Push] isSameAsExistingTask false for task ${task.task_id}: 差异字段=[${diffs.join(',')}]`);
  }
  return allMatch;
}

async function cancelOATask(taskId: string, _existing: ExistingOATaskRow): Promise<void> {
  const p = await getAppPool();
  const tbl = oaTable('uf_meetingplan');
  const esc = (v: string) => String(v ?? '').replace(/'/g, "''");
  const safeTaskId = esc(taskId);
  await p.request().query(`
    UPDATE ${tbl}
    SET source_app = 'HYZS_CANCELLED', remindflag = 0
    WHERE task_id = '${safeTaskId}'
  `);
  console.log(`[OA SQL Cancel] ✓ ${taskId} 标记为已取消(source_app=HYZS_CANCELLED)`);
}

// 批量推送会议的所有行动项
export async function pushTasksToOA(
  source: {
    id: string;
    title: string;
    date: string;
    actionItems?: any[];
    sourceApp?: string;
    meetingType?: string;
  },
  force = false
): Promise<{ pushed: number; failed: number; errors: string[]; summary: OASyncSummary; notices: string[] }> {
  const items = source.actionItems || [];
  const sourceApp = source.sourceApp || 'HYZS';
  let pushed = 0;
  let failed = 0;
  const errors: string[] = [];
  const notices: string[] = [];
  const summary: OASyncSummary = {
    added: 0,
    updated: 0,
    cancelled: 0,
    unchanged: 0,
    skippedProcessedUpdates: 0,
    preservedProcessedDeletes: 0,
  };

  // ── 第一步：补全缺失的 ownerLoginId（按姓名反查 HrmResource.loginid）──
  // 同时检查 owner 和 assignee 字段，防止字段名不一致导致漏查
  const nameLoginidCache = new Map<string, string>();
  const proposerLoginidCache = new Map<string, string>();
  const itemOwnerName = (i: any): string => (i.owner || i.assignee || '').trim();
  const itemProposerName = (i: any): string => (i.proposer || '').trim();
  const needResolve = items.filter((i: any) => !i.ownerLoginId && itemOwnerName(i));
  const needResolveProposer = items.filter((i: any) => !i.proposerLoginId && itemProposerName(i));
  console.log(`[OA Push] 开始推送 ${items.length} 条，需反查 owner loginid ${needResolve.length} 条，需反查 proposer loginid ${needResolveProposer.length} 条`);
  items.forEach((i: any, idx: number) => {
    console.log(`[OA Push][item${idx+1}] owner="${i.owner}" assignee="${i.assignee}" ownerLoginId="${i.ownerLoginId}" dept="${i.dept}" proposer="${i.proposer}" proposerLoginId="${i.proposerLoginId}"`);
  });
  if (needResolve.length > 0 || needResolveProposer.length > 0) {
    try {
      // 复用 searchOAUsers（LIKE模糊查，与 match-owners 逻辑一致，已验证可用）
      const { searchOAUsers } = await import('./weaver-notify');
      const ownerNames = [...new Set(needResolve.map(itemOwnerName))];
      const proposerNames = [...new Set(needResolveProposer.map(itemProposerName))];
      await Promise.all([
        ...ownerNames.map(async (name) => {
          const results = await searchOAUsers(name);
          if (results.length > 0) {
            const exact = results.find(u => u.lastname === name) || results[0];
            nameLoginidCache.set(name, exact.loginid);
            console.log(`[OA Push] 姓名反查 owner: "${name}" → "${exact.loginid}" (${exact.lastname})`);
          } else {
            console.warn(`[OA Push] 未能解析 owner loginid: "${name}" - OA中未找到对应用户`);
          }
        }),
        ...proposerNames.map(async (name) => {
          const results = await searchOAUsers(name);
          if (results.length > 0) {
            const exact = results.find(u => u.lastname === name) || results[0];
            proposerLoginidCache.set(name, exact.loginid);
            console.log(`[OA Push] 姓名反查 proposer: "${name}" → "${exact.loginid}" (${exact.lastname})`);
          } else {
            console.warn(`[OA Push] 未能解析 proposer loginid: "${name}" - OA中未找到对应用户`);
          }
        }),
      ]);
    } catch (e) {
      console.warn('[OA Push] 姓名反查loginid失败:', (e as Error).message);
    }
  }

  // ── 第二步：批量预查 HrmResource.id（loginid → OA用户id），填充 zrrxm 字段 ──
  const hrmIdMap = new Map<string, number>();
  const resolvedItems = items.map((i: any) => {
    const name = itemOwnerName(i);
    const proposerName = itemProposerName(i);
    const resolvedLoginId = i.ownerLoginId || nameLoginidCache.get(name) || '';
    const resolvedProposerLoginId = i.proposerLoginId || proposerLoginidCache.get(proposerName) || '';
    if (!i.ownerLoginId && resolvedLoginId) {
      console.log(`[OA Push] 解析 loginid: "${name}" → "${resolvedLoginId}"`);
    } else if (!resolvedLoginId && name) {
      console.warn(`[OA Push] 未能解析 loginid: "${name}" - OA中未找到对应用户`);
    }
    return {
      ...i,
      ownerLoginId: resolvedLoginId,
      proposerLoginId: resolvedProposerLoginId,
      _resolvedName: name,
    };
  });
  const loginids = [...new Set([
    ...resolvedItems.map((i: any) => i.ownerLoginId),
    ...resolvedItems.map((i: any) => i.proposerLoginId),
  ].filter(Boolean))];
  if (loginids.length > 0) {
    try {
      const p = await getAppPool();
      const tbl = oaTable('HrmResource');
      const idList = (loginids as string[]).map(id => `'${id.replace(/'/g, "''")}'`).join(',');
      const res = await p.request().query(
        `SELECT id, loginid FROM ${tbl} WHERE loginid IN (${idList})`
      );
      (res.recordset as any[]).forEach(r => hrmIdMap.set(r.loginid, r.id));
      console.log(`[OA Push] 预查HrmResource: ${hrmIdMap.size}/${loginids.length} 条命中`);
    } catch (e) {
      console.warn('[OA Push] 预查HrmResource失败，zrrxm/tcrxm将写NULL:', (e as Error).message);
    }
  }

  const existingOATasks = await getExistingOATasksBySourceId(source.id);
  console.log(`[OA Push] OA已有记录: ${existingOATasks.size} 条, keys=[${[...existingOATasks.keys()].join(', ')}]`);
  const desiredTaskIds = new Set<string>();
  const pushPromises: Promise<{ taskId: string; ok: boolean; added: boolean; error?: string }>[] = [];
  const cancelTaskIds: string[] = [];

  for (const item of resolvedItems) {
    const itemId = String(item.id || '').trim() || String(Date.now());
    const taskId = buildTaskId(source.id, itemId);
    desiredTaskIds.add(taskId);
    const existing = existingOATasks.get(taskId);
    const payload: OATaskPayload = {
      task_id: taskId,
      meeting_id: source.id,
      meeting_title: source.title,
      meeting_date: source.date,
      meeting_type: source.meetingType,
      description: item.description || '',
      owner_loginid: item.ownerLoginId || '',
      owner_name: item.owner || item.assignee || '',
      dept_name: item.dept || '',
      due_date: item.due_date || item.dueDate || '',
      priority: item.priority || 'medium',
      status: 'pending',
      callback_token: genCallbackToken(taskId),
      source_app: sourceApp,
      zrrxm: hrmIdMap.get(item.ownerLoginId || '') ?? null,
      proposer_name: item.proposer || null,
      proposer_loginid: item.proposerLoginId || null,
      tcrxm: item.proposerLoginId ? (hrmIdMap.get(item.proposerLoginId) ?? null) : null,
      force,
    };

    if (existing && isSameAsExistingTask(payload, existing)) {
      // 内容无变化，但如果是被作废的记录，需要重新激活
      if (existing.source_app === 'HYZS_CANCELLED') {
        console.log(`[OA Push] ${taskId} 内容无变化，但之前被作废，重新激活`);
        try {
          const p = await getAppPool();
          const tbl = oaTable('uf_meetingplan');
          const safeTaskId = taskId.replace(/'/g, "''");
          await p.request().query(`UPDATE ${tbl} SET source_app = '${sourceApp.replace(/'/g, "''")}', remindflag = 0 WHERE task_id = '${safeTaskId}'`);
          summary.updated++;
        } catch (e) {
          console.warn(`[OA Push] ${taskId} 重新激活失败:`, (e as Error).message);
          summary.unchanged++;
        }
      } else {
        console.log(`[OA Push] ${taskId} 内容无变化，跳过`);
        summary.unchanged++;
      }
      continue;
    }

    if (existing && isProcessedTask(existing)) {
      console.log(`[OA Push] ${taskId} 已处理(wcjgsm="${existing.wcjgsm}")，跳过不覆盖`);
      summary.skippedProcessedUpdates++;
      notices.push(`已处理项保留未覆盖：${payload.owner_name || '未指定责任人'} / ${payload.description || taskId}`);
      continue;
    }

    const isAdd = !existing;
    pushPromises.push(
      pushOneTask(payload, existingOATasks).then(
        () => ({ taskId, ok: true, added: isAdd }),
        (e: Error) => ({ taskId, ok: false, added: isAdd, error: e.message }),
      ),
    );
  }

  for (const [taskId, existing] of existingOATasks.entries()) {
    if (desiredTaskIds.has(taskId)) continue;

    if (isProcessedTask(existing)) {
      summary.preservedProcessedDeletes++;
      notices.push(`已处理删除项保留：${existing.owner_name || '未指定责任人'} / ${existing.description || taskId}`);
      continue;
    }

    cancelTaskIds.push(taskId);
  }

  const pushResults = await Promise.allSettled(pushPromises);
  for (const r of pushResults) {
    if (r.status === 'fulfilled') {
      const { taskId, ok, added, error } = r.value;
      if (ok) {
        console.log(`[OA Push] ✓ ${taskId}`);
        if (added) summary.added++; else summary.updated++;
        pushed++;
      } else {
        failed++;
        errors.push(`${taskId}: ${error}`);
        console.error('[OA Push] 推送失败:', taskId, error);
      }
    } else {
      failed++;
      errors.push(`推送异常: ${r.reason}`);
    }
  }

  if (cancelTaskIds.length > 0) {
    try {
      const p = await getAppPool();
      const tbl = oaTable('uf_meetingplan');
      const esc = (v: string) => v.replace(/'/g, "''");
      const idList = cancelTaskIds.map(id => `'${esc(id)}'`).join(',');
      await p.request().query(`
        UPDATE ${tbl}
        SET source_app = 'HYZS_CANCELLED', remindflag = 0
        WHERE task_id IN (${idList})
      `);
      summary.cancelled = cancelTaskIds.length;
      console.log(`[OA SQL Cancel] ✓ 批量作废 ${cancelTaskIds.length} 条: ${cancelTaskIds.join(', ')}`);
    } catch (e) {
      const errMsg = (e as Error).message;
      for (const tid of cancelTaskIds) {
        notices.push(`OA清理失败（不影响推送）：${tid} - ${errMsg}`);
      }
      console.warn('[OA SQL Cancel] 批量作废失败:', errMsg);
    }
  }

  return { pushed, failed, errors, summary, notices };
}

export async function pushMeetingTasksToOA(
  meeting: {
    id: string;
    title: string;
    meetingDate: string;
    type?: string;
    actionItems?: any[];
  },
  force = false
): Promise<{ pushed: number; failed: number; errors: string[]; summary: OASyncSummary; notices: string[] }> {
  return pushTasksToOA({ id: meeting.id, title: meeting.title, date: meeting.meetingDate, meetingType: meeting.type, actionItems: meeting.actionItems }, force);
}

export async function deleteOATasksByMeetingId(meetingId: string): Promise<{ deleted: number }> {
  return deleteOATasksBySourceId(meetingId);
}
