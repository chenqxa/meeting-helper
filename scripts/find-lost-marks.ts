// 找出被删项中"系统手动打V/X（工作簿1无标记但备份有评分）"且当前重建项无评分的情况
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
    `SELECT id, description, oa_score, initial_result FROM hyzs_action_items_backup_20260803 WHERE source_type='batch' AND source_id IN (${placeholders}) AND oa_score IS NOT NULL`
  );
  console.log('被删且带oa_score的周例会batch项:', r.recordset.length);

  const wb1 = JSON.parse(readFileSync('C:/Users/75597/AppData/Local/Temp/opencode/wb1-all.json', 'utf-8'));
  const emptyAudit = new Set(
    wb1.filter((d: any) => !String(d.audit).trim() && !String(d.score).trim()).map((d: any) => d.desc.trim())
  );

  const lost: any[] = [];
  for (const it of r.recordset) {
    const desc = String(it.description).trim();
    if (!emptyAudit.has(desc)) continue;
    const cur = await pool.request()
      .input('d', sql.NVarChar, it.description)
      .query(`SELECT id, oa_score, source_id FROM hyzs_action_items WHERE description = @d AND source_type = 'batch'`);
    const nowNull = cur.recordset.every(x => x.oa_score === null);
    if (nowNull) {
      lost.push({ backupId: it.id, oa_score: it.oa_score, desc, current: cur.recordset.map((c: any) => `${c.id}(${c.oa_score})`) });
    }
  }
  console.log('工作簿1无标记但备份有评分、且当前重建项无评分（系统手动V/X被丢）:', lost.length);
  lost.forEach(l => console.log(`  backup=${l.backupId} oa=${l.oa_score} | ${String(l.desc).slice(0, 40)} | 当前:${l.current.length}条`));
  await pool.close();
  process.exit(0);
}

main();
