// 恢复重建时丢失的系统手动稽核标记（工作簿1无标记但原系统有 oa_score）
import 'dotenv/config';
import * as sql from 'mssql';
import { parseConnectionString } from '../src/storage/database/sqlserver-storage';
import { readFileSync } from 'fs';

async function main() {
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  const batches = ['BATCH_1785489735733_982NM', 'BATCH_1785491503033_5MOCO', 'BATCH_1785732787789_LY7I8'];
  const placeholders = batches.map((_, i) => `@b${i}`).join(',');
  const req = pool.request();
  batches.forEach((b, i) => req.input(`b${i}`, sql.NVarChar, b));
  const r = await req.query(
    `SELECT id, description, oa_score FROM hyzs_action_items_backup_20260803 WHERE source_type='batch' AND source_id IN (${placeholders}) AND oa_score IS NOT NULL`
  );

  const wb1 = JSON.parse(readFileSync('C:/Users/75597/AppData/Local/Temp/opencode/wb1-all.json', 'utf-8'));
  const emptyAudit = new Set(
    wb1.filter((d: any) => !String(d.audit).trim() && !String(d.score).trim()).map((d: any) => d.desc.trim())
  );

  let restored = 0;
  const processedDesc = new Set<string>();
  for (const it of r.recordset) {
    const desc = String(it.description).trim();
    if (!emptyAudit.has(desc)) continue;
    if (processedDesc.has(desc)) continue;
    processedDesc.add(desc);

    const cur = await pool.request()
      .input('d', sql.NVarChar, it.description)
      .query(`SELECT id, oa_score FROM hyzs_action_items WHERE description = @d AND source_type = 'batch'`);
    let anyUpdated = false;
    for (const c of cur.recordset) {
      if (c.oa_score !== null && c.oa_score !== undefined) continue;
      await pool.request()
        .input('id', sql.NVarChar, c.id)
        .input('oa', sql.Float, it.oa_score)
        .query(`UPDATE hyzs_action_items SET oa_score = @oa WHERE id = @id`);
      anyUpdated = true;
      restored++;
      console.log(`恢复 ${c.id}  oa_score=${it.oa_score}  ${String(desc).slice(0, 40)}`);
    }
    if (!anyUpdated) console.log(`跳过(已有评分) ${String(desc).slice(0, 40)}`);
  }
  console.log(`\n共恢复 ${restored} 条系统手动标记`);
  await pool.close();
  process.exit(0);
}

main();
