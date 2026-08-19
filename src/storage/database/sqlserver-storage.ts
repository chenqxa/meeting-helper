import * as sql from 'mssql';
import type { Meeting } from './memory-storage';
import { ensureTable as ensureActionItemsTable, migrateFromMeetings } from './action-storage';

// 从 DATABASE_URL 解析连接配置
// 支持格式: mssql://user:pass@host:1433/dbname 或 Server=...;Database=...
export function parseConnectionString(): sql.config {
  const url = process.env.DATABASE_URL || '';
  const connectionTimeout = parseInt(process.env.SQL_CONNECTION_TIMEOUT_MS || '2500', 10);
  const requestTimeout = parseInt(process.env.SQL_REQUEST_TIMEOUT_MS || '5000', 10);

  // URL 格式: mssql://user:pass@host:port/database
  if (url.startsWith('mssql://') || url.startsWith('sqlserver://')) {
    const u = new URL(url.replace(/^sqlserver/, 'mssql'));
    return {
      server: u.hostname,
      port: u.port ? parseInt(u.port) : 1433,
      database: u.pathname.replace(/^\//, ''),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      options: { encrypt: false, trustServerCertificate: true },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout,
      requestTimeout,
    };
  }

  // Key=Value 格式
  const pairs: Record<string, string> = {};
  url.split(';').forEach(p => {
    const [k, ...v] = p.split('=');
    if (k) pairs[k.trim().toLowerCase()] = v.join('=').trim();
  });

  // 处理 Server=host,port 格式
  let server = pairs['server'] || pairs['data source'] || 'localhost';
  let port = parseInt(pairs['port'] || '1433');
  const commaIdx = server.lastIndexOf(',');
  if (commaIdx > 0) {
    port = parseInt(server.slice(commaIdx + 1), 10) || 1433;
    server = server.slice(0, commaIdx);
  }

  return {
    server,
    port,
    database: pairs['database'] || pairs['initial catalog'] || '',
    user: pairs['user id'] || pairs['uid'] || '',
    password: pairs['password'] || pairs['pwd'] || '',
    options: { encrypt: false, trustServerCertificate: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout,
    requestTimeout,
  };
}

let pool: sql.ConnectionPool | null = null;
let tablesEnsured = false;
let migrationDone = false;
let lastConnectFailureAt = 0;
let lastConnectFailureError: Error | null = null;
const CONNECT_RETRY_COOLDOWN_MS = 10000;

export async function getPool(): Promise<sql.ConnectionPool> {
  if ((!pool || !pool.connected) && lastConnectFailureError && Date.now() - lastConnectFailureAt < CONNECT_RETRY_COOLDOWN_MS) {
    throw lastConnectFailureError;
  }
  if (!pool || !pool.connected) {
    const cfg = parseConnectionString();
    pool = new sql.ConnectionPool(cfg);
    try {
      await pool.connect();
    } catch (error) {
      lastConnectFailureAt = Date.now();
      lastConnectFailureError = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
    lastConnectFailureError = null;
  }
  if (!tablesEnsured) {
    tablesEnsured = true;
    await ensureTable(pool);
    await ensureActionItemsTable(pool);
    if (!migrationDone) {
      migrationDone = true;
      migrateFromMeetings(pool)
        .then(n => { if (n > 0) console.log(`[migration] 迁移了 ${n} 条行动项到 hyzs_action_items`); })
        .catch(e => console.warn('[migration] 行动项迁移失败:', e.message));
    }
  }
  return pool;
}

async function ensureTable(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_meetings')
    CREATE TABLE hyzs_meetings (
      id          NVARCHAR(64)   NOT NULL PRIMARY KEY,
      title       NVARCHAR(200)  NOT NULL,
      type        NVARCHAR(50)   NOT NULL,
      organizer   NVARCHAR(100)  NOT NULL,
      department  NVARCHAR(100)  NULL,
      meeting_date NVARCHAR(64)  NULL,
      participants NVARCHAR(MAX) NULL,
      status      NVARCHAR(20)   NOT NULL DEFAULT 'draft',
      version     INT            NOT NULL DEFAULT 1,
      locked_version INT         NULL,
      organizer_login_id NVARCHAR(64) NULL,
      content     NVARCHAR(MAX)  NULL,
      summary     NVARCHAR(MAX)  NULL,
      action_items NVARCHAR(MAX) NULL,
      created_at  NVARCHAR(64)   NOT NULL,
      updated_at  NVARCHAR(64)   NOT NULL
    )
  `);
  // 兼容已存在的表：补齐可能缺少的列
  const migrations: [string, string][] = [
    ['department',        'NVARCHAR(100) NULL'],
    ['organizer_login_id','NVARCHAR(64) NULL'],
    ['content',           'NVARCHAR(MAX) NULL'],
    ['summary',           'NVARCHAR(MAX) NULL'],
    ['action_items',      'NVARCHAR(MAX) NULL'],
    ['locked_version',    'INT NULL'],
    ['minutes',           'NVARCHAR(MAX) NULL'],
    ['project_id',        'NVARCHAR(64) NULL'],
    ['wecom_pushed_at',   'NVARCHAR(64) NULL'],
    ['oa_pushed_at',      'NVARCHAR(64) NULL'],
    ['default_proposer',  'NVARCHAR(100) NULL'],
    ['default_proposer_login_id', 'NVARCHAR(64) NULL'],
    ['default_proposer_oa_id', 'NVARCHAR(64) NULL'],
  ];
  for (const [col, def] of migrations) {
    await p.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_meetings') AND name = '${col}')
      ALTER TABLE hyzs_meetings ADD ${col} ${def}
    `);
  }
}

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch (e) {
    console.warn('Failed to parse JSON:', str, e);
    return fallback;
  }
}

function rowToMeeting(row: any): Meeting {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    organizer: row.organizer,
    organizerLoginId: row.organizer_login_id || undefined,
    meetingDate: row.meeting_date || '',
    participants: safeJsonParse<string[]>(row.participants, []),
    status: row.status,
    version: row.version,
    locked_version: row.locked_version,
    content: row.content || '',
    department: row.department || undefined,
    projectId: row.project_id || null,
    summary: safeJsonParse<any>(row.summary, undefined),
    actionItems: safeJsonParse<any[]>(row.action_items, []),
    minutes: safeJsonParse<any>(row.minutes, undefined),
    wecomPushedAt: row.wecom_pushed_at || undefined,
    oaPushedAt: row.oa_pushed_at || undefined,
    defaultProposer: row.default_proposer || undefined,
    defaultProposerLoginId: row.default_proposer_login_id || undefined,
    defaultProposerOaId: row.default_proposer_oa_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const createMeeting = async (data: Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'>): Promise<Meeting> => {
  const p = await getPool();
  const id = `MTG_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();
  const meeting: Meeting = { ...data, id, version: 1, createdAt: now, updatedAt: now };

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('title', sql.NVarChar, data.title)
    .input('type', sql.NVarChar, data.type)
    .input('organizer', sql.NVarChar, data.organizer)
    .input('department', sql.NVarChar, data.department || null)
    .input('meeting_date', sql.NVarChar, data.meetingDate || null)
    .input('participants', sql.NVarChar, JSON.stringify(data.participants || []))
    .input('status', sql.NVarChar, data.status || 'draft')
    .input('version', sql.Int, 1)
    .input('organizer_login_id', sql.NVarChar, (data as any).organizerLoginId || null)
    .input('content', sql.NVarChar, data.content || null)
    .input('summary', sql.NVarChar, data.summary ? JSON.stringify(data.summary) : null)
    .input('action_items', sql.NVarChar, data.actionItems ? JSON.stringify(data.actionItems) : null)
    .input('project_id', sql.NVarChar, data.projectId || null)
    .input('wecom_pushed_at', sql.NVarChar, (data as any).wecomPushedAt || null)
    .input('oa_pushed_at', sql.NVarChar, (data as any).oaPushedAt || null)
    .input('default_proposer', sql.NVarChar, (data as any).defaultProposer || null)
    .input('default_proposer_login_id', sql.NVarChar, (data as any).defaultProposerLoginId || null)
    .input('default_proposer_oa_id', sql.NVarChar, (data as any).defaultProposerOaId || null)
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_meetings
      (id,title,type,organizer,organizer_login_id,department,meeting_date,participants,status,version,content,summary,action_items,project_id,wecom_pushed_at,oa_pushed_at,default_proposer,default_proposer_login_id,default_proposer_oa_id,created_at,updated_at)
      VALUES (@id,@title,@type,@organizer,@organizer_login_id,@department,@meeting_date,@participants,@status,@version,@content,@summary,@action_items,@project_id,@wecom_pushed_at,@oa_pushed_at,@default_proposer,@default_proposer_login_id,@default_proposer_oa_id,@created_at,@updated_at)`);

  invalidateMeetingsCache();
  return meeting;
};

// ── 会议列表缓存（远程库延迟高）──
const MEETING_CACHE_TTL_MS = 15_000;
let meetingsCache: { items: Meeting[]; expAt: number } | null = null;

function invalidateMeetingsCache() {
  meetingsCache = null;
}

export const getMeetings = async (): Promise<Meeting[]> => {
  if (meetingsCache && meetingsCache.expAt > Date.now()) return meetingsCache.items;
  const p = await getPool();
  const result = await p.request()
    .query(`SELECT * FROM hyzs_meetings ORDER BY created_at DESC`);
  const items = result.recordset.map(rowToMeeting);
  meetingsCache = { items, expAt: Date.now() + MEETING_CACHE_TTL_MS };
  return items;
};

export const getMeetingById = async (id: string): Promise<Meeting | null> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`SELECT * FROM hyzs_meetings WHERE id = @id`);
  return result.recordset[0] ? rowToMeeting(result.recordset[0]) : null;
};

export const updateMeeting = async (id: string, data: Partial<Meeting>): Promise<Meeting | null> => {
  const p = await getPool();
  const existing = await getMeetingById(id);
  if (!existing) return null;

  const updated: Meeting = { ...existing, ...data, updatedAt: new Date().toISOString() };
  await p.request()
    .input('id', sql.NVarChar, id)
    .input('title', sql.NVarChar, updated.title)
    .input('type', sql.NVarChar, updated.type)
    .input('organizer', sql.NVarChar, updated.organizer)
    .input('meeting_date', sql.NVarChar, updated.meetingDate || null)
    .input('participants', sql.NVarChar, JSON.stringify(updated.participants || []))
    .input('status', sql.NVarChar, updated.status || 'draft')
    .input('version', sql.Int, updated.version || 1)
    .input('locked_version', sql.Int, updated.locked_version ?? null)
    .input('organizer_login_id', sql.NVarChar, (updated as any).organizerLoginId || null)
    .input('content', sql.NVarChar, updated.content || null)
    .input('summary', sql.NVarChar, updated.summary ? JSON.stringify(updated.summary) : null)
    .input('action_items', sql.NVarChar, updated.actionItems ? JSON.stringify(updated.actionItems) : null)
    .input('minutes', sql.NVarChar, updated.minutes ? JSON.stringify(updated.minutes) : null)
    .input('project_id', sql.NVarChar, updated.projectId || null)
    .input('wecom_pushed_at', sql.NVarChar, (updated as any).wecomPushedAt ?? null)
    .input('oa_pushed_at', sql.NVarChar, (updated as any).oaPushedAt ?? null)
    .input('default_proposer', sql.NVarChar, (updated as any).defaultProposer ?? null)
    .input('default_proposer_login_id', sql.NVarChar, (updated as any).defaultProposerLoginId ?? null)
    .input('default_proposer_oa_id', sql.NVarChar, (updated as any).defaultProposerOaId ?? null)
    .input('updated_at', sql.NVarChar, updated.updatedAt)
    .query(`UPDATE hyzs_meetings SET
      title=@title, type=@type, organizer=@organizer, organizer_login_id=@organizer_login_id,
      meeting_date=@meeting_date, participants=@participants, status=@status, version=@version,
      locked_version=@locked_version, content=@content, summary=@summary,
      action_items=@action_items, minutes=@minutes, project_id=@project_id,
      wecom_pushed_at=@wecom_pushed_at, oa_pushed_at=@oa_pushed_at,
      default_proposer=@default_proposer, default_proposer_login_id=@default_proposer_login_id, default_proposer_oa_id=@default_proposer_oa_id,
      updated_at=@updated_at
      WHERE id=@id`);
  invalidateMeetingsCache();
  return updated;
};

export const deleteMeeting = async (id: string): Promise<boolean> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`DELETE FROM hyzs_meetings WHERE id = @id`);
  invalidateMeetingsCache();
  return (result.rowsAffected[0] || 0) > 0;
};
