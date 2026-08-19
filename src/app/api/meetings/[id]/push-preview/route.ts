import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById } from '@/storage';
import { getAppPool } from '@/lib/oa-task-push';
const oaTable = (n: string) => `[${process.env.OA_LINKED_SERVER||'FWsv'}].[${process.env.OA_DATABASE_NAME||'ecology'}].[dbo].[${n}]`;

// GET /api/meetings/[id]/push-preview
// 预览本次锁定会推送给 OA 的内容（不实际推送），用于排查责任人为空问题
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params;
  const meeting = await getMeetingById(meetingId);
  if (!meeting) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const items: any[] = meeting.actionItems || [];

  // 同步姓名反查逻辑（与 pushMeetingTasksToOA 一致）
  const itemOwnerName = (i: any) => (i.owner || i.assignee || '').trim();
  const nameLoginidCache = new Map<string, string>();
  const hrmIdMap = new Map<string, number>();

  const needResolve = items.filter(i => !i.ownerLoginId && itemOwnerName(i));
  if (needResolve.length > 0) {
    try {
      const p = await getAppPool();
      const tbl = oaTable('HrmResource');
      const names = [...new Set(needResolve.map(itemOwnerName))];
      const nameList = names.map(n => `N'${n.replace(/'/g, "''")}'`).join(',');
      const res = await p.request().query(
        `SELECT loginid, lastname, firstname,
                LTRIM(RTRIM(ISNULL(lastname,'') + ISNULL(firstname,''))) AS fullname
         FROM ${tbl}
         WHERE (lastname IN (${nameList})
            OR  LTRIM(RTRIM(ISNULL(lastname,'') + ISNULL(firstname,''))) IN (${nameList}))
           AND status = 1`
      );
      res.recordset.forEach((r: any) => {
        if (r.lastname) nameLoginidCache.set(r.lastname.trim(), r.loginid);
        if (r.fullname) nameLoginidCache.set(r.fullname.trim(), r.loginid);
      });
    } catch { /* ignore */ }
  }

  const resolvedItems = items.map((i: any) => ({
    ...i,
    _resolvedLoginId: i.ownerLoginId || nameLoginidCache.get(itemOwnerName(i)) || '',
    _ownerName: itemOwnerName(i),
  }));

  const loginids = [...new Set(resolvedItems.map((i: any) => i._resolvedLoginId).filter(Boolean))];
  if (loginids.length > 0) {
    try {
      const p = await getAppPool();
      const tbl = oaTable('HrmResource');
      const idList = loginids.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
      const res = await p.request().query(`SELECT id, loginid FROM ${tbl} WHERE loginid IN (${idList})`);
      res.recordset.forEach((r: any) => hrmIdMap.set(r.loginid, r.id));
    } catch { /* ignore */ }
  }

  const preview = resolvedItems.map((i: any) => ({
    id: i.id,
    description: (i.description || '').slice(0, 30),
    owner_raw: i.owner,
    assignee_raw: i.assignee,
    ownerLoginId_stored: i.ownerLoginId || null,
    owner_name_resolved: i._ownerName,
    loginid_resolved: i._resolvedLoginId || null,
    zrrxm_resolved: hrmIdMap.get(i._resolvedLoginId) ?? null,
    issue: !i._ownerName ? '⚠️ owner/assignee 均为空'
         : !i._resolvedLoginId ? `⚠️ "${i._ownerName}" 在 OA HrmResource 中未找到`
         : !hrmIdMap.get(i._resolvedLoginId) ? `⚠️ loginid "${i._resolvedLoginId}" 无对应 HrmResource.id`
         : '✓ OK',
  }));

  return NextResponse.json({ success: true, total: items.length, preview });
}
