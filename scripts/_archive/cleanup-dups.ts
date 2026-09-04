// 清理行动项重复与无效数据：
// 1) batch 项按描述去重，保留最完整的一条（优先持续项/有OA结果/有有效日期）
// 2) 修正无效日期文本（持续/每天→continuous，其余→tbd）
// 3) 删除冗余重复项（仅 batch 来源，不碰会议/项目数据）
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { getAllActionItems, updateActionItem, deleteActionItem } from '../src/storage/database/action-storage';

const isValidDate = (d: string | null | undefined): boolean => !!d && /^\d{4}-\d{2}-\d{2}/.test(d);
const isGarbageDateText = (d: string | null | undefined, t: string | null | undefined): boolean =>
  !!d && t === 'date' && !isValidDate(d);

async function main() {
  const all = await getAllActionItems({ includeCancelled: true });
  const batchItems = all.filter(i => i.sourceType === 'batch');

  // 按描述分组
  const groups = new Map<string, typeof batchItems>();
  for (const it of batchItems) {
    const k = it.description.trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  const report: string[] = [];
  let deleted = 0;
  let fixed = 0;
  const backup: any[] = [];

  const pickKeep = (items: typeof batchItems) => {
    const continuous = items.filter(i => i.dueDateType === 'continuous');
    if (continuous.length) {
      return continuous.find(i => i.oaResult) || continuous.find(i => !i.oaResult && !i.owner === undefined) || continuous[0];
    }
    const withOa = items.filter(i => i.oaResult);
    if (withOa.length) return withOa[0];
    const withDate = items.filter(i => isValidDate(i.dueDate));
    if (withDate.length) return withDate[0];
    return items[0];
  };

  for (const [desc, items] of groups.entries()) {
    const keep = pickKeep(items);
    // 保留项：若 due_date 是无效文本，修正 due_date_type
    if (isGarbageDateText(keep.dueDate, keep.dueDateType)) {
      const text = (keep.dueDate || '').trim();
      const newType = text === '持续' || text === '每天' ? 'continuous' : 'tbd';
      backup.push({ id: keep.id, due_date: keep.dueDate, due_date_type: keep.dueDateType, action: 'fix', desc });
      await updateActionItem(keep.id, { dueDateType: newType, dueDate: null });
      report.push(`[修正] ${keep.id}  ${desc}  due_date="${text}" -> type=${newType}`);
      fixed++;
    }
    // 删除其余重复
    for (const it of items) {
      if (it.id === keep.id) continue;
      backup.push({ id: it.id, description: desc, due_date: it.dueDate, due_date_type: it.dueDateType, owner: it.owner, source_id: it.sourceId, action: 'delete' });
      await deleteActionItem(it.id);
      deleted++;
    }
  }

  // 唯一但仍是垃圾日期的项（不在重复组里）
  const allDescSet = new Set(groups.keys());
  for (const it of batchItems) {
    const inGroup = allDescSet.has(it.description.trim()) && (groups.get(it.description.trim())!.length > 1);
    if (inGroup) continue;
    if (isGarbageDateText(it.dueDate, it.dueDateType)) {
      const text = (it.dueDate || '').trim();
      const newType = text === '持续' || text === '每天' ? 'continuous' : 'tbd';
      backup.push({ id: it.id, due_date: it.dueDate, due_date_type: it.dueDateType, action: 'fix', desc: it.description });
      await updateActionItem(it.id, { dueDateType: newType, dueDate: null });
      report.push(`[修正-唯一] ${it.id}  ${it.description}  due_date="${text}" -> type=${newType}`);
      fixed++;
    }
  }

  writeFileSync('C:/Users/75597/AppData/Local/Temp/opencode/cleanup-backup.json', JSON.stringify(backup, null, 0), 'utf8');
  console.log(`=== 清理完成 ===`);
  console.log(`删除重复: ${deleted} 条`);
  console.log(`修正无效日期: ${fixed} 条`);
  console.log(`受影响明细已备份: cleanup-backup.json`);
  report.forEach(l => console.log(l));
  process.exit(0);
}

main();
