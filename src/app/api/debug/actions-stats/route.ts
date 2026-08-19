import { NextResponse } from 'next/server';
import { getPool } from '@/storage/database/sqlserver-storage';
import * as sql from 'mssql';

export async function GET() {
  try {
    const pool = await getPool();

    // 统计总行动项数
    const totalResult = await pool.request().query(`SELECT COUNT(*) as total FROM hyzs_action_items`);
    const total = totalResult.recordset[0]?.total || 0;

    // 统计按会议状态分组
    const statusResult = await pool.request().query(`
      SELECT m.status, COUNT(*) as count
      FROM hyzs_action_items a
      LEFT JOIN hyzs_meetings m ON a.meeting_id = m.id
      GROUP BY m.status
    `);

    // 统计无会议关联的行动项
    const noMeetingResult = await pool.request().query(`
      SELECT COUNT(*) as count FROM hyzs_action_items WHERE meeting_id IS NULL OR meeting_id = ''
    `);
    const noMeeting = noMeetingResult.recordset[0]?.count || 0;

    return NextResponse.json({
      success: true,
      data: {
        total,
        byMeetingStatus: statusResult.recordset,
        noMeeting,
      },
    });
  } catch (error) {
    console.error('[debug/actions-stats]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}
