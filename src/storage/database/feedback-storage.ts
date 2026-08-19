import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface FeedbackImage {
  url: string;
  name?: string;
}

export interface Feedback {
  id: string;
  title: string;
  content: string;
  images?: FeedbackImage[];
  category: 'bug' | 'feature' | 'question' | 'other';
  status: 'open' | 'resolved';
  createdBy: string;
  createdByLoginId?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolveNote?: string | null;
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
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_feedbacks')
    CREATE TABLE hyzs_feedbacks (
      id               NVARCHAR(64)   NOT NULL PRIMARY KEY,
      title            NVARCHAR(500)  NOT NULL,
      content          NVARCHAR(MAX)  NOT NULL,
      category         NVARCHAR(20)   NOT NULL DEFAULT 'other',
      status           NVARCHAR(20)   NOT NULL DEFAULT 'open',
      created_by       NVARCHAR(100)  NOT NULL,
      created_by_login_id NVARCHAR(64) NULL,
      created_at       NVARCHAR(64)   NOT NULL,
      updated_at       NVARCHAR(64)   NOT NULL,
      resolved_by      NVARCHAR(100)  NULL,
      resolved_at      NVARCHAR(64)   NULL,
      resolve_note     NVARCHAR(MAX)  NULL
    )
  `);
  // 兼容旧表：补 images 列（已存在则跳过）
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_feedbacks') AND name = 'images')
    ALTER TABLE hyzs_feedbacks ADD images NVARCHAR(MAX) NULL
  `).catch(() => {});
}

function rowToFeedback(row: any): Feedback {
  let images: FeedbackImage[] = [];
  try {
    if (row.images) images = JSON.parse(row.images);
  } catch { /* ignore */ }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    images: images.length > 0 ? images : undefined,
    category: row.category as Feedback['category'],
    status: row.status as Feedback['status'],
    createdBy: row.created_by,
    createdByLoginId: row.created_by_login_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedBy: row.resolved_by || undefined,
    resolvedAt: row.resolved_at || undefined,
    resolveNote: row.resolve_note || undefined,
  };
}

export const createFeedback = async (data: Omit<Feedback, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<Feedback> => {
  const p = await getPool();
  const id = `FB_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('title', sql.NVarChar, data.title)
    .input('content', sql.NVarChar, data.content)
    .input('images', sql.NVarChar, data.images ? JSON.stringify(data.images) : null)
    .input('category', sql.NVarChar, data.category)
    .input('created_by', sql.NVarChar, data.createdBy)
    .input('created_by_login_id', sql.NVarChar, data.createdByLoginId || null)
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`
      INSERT INTO hyzs_feedbacks
        (id, title, content, images, category, status, created_by, created_by_login_id, created_at, updated_at)
      VALUES
        (@id, @title, @content, @images, @category, 'open', @created_by, @created_by_login_id, @created_at, @updated_at)
    `);

  return {
    ...data,
    id,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
};

export const getFeedbacks = async (): Promise<Feedback[]> => {
  const p = await getPool();
  const result = await p.request()
    .query('SELECT * FROM hyzs_feedbacks ORDER BY created_at DESC');
  return result.recordset.map(rowToFeedback);
};

export const getFeedbackById = async (id: string): Promise<Feedback | null> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query('SELECT * FROM hyzs_feedbacks WHERE id = @id');

  if (result.recordset.length === 0) return null;
  return rowToFeedback(result.recordset[0]);
};

export const resolveFeedback = async (id: string, data: { resolvedBy: string; resolveNote?: string }): Promise<Feedback | null> => {
  const p = await getPool();
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('resolved_by', sql.NVarChar, data.resolvedBy)
    .input('resolved_at', sql.NVarChar, now)
    .input('resolve_note', sql.NVarChar, data.resolveNote || null)
    .input('updated_at', sql.NVarChar, now)
    .query(`
      UPDATE hyzs_feedbacks
      SET status = 'resolved',
          resolved_by = @resolved_by,
          resolved_at = @resolved_at,
          resolve_note = @resolve_note,
          updated_at = @updated_at
      WHERE id = @id
    `);

  return getFeedbackById(id);
};

export const reopenFeedback = async (id: string): Promise<Feedback | null> => {
  const p = await getPool();
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('updated_at', sql.NVarChar, now)
    .query(`
      UPDATE hyzs_feedbacks
      SET status = 'open',
          resolved_by = NULL,
          resolved_at = NULL,
          resolve_note = NULL,
          updated_at = @updated_at
      WHERE id = @id
    `);

  return getFeedbackById(id);
};

export const deleteFeedback = async (id: string): Promise<boolean> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query('DELETE FROM hyzs_feedbacks WHERE id = @id');

  return (result.rowsAffected[0] || 0) > 0;
};

// 优雅关闭连接池
export async function closeFeedbackPool(): Promise<void> {
  if (pool) {
    try {
      await pool.close();
      console.log('[feedback-storage] Connection pool closed');
    } catch (error) {
      console.error('[feedback-storage] Error closing pool:', error);
    } finally {
      pool = null;
    }
  }
}

// 在服务器端注册关闭钩子
if (typeof window === 'undefined') {
  const cleanup = async () => {
    console.log('[feedback-storage] Received shutdown signal, closing connections...');
    await closeFeedbackPool();
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}
