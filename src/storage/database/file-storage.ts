// 附件文件入库存储：hyzs_files（文件内容存 VARBINARY(MAX)）
// 背景：容器无持久卷，.uploads 随每次发版重建被清空，历史附件全部丢失；
// 改为存共享 SQL Server 后，任意环境/任意次数部署均不丢、均可读。
import * as sql from 'mssql';
import { getPool } from './sqlserver-storage';

let tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_files')
    CREATE TABLE hyzs_files (
      file_id    NVARCHAR(128)   NOT NULL PRIMARY KEY,
      mime       NVARCHAR(128)   NULL,
      size       INT             NOT NULL DEFAULT 0,
      data       VARBINARY(MAX)  NULL,
      created_at NVARCHAR(64)    NOT NULL
    )
  `);
  tableEnsured = true;
}

/** 保存文件到数据库（同 file_id 重复保存时覆盖） */
export async function saveFileToDb(fileId: string, mime: string, buffer: Buffer): Promise<void> {
  await ensureTable();
  const pool = await getPool();
  await pool.request()
    .input('file_id', sql.NVarChar, fileId)
    .input('mime', sql.NVarChar, mime)
    .input('size', sql.Int, buffer.length)
    .input('data', sql.VarBinary(sql.MAX), buffer)
    .input('created_at', sql.NVarChar, new Date().toISOString())
    .query(`
      MERGE hyzs_files AS t
      USING (SELECT @file_id AS file_id) AS s ON t.file_id = s.file_id
      WHEN MATCHED THEN UPDATE SET mime = @mime, size = @size, data = @data, created_at = @created_at
      WHEN NOT MATCHED THEN INSERT (file_id, mime, size, data, created_at)
        VALUES (@file_id, @mime, @size, @data, @created_at);
    `);
}

/** 从数据库读取文件；不存在返回 null */
export async function readFileFromDb(fileId: string): Promise<{ buffer: Buffer; mime: string | null; size: number } | null> {
  await ensureTable();
  const pool = await getPool();
  const result = await pool.request()
    .input('file_id', sql.NVarChar, fileId)
    .query('SELECT data, mime, size FROM hyzs_files WHERE file_id = @file_id');
  const row = result.recordset[0];
  if (!row || !row.data) return null;
  return { buffer: Buffer.from(row.data), mime: row.mime || null, size: row.size ?? Buffer.from(row.data).length };
}
