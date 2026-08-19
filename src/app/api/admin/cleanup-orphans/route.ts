import { NextResponse } from 'next/server';
import { getPool } from '@/storage/database/sqlserver-storage';

// POST /api/admin/cleanup-orphans
// 清理已被删除的会议对应的孤儿行动项（hyzs_action_items）和 OA 记录
export async function POST() {
  try {
    const pool = await getPool();

    // 1. 获取所有有效会议ID
    const meetingsRes = await pool.request().query('SELECT id FROM hyzs_meetings');
    const validIds = new Set(meetingsRes.recordset.map((r: any) => r.id));

    // 2. 找出孤儿行动项
    const itemsRes = await pool.request().query('SELECT DISTINCT meeting_id FROM hyzs_action_items');
    const orphanIds = itemsRes.recordset
      .map((r: any) => r.meeting_id)
      .filter((id: string) => id && !validIds.has(id));

    if (orphanIds.length === 0) {
      return NextResponse.json({ success: true, data: { orphanMeetings: 0, deletedItems: 0, deletedOA: 0 } });
    }

    // 3. 删除孤儿行动项
    const idList = orphanIds.map((id: string) => `'${id.replace(/'/g, "''")}'`).join(',');
    const deleteRes = await pool.request().query(`DELETE FROM hyzs_action_items WHERE meeting_id IN (${idList})`);
    const deletedItems = deleteRes.rowsAffected[0] || 0;

    // 4. 删除OA记录（如果有OA链接服务器）
    let deletedOA = 0;
    try {
      const linked = process.env.OA_LINKED_SERVER || 'FWsv';
      const oaDb = process.env.OA_DATABASE_NAME || 'ecology';
      const oaTable = `[${linked}].[${oaDb}].[dbo].[uf_meetingplan]`;
      const oaDeleteRes = await pool.request().query(
        `DELETE FROM ${oaTable} WHERE task_id LIKE '______%' AND SUBSTRING(task_id, 0, CHARINDEX('__', task_id) - 1) IN (${idList})`
      );
      deletedOA = oaDeleteRes.rowsAffected[0] || 0;
    } catch (oaErr) {
      console.warn('[cleanup] OA删除失败:', oaErr);
    }

    return NextResponse.json({
      success: true,
      data: {
        orphanMeetings: orphanIds.length,
        deletedItems,
        deletedOA,
        meetingIds: orphanIds,
      },
    });
  } catch (error) {
    console.error('[cleanup]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '清理失败' },
      { status: 500 }
    );
  }
}

// GET /api/admin/cleanup-orphans — 预览孤儿数量（dry run）
export async function GET() {
  try {
    const pool = await getPool();

    const meetingsRes = await pool.request().query('SELECT id FROM hyzs_meetings');
    const validIds = new Set(meetingsRes.recordset.map((r: any) => r.id));

    const itemsRes = await pool.request().query('SELECT meeting_id FROM hyzs_action_items');
    const orphanIds = itemsRes.recordset
      .map((r: any) => r.meeting_id)
      .filter((id: string) => id && !validIds.has(id));

    return NextResponse.json({
      success: true,
      data: {
        orphanMeetings: orphanIds.length,
        orphanItems: itemsRes.recordset.length,
        totalItems: itemsRes.recordset.length,
        meetingIds: orphanIds,
      },
    });
  } catch (error) {
    console.error('[cleanup]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '查询失败' },
      { status: 500 }
    );
  }
}
