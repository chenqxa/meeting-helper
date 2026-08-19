/**
 * 将旧的JSON反馈数据迁移到SQL Server数据库
 * 运行: tsx scripts/migrate-feedback.ts
 */

// 首先加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as sql from 'mssql';
import { parseConnectionString } from '../src/storage/database/sqlserver-storage';

interface OldFeedback {
  id: string;
  title: string;
  content: string;
  category: 'bug' | 'feature' | 'question' | 'other';
  status: 'open' | 'resolved';
  createdBy: string;
  createdByLoginId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolveNote?: string;
}

async function migrate() {
  // 检查环境变量
  if (!process.env.DATABASE_URL) {
    console.error('错误：未找到 DATABASE_URL 环境变量');
    console.error('请确保 .env 文件存在并包含正确的数据库连接配置');
    process.exit(1);
  }

  console.log('数据库连接配置已加载');

  const feedbackFile = join(process.cwd(), 'feedback-data.json');

  if (!existsSync(feedbackFile)) {
    console.log('没有找到 feedback-data.json 文件，无需迁移');
    return;
  }

  // 读取旧数据
  const data = JSON.parse(readFileSync(feedbackFile, 'utf-8'));
  const items: OldFeedback[] = data.items || [];

  if (items.length === 0) {
    console.log('没有反馈数据需要迁移');
    return;
  }

  console.log(`找到 ${items.length} 条反馈数据，开始迁移...`);

  // 连接数据库
  const pool = new sql.ConnectionPool(parseConnectionString());
  await pool.connect();

  // 确保表存在
  await pool.request().query(`
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

  // 迁移数据
  let migrated = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      // 检查是否已存在
      const existing = await pool.request()
        .input('id', sql.NVarChar, item.id)
        .query('SELECT id FROM hyzs_feedbacks WHERE id = @id');

      if (existing.recordset.length > 0) {
        console.log(`跳过已存在的反馈: ${item.id}`);
        skipped++;
        continue;
      }

      // 插入数据
      await pool.request()
        .input('id', sql.NVarChar, item.id)
        .input('title', sql.NVarChar, item.title)
        .input('content', sql.NVarChar, item.content)
        .input('category', sql.NVarChar, item.category)
        .input('status', sql.NVarChar, item.status)
        .input('created_by', sql.NVarChar, item.createdBy)
        .input('created_by_login_id', sql.NVarChar, item.createdByLoginId || null)
        .input('created_at', sql.NVarChar, item.createdAt)
        .input('updated_at', sql.NVarChar, item.updatedAt)
        .input('resolved_by', sql.NVarChar, item.resolvedBy || null)
        .input('resolved_at', sql.NVarChar, item.resolvedAt || null)
        .input('resolve_note', sql.NVarChar, item.resolveNote || null)
        .query(`
          INSERT INTO hyzs_feedbacks
            (id, title, content, category, status, created_by, created_by_login_id,
             created_at, updated_at, resolved_by, resolved_at, resolve_note)
          VALUES
            (@id, @title, @content, @category, @status, @created_by, @created_by_login_id,
             @created_at, @updated_at, @resolved_by, @resolved_at, @resolve_note)
        `);

      console.log(`✓ 迁移反馈: ${item.id} - ${item.title}`);
      migrated++;
    } catch (error) {
      console.error(`✗ 迁移失败 ${item.id}:`, error);
    }
  }

  await pool.close();

  console.log('\n迁移完成！');
  console.log(`- 成功迁移: ${migrated} 条`);
  console.log(`- 跳过重复: ${skipped} 条`);
  console.log(`\n建议：迁移成功后可以备份或删除 feedback-data.json 文件`);
}

migrate().catch(console.error);
