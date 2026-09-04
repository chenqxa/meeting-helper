// 恢复被误删的已处理（OA回传/已完成）项的处理数据到重建后的对应记录
import 'dotenv/config';
import * as sql from 'mssql';
import { parseConnectionString } from '../src/storage/database/sqlserver-storage';

const PROCESSED_IDS = [
  'ACT_1785491504477_Q735W',
  'ACT_1785491504409_NPC0M',
  'ACT_1785489782386_2EEQV',
  'ACT_1785489782354_61NR4',
];

async function main() {
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  for (const id of PROCESSED_IDS) {
    const b = await pool.request()
      .input('id', sql.NVarChar, id)
      .query(`SELECT description, oa_result, oa_result_at, oa_score, status, completed_at, completed_by, oa_attachments, source_text FROM hyzs_action_items_backup_20260803 WHERE id = @id`);
    const r = b.recordset[0];
    if (!r) { console.log(`备份中找不到 ${id}`); continue; }

    const cur = await pool.request()
      .input('d', sql.NVarChar, r.description)
      .query(`SELECT id, status, oa_score, oa_result FROM hyzs_action_items WHERE description = @d AND source_type = 'batch' ORDER BY created_at DESC`);
    console.log(`=== ${id} desc=${String(r.description).slice(0, 30)}`);
    console.log(`   备份: status=${r.status} oa_score=${r.oa_score} oa_result=${String(r.oa_result || '').slice(0, 40)} at=${r.oa_result_at}`);
    console.log(`   当前匹配 ${cur.recordset.length} 条`);

    if (cur.recordset.length === 0) {
      // 重新插入该记录
      const ins = await pool.request()
        .input('id', sql.NVarChar, id)
        .input('desc', sql.NVarChar, r.description)
        .input('oa_result', sql.NVarChar, r.oa_result)
        .input('oa_result_at', sql.NVarChar, r.oa_result_at)
        .input('oa_score', sql.Float, r.oa_score)
        .input('status', sql.NVarChar, r.status)
        .input('completed_at', sql.NVarChar, r.completed_at)
        .input('completed_by', sql.NVarChar, r.completed_by)
        .query(`INSERT INTO hyzs_action_items (id, description, status, oa_result, oa_result_at, oa_score, completed_at, completed_by, source_type, due_date_type, created_at, updated_at)
          VALUES (@id, @desc, @status, @oa_result, @oa_result_at, @oa_score, @completed_at, @completed_by, 'batch', 'date', GETDATE(), GETDATE())`);
      console.log(`   无匹配，已重新插入 ${id}`);
    } else {
      // 更新第一条匹配项（最早的重建项）为处理状态
      const target = cur.recordset[0];
      const upd = await pool.request()
        .input('id', sql.NVarChar, target.id)
        .input('oa_result', sql.NVarChar, r.oa_result)
        .input('oa_result_at', sql.NVarChar, r.oa_result_at)
        .input('oa_score', sql.Float, r.oa_score)
        .input('status', sql.NVarChar, r.status)
        .input('completed_at', sql.NVarChar, r.completed_at)
        .input('completed_by', sql.NVarChar, r.completed_by)
        .query(`UPDATE hyzs_action_items SET oa_result=@oa_result, oa_result_at=@oa_result_at, oa_score=@oa_score, status=@status, completed_at=@completed_at, completed_by=@completed_by WHERE id=@id`);
      console.log(`   已把处理数据恢复到 ${target.id}`);
    }
  }
  await pool.close();
  console.log('完成');
  process.exit(0);
}

main();
