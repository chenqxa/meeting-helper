// 必须在 import next 之前加载，否则 Next.js 16 找不到 globalThis.AsyncLocalStorage
import 'next/dist/server/node-environment-baseline';
import dotenv from 'dotenv';
// 先加载 .env，再加载本地开发覆盖（.env.development.local 优先级最高，必须最后加载）
// 避免本地 dev 时 NEXT_PUBLIC_APP_URL 指向生产域名导致跳转
dotenv.config();
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '.env.development', override: true });
  dotenv.config({ path: '.env.development.local', override: true });
}
import { existsSync, watchFile } from 'fs';
import { createServer, IncomingMessage } from 'http';
import path from 'path';
import { parse } from 'url';
import next from 'next';
import { WebSocket, WebSocketServer } from 'ws';
import { sendScheduledTodos } from '@/lib/todo-push';
import { pushContinuousByType } from '@/lib/continuous-push';
import { getBeijingParts } from '@/lib/beijing-time';
import { getCadenceConfigs, updateCadenceConfig } from '@/storage/database/cadence-storage';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

const TODO_PUSH_ENABLED = process.env.CHAT_TODO_PUSH_ENABLED === 'true';
const TODO_PUSH_TIMES = (process.env.CHAT_TODO_PUSH_TIMES || '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const TODO_PUSH_PROJECT_ID = process.env.CHAT_TODO_PUSH_PROJECT_ID || undefined;
const TODO_PUSH_FORMAT = process.env.CHAT_TODO_PUSH_FORMAT === 'card' ? 'card' : 'text';
const TODO_PUSH_MAX_ITEMS = process.env.CHAT_TODO_PUSH_MAX_ITEMS
  ? parseInt(process.env.CHAT_TODO_PUSH_MAX_ITEMS, 10)
  : undefined;
const TODO_PUSH_INCLUDE_HEADER = process.env.CHAT_TODO_INCLUDE_HEADER !== 'false';
const TODO_PUSH_ID_PREFIX = process.env.CHAT_TODO_PUSH_ID_PREFIX || undefined;
const TODO_PUSH_RUN_ON_START = process.env.CHAT_TODO_PUSH_RUN_ON_START === 'true';

function formatDbTarget(connectionString?: string): string | null {
  const raw = (connectionString || '').trim();
  if (!raw) return null;

  if (raw.startsWith('mssql://') || raw.startsWith('sqlserver://')) {
    try {
      const normalized = raw.replace(/^sqlserver/, 'mssql');
      const url = new URL(normalized);
      const host = url.hostname || 'unknown-host';
      const port = url.port || '1433';
      const database = url.pathname.replace(/^\//, '') || 'unknown-db';
      return `${host}:${port}/${database}`;
    } catch {
      return 'configured';
    }
  }

  const pairs: Record<string, string> = {};
  raw.split(';').forEach((part) => {
    const [key, ...value] = part.split('=');
    if (key) pairs[key.trim().toLowerCase()] = value.join('=').trim();
  });

  let server = pairs['server'] || pairs['data source'] || 'unknown-host';
  let port = pairs['port'] || '1433';
  const database = pairs['database'] || pairs['initial catalog'] || 'unknown-db';
  const commaIdx = server.lastIndexOf(',');
  if (commaIdx > 0) {
    port = server.slice(commaIdx + 1) || port;
    server = server.slice(0, commaIdx);
  }
  return `${server}:${port}/${database}`;
}

function formatHttpTarget(urlLike?: string): string | null {
  const raw = (urlLike || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw;
  }
}

function setupEnvRestartReminder() {
  if (!dev) return;

  const envFiles = ['.env', '.env.local']
    .map((name) => path.join(process.cwd(), name))
    .filter((filePath) => existsSync(filePath));

  if (envFiles.length === 0) return;

  console.log(
    `[Env] 已加载环境文件: ${envFiles.map((filePath) => path.basename(filePath)).join(', ')}。修改这些文件后，需要手动重启 \`pnpm dev\` 才会生效。`
  );

  const dbTarget = formatDbTarget(process.env.DATABASE_URL);
  const oaTarget = formatHttpTarget(process.env.WEAVER_OA_URL);
  const chatAdminTarget = formatHttpTarget(process.env.CHAT_ADMIN_API_BASE_URL);
  const chatApiTarget = formatHttpTarget(process.env.CHAT_API_BASE_URL);

  const activeTargets = [
    dbTarget ? `DATABASE_URL -> ${dbTarget}` : null,
    oaTarget ? `WEAVER_OA_URL -> ${oaTarget}` : null,
    chatAdminTarget ? `CHAT_ADMIN_API_BASE_URL -> ${chatAdminTarget}` : null,
    chatApiTarget ? `CHAT_API_BASE_URL -> ${chatApiTarget}` : null,
  ].filter(Boolean);

  if (activeTargets.length > 0) {
    console.log(`[Env] 当前生效目标: ${activeTargets.join(' | ')}`);
  }

  const lastWarnedMtime = new Map<string, number>();

  for (const filePath of envFiles) {
    watchFile(filePath, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs === 0 || curr.mtimeMs === prev.mtimeMs) return;
      if (lastWarnedMtime.get(filePath) === curr.mtimeMs) return;
      lastWarnedMtime.set(filePath, curr.mtimeMs);
      console.warn(
        `[Env] 检测到 ${path.basename(filePath)} 已变更，但当前 dev 进程不会自动重新加载环境变量。请手动重启 \`pnpm dev\`。`
      );
    });
  }
}

// ── 组织架构自动同步 ──────────────────────────────────────────

async function runOrgSync() {
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!secret) {
    console.log('[OrgSync] 未配置 INTERNAL_SYNC_SECRET，跳过自动同步');
    return;
  }
  const url = `http://localhost:${port}/api/org/sync-db`;
  try {
    console.log(`[OrgSync] 开始同步组织架构... (${new Date().toLocaleString()})`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-sync-token': secret },
    });
    const r = await res.json();
    if (r.success) {
      const d = r.data;
      console.log(`[OrgSync] 同步完成 — 部门: +${d.departments.created} ~${d.departments.updated} -${d.departments.deleted} | 员工: +${d.employees.created} ~${d.employees.updated} 换部门:${d.employees.deptChanged} 离职:${d.employees.resigned}`);
    } else {
      console.error('[OrgSync] 同步失败:', r.error);
    }
  } catch (err) {
    console.error('[OrgSync] 同步异常:', err instanceof Error ? err.message : err);
  }
}

function scheduleDailySync() {
  const now = new Date();
  const next2am = new Date();
  next2am.setHours(2, 0, 0, 0);
  if (next2am <= now) next2am.setDate(next2am.getDate() + 1);
  const delay = next2am.getTime() - now.getTime();
  const h = Math.floor(delay / 3600000);
  const m = Math.floor((delay % 3600000) / 60000);
  console.log(`[OrgSync] 下次自动同步: ${next2am.toLocaleString()}（${h}小时${m}分钟后）`);
  setTimeout(async () => {
    await runOrgSync();
    scheduleDailySync();
  }, delay);
}

// ── 待办自动推送 ───────────────────────────────────────────────

function computeNextFire(time: string): Date | null {
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

let todoPushRunning = false;

async function runTodoPush(triggerLabel: string) {
  if (!TODO_PUSH_ENABLED) return;
  if (todoPushRunning) {
    console.warn(`[TodoPush] 上一次推送仍在进行中，跳过本次触发(${triggerLabel})`);
    return;
  }
  todoPushRunning = true;
  console.log(`[TodoPush] 开始推送待办（${triggerLabel}）`);
  const startedAt = Date.now();
  try {
    const result = await sendScheduledTodos({
      projectId: TODO_PUSH_PROJECT_ID,
      format: TODO_PUSH_FORMAT,
      maxItems: TODO_PUSH_MAX_ITEMS,
      scheduleLabel: triggerLabel,
      idempotencyPrefix: TODO_PUSH_ID_PREFIX,
      includeHeader: TODO_PUSH_INCLUDE_HEADER,
    });
    console.log(
      `[TodoPush] 推送完成 — 收件人:${result.totalRecipients} 已发:${result.sent} 失败:${result.failures} 耗时:${Math.round((Date.now() - startedAt) / 1000)}s`
    );
    if (result.failures > 0) {
      console.warn('[TodoPush] 发送失败详情:', result.details.filter((d) => !d.sent));
    }
  } catch (error) {
    console.error('[TodoPush] 推送异常:', error instanceof Error ? error.message : error);
  } finally {
    todoPushRunning = false;
  }
}

function scheduleTodoPushForTime(time: string) {
  const label = `daily-${time.replace(/[^0-9]/g, '') || 'default'}`;

  const scheduleNext = () => {
    const nextFire = computeNextFire(time);
    if (!nextFire) {
      console.warn(`[TodoPush] 无法解析时间配置: ${time}`);
      return;
    }
    const delay = nextFire.getTime() - Date.now();
    const hours = Math.floor(delay / 3600000);
    const minutes = Math.floor((delay % 3600000) / 60000);
    console.log(
      `[TodoPush] 下次推送(${time}): ${nextFire.toLocaleString()}（${hours}小时${minutes}分钟后）`
    );
    setTimeout(async () => {
      await runTodoPush(label);
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

function scheduleTodoPush() {
  if (!TODO_PUSH_ENABLED) {
    console.log('[TodoPush] 未启用自动推送（CHAT_TODO_PUSH_ENABLED != true）');
    return;
  }
  if (TODO_PUSH_TIMES.length === 0) {
    console.warn('[TodoPush] 未配置推送时间（CHAT_TODO_PUSH_TIMES），跳过调度');
    return;
  }

  TODO_PUSH_TIMES.forEach((time) => scheduleTodoPushForTime(time));
}

// ── OA 完成结果定时拉取 ──────────────────────────────────────────

const OA_PULL_INTERVAL_MS = parseInt(process.env.OA_PULL_INTERVAL_MIN || '30', 10) * 60 * 1000;

// ── OA 回拉完整调度器 ──
// 特性：cron 表达式 / 间隔兜底 / 增量游标 / 失败重试退避 / 连续失败告警 / 防抖
import { Cron } from 'croner';
import {
  getOaPullConfig, updateOaPullRuntime, recordRunStart, recordRunFinish,
} from '@/storage/database/oa-pull-config-storage';

let oaPullJob: Cron | null = null;
let oaPullRunning = false;          // 防抖：上次未结束则跳过
let oaPullRetries = 0;              // 当前失败重试次数
let oaPullRetryTimer: ReturnType<typeof setTimeout> | null = null;

async function notifyOaPullAlert(config: any, error: string) {
  try {
    const recipients = (config?.alertRecipients || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    if (recipients.length === 0) return;
    const { resolveUserIdsByNames, sendTextCardMessage } = await import('@/lib/wecom-message');
    const idMap = await resolveUserIdsByNames(recipients, false);
    const userIds = Array.from(idMap.values());
    if (userIds.length === 0) return;
    await sendTextCardMessage(
      userIds,
      '⚠️ OA 回拉连续失败告警',
      `连续 ${config.consecutiveFails} 次同步失败\n最近错误：${error}\n\n请检查 OA 服务或数据库连接。`,
      '',
    );
  } catch (e) {
    console.warn('[OAPull] 告警发送失败:', e instanceof Error ? e.message : e);
  }
}

// 执行一次回拉（带运行记录 + 失败计数 + 重试退避）
async function executeOaPull(mode: 'scheduled' | 'manual' | 'startup' | 'retry' = 'scheduled') {
  if (oaPullRunning) {
    console.log('[OAPull] 上次回拉未结束，跳过本次（防抖）');
    return;
  }
  oaPullRunning = true;
  let run: Awaited<ReturnType<typeof recordRunStart>> | null = null;
  try {
    const cfg = await getOaPullConfig();
    // 总开关关闭：除管理员手动触发外一律跳过（填报已在系统内完成，不再从 OA 回拉）
    if (!cfg.enabled && mode !== 'manual') {
      console.log('[OAPull] 回拉已停用（hyzs_oa_pull_config.enabled=0），跳过');
      return;
    }
    run = await recordRunStart(mode);
    // 增量游标：只在成功时推进
    const cursorAt = cfg.incremental && cfg.lastCursorAt ? cfg.lastCursorAt : null;
    const { executeOaPullResults } = await import('@/lib/oa-pull-runner');
    const r = await executeOaPullResults(cursorAt);
    const now = new Date().toISOString();

    if (r.success) {
      const synced = r.synced + r.contSynced;
      await recordRunFinish(run.id, { status: 'success', synced, detail: r.message });
      await updateOaPullRuntime({
        lastRunAt: now,
        lastRunStatus: 'success',
        lastRunDetail: r.message,
        consecutiveFails: 0,
        lastCursorAt: now,          // 成功才推进游标
      });
      oaPullRetries = 0;
      console.log(`[OAPull] 回拉成功: ${synced} 条 (${mode})`);
    } else {
      const error = r.error || '未知错误';
      await recordRunFinish(run.id, { status: 'failed', error });
      const fails = cfg.consecutiveFails + 1;
      await updateOaPullRuntime({ lastRunAt: now, lastRunStatus: 'failed', lastRunDetail: error, consecutiveFails: fails });
      console.warn(`[OAPull] 回拉失败 (${mode}): ${error}`);
      if (fails >= cfg.alertAfterFails) {
        await notifyOaPullAlert({ ...cfg, consecutiveFails: fails }, error);
      }
      // 重试退避
      if (oaPullRetries < cfg.maxRetries && mode !== 'manual') {
        oaPullRetries++;
        const delayMin = cfg.retryBaseMin * Math.pow(2, oaPullRetries - 1);
        if (oaPullRetryTimer) clearTimeout(oaPullRetryTimer);
        oaPullRetryTimer = setTimeout(() => { executeOaPull('retry'); }, delayMin * 60 * 1000);
        console.log(`[OAPull] 将在 ${delayMin} 分钟后重试（第 ${oaPullRetries} 次）`);
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (run) await recordRunFinish(run.id, { status: 'failed', error });
    await updateOaPullRuntime({ lastRunAt: new Date().toISOString(), lastRunStatus: 'failed', lastRunDetail: error });
    console.warn('[OAPull] 执行异常:', error);
  } finally {
    oaPullRunning = false;
  }
}

// 每分钟检查一次：cron 命中 或 间隔兜底 则执行
let lastOaPullCheck = 0;
function scheduleOAPull() {
  const MIN = 60 * 1000;
  setInterval(async () => {
    try {
      const cfg = await getOaPullConfig();
      if (!cfg.enabled) return;
      const now = new Date();
      let due = false;

      if (cfg.cronExpr && cfg.cronExpr.trim()) {
        // cron 模式
        try {
          const job = new Cron(cfg.cronExpr, { timezone: 'Asia/Shanghai', protect: true });
          const next = job.nextRun(now);
          if (next && next.getTime() - now.getTime() <= MIN) {
            due = true;
          }
        } catch (e) {
          console.warn('[OAPull] cron 表达式无效，回退间隔模式:', e instanceof Error ? e.message : e);
          if (Date.now() - lastOaPullCheck >= Math.max(1, cfg.intervalMin) * MIN) due = true;
        }
      } else {
        // 间隔兜底
        if (Date.now() - lastOaPullCheck >= Math.max(1, cfg.intervalMin) * MIN) due = true;
      }

      if (due) {
        lastOaPullCheck = Date.now();
        await executeOaPull('scheduled');
      }
    } catch (e) {
      console.warn('[OAPull] 调度检查失败:', e instanceof Error ? e.message : e);
    }
  }, MIN);
}

// 立即触发（供 API 调用）
export async function triggerOaPullNow(): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    await executeOaPull('manual');
    return { ok: true, message: '已触发' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── 持续项推送调度（每分钟检查 cadence_config）──
function scheduleContinuousPush() {
  setInterval(async () => {
    try {
      const configs = await getCadenceConfigs();
      const now = new Date();
      const bj = getBeijingParts(now);
      const dayOfWeek = bj.dayOfWeek;
      const dateOfMonth = bj.date;
      const hhmm = bj.hhmm;
      const todayStr = bj.dateStr;

      for (const cfg of configs) {
        if (!cfg.enabled) continue;
        // 今天已推过则跳过（按北京时间比较）
        if (cfg.lastPushedAt && getBeijingParts(new Date(cfg.lastPushedAt)).dateStr === todayStr) continue;

        const shouldFire =
          (cfg.cadence === 'weekly' && cfg.triggerDay === dayOfWeek) ||
          (cfg.cadence === 'monthly' && cfg.triggerDay === dateOfMonth);
        if (!shouldFire) continue;
        if (cfg.triggerTime !== hhmm) continue;

        console.log(`[ContinuousPush] 命中: ${cfg.meetingType} (${cfg.cadence} ${cfg.triggerDay} ${cfg.triggerTime})`);
        const r = await pushContinuousByType(cfg.meetingType, now);
        await updateCadenceConfig(cfg.id, { lastPushedAt: now.toISOString() });
        console.log(`[ContinuousPush] ${cfg.meetingType}: ${r.items} 项, OA ${r.pushed}`);
      }
    } catch (e) {
      console.error('[ContinuousPush] 调度异常:', e instanceof Error ? e.message : e);
    }
  }, 60_000);
}

// ── 持续项「自动取数」：每周一 00:30（北京时间）自动取上一自然周数据，写入进度表 ──
// 只对开启 auto_fetch 的持续项生效；数据源 SQL 未接入前为空跑（不写、不催）
function scheduleContinuousAutoFetch() {
  const scheduleNext = () => {
    const nextFire = computeNextFire('00:30');
    if (!nextFire) return;
    const delay = nextFire.getTime() - Date.now();
    console.log(`[ContinuousAutoFetch] 下次自动取数检查: ${nextFire.toLocaleString()}`);
    setTimeout(async () => {
      try {
        // 仅北京时间周一凌晨执行（取上一自然周数据，周一早上即可用于周会看板）
        const bj = getBeijingParts(new Date());
        if (bj.dayOfWeek === 1) {
          const { runAutoFetch } = await import('@/lib/continuous-auto-fetch');
          const r = await runAutoFetch(new Date());
          console.log(`[ContinuousAutoFetch] ${r.window.startLabel}~${r.window.endLabel} 候选 ${r.candidates} 写入 ${r.written} 缺失 ${r.missing.length}`);
        }
      } catch (e) {
        console.error('[ContinuousAutoFetch] 执行异常:', e instanceof Error ? e.message : e);
      }
      scheduleNext();
    }, delay);
  };
  scheduleNext();
}

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  // ── ASR WebSocket 代理 ──────────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = parse(req.url || '', true);
    if (url.pathname === '/ws/asr') {
      wss.handleUpgrade(req, socket as any, head, (clientWs) => {
        const targetUrl = url.query.target as string;
        const authorization = url.query.authorization as string | undefined;
        const openaiBeta = url.query.openaiBeta as string | undefined;
        const traceId = `qwen-proxy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (!targetUrl) {
          clientWs.close(4000, 'Missing target URL');
          return;
        }
        // #region debug-point C:qwen-proxy-upgrade
        (async()=>{let u='http://127.0.0.1:7777/event',s='qwen3-realtime-error';try{const {readFileSync}=await import('fs');const e=readFileSync('.dbg/qwen3-realtime-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'server.ts:/ws/asr:upgrade',traceId,msg:'[DEBUG] qwen proxy upgrade',data:{targetUrl,hasAuthorization:!!authorization,hasOpenAIBeta:!!openaiBeta},ts:Date.now()})}).catch(()=>{})})();
        // #endregion
        console.log(`[ASR Proxy] 连接到 ${targetUrl.slice(0, 60)}...`);
        const headers: Record<string, string> = {};
        if (authorization) headers.Authorization = authorization;
        if (openaiBeta) headers['OpenAI-Beta'] = openaiBeta;
        const remote = new WebSocket(targetUrl, {
          headers,
          handshakeTimeout: 10000,
        });
        let remoteReady = false;
        const pendingQueue: (string | Buffer)[] = [];

        remote.on('open', () => {
          // #region debug-point C:qwen-proxy-remote-open
          (async()=>{let u='http://127.0.0.1:7777/event',s='qwen3-realtime-error';try{const {readFileSync}=await import('fs');const e=readFileSync('.dbg/qwen3-realtime-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'server.ts:/ws/asr:remote-open',traceId,msg:'[DEBUG] qwen proxy remote open',data:{pendingQueueLength:pendingQueue.length},ts:Date.now()})}).catch(()=>{})})();
          // #endregion
          remoteReady = true;
          // 发送缓存的消息
          for (const msg of pendingQueue) remote.send(msg);
          pendingQueue.length = 0;
        });
        remote.on('message', (data, isBinary) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            // ASR 返回的文本结果转为 string，确保浏览器端收到 string 类型
            clientWs.send(isBinary ? data : data.toString());
          }
        });
        remote.on('close', (code, reason) => {
          // #region debug-point C:qwen-proxy-remote-close
          (async()=>{let u='http://127.0.0.1:7777/event',s='qwen3-realtime-error';try{const {readFileSync}=await import('fs');const e=readFileSync('.dbg/qwen3-realtime-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'server.ts:/ws/asr:remote-close',traceId,msg:'[DEBUG] qwen proxy remote close',data:{code,reason:reason?.toString?.()||'',remoteReady},ts:Date.now()})}).catch(()=>{})})();
          // #endregion
          clientWs.close();
        });
        remote.on('error', (e) => {
          // #region debug-point C:qwen-proxy-remote-error
          (async()=>{let u='http://127.0.0.1:7777/event',s='qwen3-realtime-error';try{const {readFileSync}=await import('fs');const e2=readFileSync('.dbg/qwen3-realtime-error.env','utf8');u=e2.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e2.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'server.ts:/ws/asr:remote-error',traceId,msg:'[DEBUG] qwen proxy remote error',data:{message:e.message},ts:Date.now()})}).catch(()=>{})})();
          // #endregion
          console.error('[ASR Proxy] remote error:', e.message);
          const closeReason = /timed out/i.test(e.message)
            ? 'Remote ASR handshake timeout'
            : 'Remote ASR error';
          clientWs.close(4001, closeReason);
        });

        clientWs.on('message', (data, isBinary) => {
          const msg = isBinary ? (data as Buffer) : data.toString();
          if (remoteReady && remote.readyState === WebSocket.OPEN) {
            remote.send(msg);
          } else {
            pendingQueue.push(msg);
          }
        });
        clientWs.on('close', () => {
          // #region debug-point C:qwen-proxy-client-close
          (async()=>{let u='http://127.0.0.1:7777/event',s='qwen3-realtime-error';try{const {readFileSync}=await import('fs');const e=readFileSync('.dbg/qwen3-realtime-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'server.ts:/ws/asr:client-close',traceId,msg:'[DEBUG] qwen proxy client close',data:{remoteReady,remoteState:remote.readyState,pendingQueueLength:pendingQueue.length},ts:Date.now()})}).catch(()=>{})})();
          // #endregion
          if (remote.readyState === WebSocket.OPEN) remote.close();
        });
      });
    }
  });

  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
    setupEnvRestartReminder();
    // 启动 5 秒后预热（触发 Next.js 冷启动编译，避免首次用户访问超时/异常）
    setTimeout(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        console.log(`[warmup] 预热完成: ${res.status}`);
      } catch (e) {
        console.warn('[warmup] 预热失败（不影响运行）:', e instanceof Error ? e.message : e);
      }
    }, 5_000);
    // 启动 10 秒后同步一次，之后每天凌晨 2 点自动同步
    setTimeout(async () => {
      await runOrgSync();
      scheduleDailySync();
    }, 10_000);
    // 启动 15 秒后首次拉取 OA 完成结果，之后按配置（cron/间隔）调度
    setTimeout(async () => {
      await executeOaPull('startup');
      scheduleOAPull();
    }, 15_000);
    if (TODO_PUSH_RUN_ON_START && TODO_PUSH_ENABLED) {
      setTimeout(() => runTodoPush('startup'), 20_000);
    }
    scheduleTodoPush();
    // 持续项推送调度（每分钟检查 cadence_config）
    scheduleContinuousPush();
    // 持续项自动取数调度（每周一凌晨）
    scheduleContinuousAutoFetch();
  });
});
