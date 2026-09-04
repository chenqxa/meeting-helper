// 以工作簿1 为准重建台账 batch 部分（不去重，Excel 里有的全部导入）：
// 1) 删除上一版重建批次（去重后 1070 条）
// 2) 重新导入工作簿1 的全部非持续提议（1134 条，含每条 X/V/空，含所有重复）
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { createTaskBatch, updateTaskBatch } from '../src/storage/database/batch-storage';
import { createActionItem, deleteActionItem, getAllActionItems } from '../src/storage/database/action-storage';
import { resolveActionOwnerIdentity } from '../src/lib/action-owner';

const TARGET_BATCHES = ['BATCH_1785734701955_78HF8'];

const fmtDate = (v: string): string => {
  const s = String(v || '').trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n > 10000) {
      const d = new Date((n - 25569) * 86400 * 1000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return s;
};

const classifyNode = (v: string): 'continuous' | 'date' | 'tbd' => {
  const s = String(v || '').trim();
  if (!s) return 'tbd';
  if (s === '持续') return 'continuous';
  if (/^\d+$/.test(s) && Number(s) > 10000) return 'date';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
  return 'tbd';
};

const toScore = (audit: string, score: string): number | null => {
  const s = String(audit || score || '').trim().toUpperCase();
  if (s === 'X') return -1;
  if (s === 'V') return 1;
  if (s === '0' || s === 'O') return 0;
  return null;
};

const isX = (audit: string, score: string): boolean =>
  String(audit).trim().toUpperCase() === 'X' || String(score).trim().toUpperCase() === 'X';

async function main() {
  // 1. 删除目标批次非持续项
  const all = await getAllActionItems({ includeCancelled: true });
  const toDelete = all.filter(i =>
    i.sourceType === 'batch' &&
    TARGET_BATCHES.includes(i.sourceId || '') &&
    i.dueDateType !== 'continuous'
  );
  let deleted = 0;
  for (const it of toDelete) { await deleteActionItem(it.id); deleted++; }
  console.log(`删除非持续项: ${deleted} 条`);

  // 2. 从工作簿1 准备数据
  const wb1 = JSON.parse(readFileSync('C:/Users/75597/AppData/Local/Temp/opencode/wb1-all.json', 'utf-8'));
  const rows = wb1.filter((d: any) => d.node !== '持续');
  console.log(`工作簿1 非持续提议: ${rows.length} 条（全部导入，不去重）`);
  const toImport = rows;
  console.log(`本次导入总数: ${toImport.length} 条`);

  const batch = await createTaskBatch({
    title: '导入_周例会_2026-08-03_重建台账',
    sourceChannel: 'other',
    status: 'draft',
    createdBy: '系统重建',
    createdByLoginId: null,
    oaPushedAt: null,
  });
  console.log(`批次: ${batch.id}`);

  let ok = 0, fail = 0;
  const backup: any[] = [];
  for (const r of toImport) {
    try {
      const resolved = await resolveActionOwnerIdentity({ owner: r.owner || null, ownerLoginId: null, dept: r.dept || null });
      const type = classifyNode(r.node);
      const dueDate = type === 'date' ? fmtDate(r.node) : null;
      const meetingDate = r.date ? fmtDate(r.date) : '';
      const oaScore = toScore(r.audit, r.score);
      await createActionItem({
        meetingId: null,
        description: r.desc,
        owner: resolved.owner || r.owner || null,
        ownerLoginId: resolved.ownerLoginId || null,
        ownerOaId: resolved.ownerOaId || null,
        dept: resolved.dept || r.dept || null,
        dueDate,
        dueDateType: type,
        priority: 'medium',
        status: 'pending',
        sourceType: 'batch',
        sourceId: batch.id,
        proposer: r.proposer || null,
        sourceText: r.cat || null,
        oaScore,
        initialResult: meetingDate ? JSON.stringify({ d: meetingDate }) : null,
      });
      backup.push({ desc: r.desc, owner: r.owner, oaScore, week: r.week, node: r.node, date: r.date });
      ok++;
    } catch (e) {
      fail++;
      console.error('失败:', r.desc, e);
    }
  }
  await updateTaskBatch(batch.id, { title: batch.title });
  writeFileSync('C:/Users/75597/AppData/Local/Temp/opencode/rebuild-backup.json', JSON.stringify(backup), 'utf8');
  console.log(`导入完成: 成功 ${ok}, 失败 ${fail}`);
  process.exit(0);
}

main();
