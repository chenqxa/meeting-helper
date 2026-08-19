// 补导工作簿1 中缺失的非持续提议（去重后），节点列用修正后的分类逻辑
import 'dotenv/config';
import { readFileSync } from 'fs';
import { createTaskBatch, updateTaskBatch } from '../src/storage/database/batch-storage';
import { createActionItem } from '../src/storage/database/action-storage';
import { resolveActionOwnerIdentity } from '../src/lib/action-owner';

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
  if (s === '持续' || s === '每天') return 'continuous';
  if (/^\d+$/.test(s) && Number(s) > 10000) return 'date';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date';
  return 'tbd';
};

async function main() {
  const file = process.argv[2] || 'C:/Users/75597/AppData/Local/Temp/opencode/missing.json';
  const raw: any[] = JSON.parse(readFileSync(file, 'utf-8'));
  console.log(`待导入 ${raw.length} 条`);

  const batch = await createTaskBatch({
    title: '导入_周例会_2026-08-03_补导缺失',
    sourceChannel: 'other',
    status: 'draft',
    createdBy: '系统补导',
    createdByLoginId: null,
    oaPushedAt: null,
  });
  console.log(`批次: ${batch.id} ${batch.title}`);

  let ok = 0, fail = 0;
  for (const r of raw) {
    try {
      const resolved = await resolveActionOwnerIdentity({
        owner: r.owner || null,
        ownerLoginId: null,
        dept: r.dept || null,
      });
      const type = classifyNode(r.node);
      const dueDate = type === 'date' ? fmtDate(r.node) : null;
      const meetingDate = r.date ? fmtDate(r.date) : '';

      await createActionItem({
        meetingId: null,
        description: r.description,
        owner: resolved.owner || r.owner || null,
        ownerLoginId: resolved.ownerLoginId || null,
        ownerOaId: resolved.ownerOaId || null,
        dept: resolved.dept || r.dept || null,
        dueDate: dueDate,
        dueDateType: type,
        priority: 'medium',
        status: 'pending',
        sourceType: 'batch',
        sourceId: batch.id,
        proposer: r.proposer || null,
        sourceText: r.cat || null,
        oaScore: r.score ? Number(r.score) : null,
        initialResult: meetingDate ? JSON.stringify({ d: meetingDate }) : null,
      });
      ok++;
    } catch (e) {
      fail++;
      console.error('导入失败:', r.description, e);
    }
  }

  await updateTaskBatch(batch.id, { title: batch.title });
  console.log(`导入完成: 成功 ${ok} 条, 失败 ${fail} 条`);
  process.exit(0);
}

main();
