import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';
import crypto from 'crypto';

export interface MeetingShareToken {
  id: string;
  meetingId: string;
  token: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  accessCount: number;
  maxAccess?: number | null;
}

let pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = new sql.ConnectionPool(parseConnectionString());
    await pool.connect();
    await ensureTable(pool);
  }
  return pool;
}

async function ensureTable(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_meeting_share_tokens')
    CREATE TABLE hyzs_meeting_share_tokens (
      id              NVARCHAR(64)   NOT NULL PRIMARY KEY,
      meeting_id      NVARCHAR(64)   NOT NULL,
      token           NVARCHAR(128)  NOT NULL UNIQUE,
      created_by      NVARCHAR(100)  NOT NULL,
      created_at      NVARCHAR(64)   NOT NULL,
      expires_at      NVARCHAR(64)   NOT NULL,
      access_count    INT            NOT NULL DEFAULT 0,
      max_access      INT            NULL
    )
  `);

  // 创建索引
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_meeting_share_token')
    CREATE INDEX idx_meeting_share_token ON hyzs_meeting_share_tokens(token)
  `);

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'idx_meeting_share_meeting_id')
    CREATE INDEX idx_meeting_share_meeting_id ON hyzs_meeting_share_tokens(meeting_id)
  `);
}

function rowToToken(row: any): MeetingShareToken {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    token: row.token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    accessCount: row.access_count,
    maxAccess: row.max_access || undefined,
  };
}

/**
 * 生成分享令牌
 * @param meetingId 会议ID
 * @param createdBy 创建者
 * @param expiresInHours 有效期（小时），默认72小时
 * @param maxAccess 最大访问次数，null表示不限制
 */
export async function createShareToken(
  meetingId: string,
  createdBy: string,
  expiresInHours: number = 72,
  maxAccess: number | null = null
): Promise<MeetingShareToken> {
  const p = await getPool();
  const id = `SHARE_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const token = crypto.randomBytes(32).toString('base64url'); // URL安全的token
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('meeting_id', sql.NVarChar, meetingId)
    .input('token', sql.NVarChar, token)
    .input('created_by', sql.NVarChar, createdBy)
    .input('created_at', sql.NVarChar, now)
    .input('expires_at', sql.NVarChar, expiresAt)
    .input('max_access', sql.Int, maxAccess)
    .query(`
      INSERT INTO hyzs_meeting_share_tokens
        (id, meeting_id, token, created_by, created_at, expires_at, access_count, max_access)
      VALUES
        (@id, @meeting_id, @token, @created_by, @created_at, @expires_at, 0, @max_access)
    `);

  return {
    id,
    meetingId,
    token,
    createdBy,
    createdAt: now,
    expiresAt,
    accessCount: 0,
    maxAccess: maxAccess || undefined,
  };
}

/**
 * 验证并消费分享令牌
 */
export async function validateShareToken(token: string): Promise<{ valid: boolean; meetingId?: string; error?: string }> {
  const p = await getPool();

  const result = await p.request()
    .input('token', sql.NVarChar, token)
    .query('SELECT * FROM hyzs_meeting_share_tokens WHERE token = @token');

  if (result.recordset.length === 0) {
    return { valid: false, error: '分享链接无效' };
  }

  const shareToken = rowToToken(result.recordset[0]);

  // 检查是否过期
  if (new Date(shareToken.expiresAt) < new Date()) {
    return { valid: false, error: '分享链接已过期' };
  }

  // 检查访问次数限制
  if (shareToken.maxAccess && shareToken.accessCount >= shareToken.maxAccess) {
    return { valid: false, error: '分享链接访问次数已达上限' };
  }

  // 增加访问计数
  await p.request()
    .input('token', sql.NVarChar, token)
    .query('UPDATE hyzs_meeting_share_tokens SET access_count = access_count + 1 WHERE token = @token');

  return { valid: true, meetingId: shareToken.meetingId };
}

/**
 * 获取会议的所有分享令牌
 */
export async function getShareTokensByMeeting(meetingId: string): Promise<MeetingShareToken[]> {
  const p = await getPool();
  const result = await p.request()
    .input('meeting_id', sql.NVarChar, meetingId)
    .query('SELECT * FROM hyzs_meeting_share_tokens WHERE meeting_id = @meeting_id ORDER BY created_at DESC');

  return result.recordset.map(rowToToken);
}

/**
 * 删除分享令牌
 */
export async function deleteShareToken(id: string): Promise<boolean> {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query('DELETE FROM hyzs_meeting_share_tokens WHERE id = @id');

  return (result.rowsAffected[0] || 0) > 0;
}

/**
 * 清理过期的分享令牌
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const p = await getPool();
  const now = new Date().toISOString();

  const result = await p.request()
    .input('now', sql.NVarChar, now)
    .query('DELETE FROM hyzs_meeting_share_tokens WHERE expires_at < @now');

  return result.rowsAffected[0] || 0;
}
