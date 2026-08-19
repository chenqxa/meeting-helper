import 'dotenv/config';
import * as sql from 'mssql';
import { parseConnectionString } from '../src/storage/database/sqlserver-storage';

async function main() {
  const p = new sql.ConnectionPool(parseConnectionString());
  await p.connect();

  // 按 title 去重，保留最早创建的
  const result = await p.request().query(`
    DELETE FROM hyzs_meetings
    WHERE id NOT IN (
      SELECT MIN(id) FROM hyzs_meetings GROUP BY title
    )
  `);
  console.log(`删除 ${result.rowsAffected[0]} 条重复记录`);

  const remaining = await p.request().query('SELECT id, title FROM hyzs_meetings ORDER BY created_at');
  console.log('剩余记录:', remaining.recordset);

  await p.close();
}
main();
