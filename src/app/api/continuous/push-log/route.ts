import { NextResponse } from 'next/server';
import * as sql from 'mssql';
import { getAppPool } from '@/lib/oa-task-push';
import { getPool } from '@/storage/database/sqlserver-storage';
import { getContinuousProgressMap, getAllProgress } from '@/storage/database/continuous-progress-storage';
import { getAllActionItems } from '@/storage/database/action-storage';
import { getMeetings } from '@/storage';

// GET /api/continuous/push-log - 持续项推送记录 + 填报情况
// 返回：按推送周期分组，每条含责任人/内容/填报状态/填报内容/附件/来源/填报时间/来源会议
export async function GET() {
  try {
    const [pool, progressMap, allProgress, allActions, allMeetings] = await Promise.all([
      getAppPool(),
      getContinuousProgressMap(),
      getAllProgress(),
      getAllActionItems(),
      getMeetings(),
    ]);
    const actionMap = new Map(allActions.map(a => [a.id, a]));
    const meetingInfoMap = new Map(allMeetings.map(m => [m.id, { title: m.title, meetingDate: m.meetingDate || '', type: m.type || '' }]));
    // 批次来源（导入的持续项 meeting_title 实际是批次名）
    const batchInfoMap = new Map<string, { title: string; createdAt: string }>();
    try {
      const { getAllTaskBatches } = await import('@/storage');
      const batches = await getAllTaskBatches();
      for (const b of batches) batchInfoMap.set(b.id, { title: b.title, createdAt: b.createdAt });
    } catch { /* batch 表可能不存在 */ }
    // 填报记录 → 对应持续项的来源（会议或批次）与日期，用于和持续项列表对上
    const resolveSource = (actionId: string) => {
      const action: any = actionMap.get(actionId);
      const info = action?.meetingId ? meetingInfoMap.get(action.meetingId) : null;
      const batch = (!action?.meetingId && action?.sourceType === 'batch' && action?.sourceId)
        ? batchInfoMap.get(action.sourceId) : null;
      return {
        meetingTitle: info?.title || batch?.title || '',
        meetingType: info?.type || '',
        itemDate: info?.meetingDate || (action?.createdAt ? String(action.createdAt).slice(0, 10) : ''),
      };
    };
    const linked = process.env.OA_LINKED_SERVER || 'FWsv';
    const db = process.env.OA_DATABASE_NAME || 'ecology';
    const tbl = `[${linked}].[${db}].[dbo].[uf_meetingplan]`;

    const r = await pool.request().query(`
      SELECT task_id, owner_name, owner_loginid, description, wcjgsm, wcqkfj,
             hylx, xdxlx,
             CONVERT(nvarchar(20), modedatacreatetime) AS create_time,
             CONVERT(nvarchar(20), modedatacreatedate) AS create_date,
             CONVERT(nvarchar(20), modedatamodifydatetime) AS modify_time,
             CAST(status AS INT) AS status, due_date
      FROM ${tbl}
      WHERE CAST(source_app AS NVARCHAR(50)) = 'HYZS_CONT'
      ORDER BY id DESC
    `);

    const oaBase = process.env.WEAVER_OA_URL || '';
    const tasks: any[] = (r.recordset || []).map((row: any) => {
      const taskId = String(row.task_id || '').trim();
      // task_id: CONT_周例会_2026-08-05__ACT_xxx_2026-08-05
      const parts = taskId.split('__');
      // 标准格式解析；非标准格式（如 TEST_CQX_xxx）用 ACT_<taskId> 匹配本系统 action
      let actionId = parts.length === 2 ? parts[1].slice(0, parts[1].lastIndexOf('_')) : '';
      if (!actionId) actionId = `ACT_${taskId}`;
      const fileIds = String(row.wcqkfj || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      const taskCycleDate = parts[1] ? parts[1].slice(parts[1].lastIndexOf('_') + 1) : '';
      // 周期归属：优先用推送记录自身的周期（task_id 尾部日期）
      const cycleDate = taskCycleDate || String(row.create_date || '').trim() || '';
      // 会议类型：优先 hylx 字段，其次从 task_id 头部解析（CONT_<类型>_日期）
      const meetingType = String(row.hylx || '').trim()
        || (parts[0] ? parts[0].replace(/^CONT_/, '').replace(/_\d{4}-\d{2}-\d{2}$/, '') : '');
      const sourceInfo = resolveSource(actionId);
      return {
        taskId,
        actionId,
        meetingType,
        meetingTitle: sourceInfo.meetingTitle,
        itemDate: sourceInfo.itemDate,
        ownerName: String(row.owner_name || '').trim(),
        ownerLoginId: String(row.owner_loginid || '').trim(),
        description: String(row.description || '').trim(),
        cycleDate,
        pushDate: String(row.create_date || '').trim(),
        pushTime: String(row.create_time || '').trim(),
        modifyTime: String(row.modify_time || '').trim(),
        oaStatus: row.status ?? 0,
        oaFilled: String(row.wcjgsm || '').trim(), // OA 自身填报（暂存，后面统一归并）
        filled: false as boolean,
        content: null as string | null,
        syncedAt: null as string | null,
        source: 'OA',
        reportSource: '未填',
        // 附件：fileid → OA 下载链接
        attachments: fileIds.map((fid: string) => ({
          fileId: fid,
          url: oaBase ? `${oaBase}/weaver/weaver.file.FileDownload?fileid=${fid}` : fid,
        })),
      };
    });

    // ── 填报归并：每条推送记录找到它所属周期的填报 ──
    // 规则：
    //   1) 优先精确匹配：进度表里 cycleDate 与推送日相同的记录（OA 直接填报）
    //   2) 其次「会议助手」待办汇报：汇报日期落在 [本推送日, 下个推送日) 区间内的记录归入本周期
    //      —— 例：8/14 推送，8/17 在待办汇报 → 归入 8/14 周期，显示「推送 8/14 + 已填」
    //   3) 都没有 → 未填
    const usedMyTodoKeys = new Set<string>();
    const oaPushesByAction = new Map<string, any[]>();
    for (const t of tasks) {
      if (!oaPushesByAction.has(t.actionId)) oaPushesByAction.set(t.actionId, []);
      oaPushesByAction.get(t.actionId)!.push(t);
    }
    for (const arr of oaPushesByAction.values()) arr.sort((a, b) => a.cycleDate.localeCompare(b.cycleDate));

    for (const t of tasks) {
      const recs = allProgress[t.actionId] || [];
      // 同 actionId 下一个推送日（周期上界）
      const pushes = oaPushesByAction.get(t.actionId) || [];
      const nextPush = pushes.find(p => p.cycleDate > t.cycleDate)?.cycleDate || '9999-12-31';
      let match = recs.find((rec: any) => rec.cycleDate === t.cycleDate) || null;
      if (!match) {
        match = recs.find((rec: any) =>
          rec.source === '会议助手' && rec.cycleDate >= t.cycleDate && rec.cycleDate < nextPush
        ) || null;
      }
      if (match?.source === '会议助手') usedMyTodoKeys.add(`${t.actionId}__${match.oaTaskId}`);
      const oaFilled = t.oaFilled || '';
      const content = match?.progress || oaFilled || null;
      t.filled = !!content;
      t.content = content;
      t.syncedAt = match?.syncedAt || String(t.modifyTime || '').trim() || null;
      t.source = match?.source || 'OA';
      t.reportSource = match?.source || (oaFilled ? 'OA' : '未填');
      // 系统内(会议助手)填报的附件：取该行动项当前 oa_attachments（本地 /api/files 图片）
      t.localAttachments = t.source === '会议助手' ? (actionMap.get(t.actionId)?.oaAttachments || []) : [];
    }

    // ── 合并未被推送周期覆盖的「会议助手」填报（该持续项没有对应 OA 推送，如新导入尚未推送）──
    // 只添加没有被上面归并过的记录
    const myTodoProgressTasks: any[] = [];
    for (const [actionId, records] of Object.entries(allProgress)) {
      const myTodoRecs = records.filter((rec: any) => rec.source === '会议助手');
      if (myTodoRecs.length === 0) continue;
      const action = actionMap.get(actionId);
      const sourceInfo = resolveSource(actionId);
      // 会议来源 → 会议类型；批次/独立 → source_text；都没有则空
      const meetingType = (action?.meetingId ? sourceInfo.meetingType : null)
        || (action as any)?.sourceText || (action as any)?.batchType || '';
      for (const rec of myTodoRecs) {
        if (usedMyTodoKeys.has(`${actionId}__${rec.oaTaskId}`)) continue; // 已归并到推送周期
        myTodoProgressTasks.push({
          taskId: rec.oaTaskId,
          actionId,
          meetingType,
          meetingTitle: sourceInfo.meetingTitle,
          itemDate: sourceInfo.itemDate,
          ownerName: action?.owner || '',
          ownerLoginId: action?.ownerLoginId || '',
          description: action?.description || '',
          cycleDate: rec.cycleDate,
          pushDate: rec.cycleDate,
          pushTime: '',
          modifyTime: rec.syncedAt,
          oaStatus: rec.oaStatus ?? 0,
          filled: !!rec.progress,
          content: rec.progress || null,
          syncedAt: rec.syncedAt,
          source: '会议助手',
          reportSource: '会议助手',
          attachments: [],
          localAttachments: action?.oaAttachments || [],
        });
      }
    }
    tasks.push(...myTodoProgressTasks);

    // 按推送周期分组（用 task_id 里的日期 + create_date 归并，取 pushDate 为主）
    const groups = new Map<string, any[]>();
    for (const t of tasks) {
      // 周期 = task_id 尾部的日期（cycleDate），没有则用 pushDate
      const key = t.cycleDate || t.pushDate || '未知周期';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const cycles = Array.from(groups.entries())
      .map(([date, items]) => ({
        date,
        total: items.length,
        filled: items.filter(i => i.filled).length,
        unfilled: items.filter(i => !i.filled).length,
        items,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({ success: true, data: cycles });
  } catch (error) {
    console.error('[continuous/push-log]', error);
    return NextResponse.json({ success: false, error: '查询失败' }, { status: 500 });
  }
}
