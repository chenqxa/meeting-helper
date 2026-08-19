// 回填 proposer_dept：按提出人匹配组织架构部门，写入快照
import 'dotenv/config';
import * as sql from 'mssql';
import { parseConnectionString } from '../src/storage/database/sqlserver-storage';
import { getEmployees, getDepartments } from '../src/storage/database/org-storage';

async function main() {
  const employees = await getEmployees();
  const depts = await getDepartments();
  const deptName = new Map<string, string>();
  depts.forEach(d => { if (d.id) deptName.set(String(d.id), String(d.name || '')); });

  const proposerDept = new Map<string, string>();
  employees.forEach(e => {
    if (e.name) proposerDept.set(String(e.name).trim(), deptName.get(String(e.departmentId || '')) || '');
  });
  console.log(`组织员工 ${employees.length} 人，可映射提出人 ${proposerDept.size} 人`);

  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  const items = await pool.request()
    .query(`SELECT id, proposer FROM hyzs_action_items WHERE proposer IS NOT NULL AND proposer <> '' AND (proposer_dept IS NULL OR proposer_dept = '')`);

  let updated = 0;
  let unmatched: string[] = [];
  for (const r of items.recordset) {
    const dept = proposerDept.get(String(r.proposer).trim());
    if (dept) {
      await pool.request()
        .input('id', sql.NVarChar, r.id)
        .input('d', sql.NVarChar, dept)
        .query(`UPDATE hyzs_action_items SET proposer_dept = @d WHERE id = @id`);
      updated++;
    } else {
      if (!unmatched.includes(String(r.proposer))) unmatched.push(String(r.proposer));
    }
  }
  console.log(`已回填 proposer_dept: ${updated} / ${items.recordset.length}`);
  console.log(`未匹配到部门的提出人(${unmatched.length}人): ${unmatched.slice(0, 30).join('、')}`);
  await pool.close();
  process.exit(0);
}

main();
