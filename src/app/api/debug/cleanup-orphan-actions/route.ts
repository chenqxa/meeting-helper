import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/storage/database/sqlserver-storage';
import * as sql from 'mssql';

export async function POST(request: NextRequest) {
  try {
    const pool = await getPool();

    // 删除 meeting_id 为空或指向不存在会议的行动项
    const result = await pool.request().query(`
      DELETE FROM hyzs_action_items
      WHERE meeting_id IS NULL OR meeting_id = ''
         OR meeting_id NOT IN (SELECT id FROM hyzs_meetings WHERE id IS NOT NULL)
    `);

    const deletedCount = result.rowsAffected[0] || 0;

    return NextResponse.json({
      success: true,
      message: `已清理 ${deletedCount} 条无效行动项`,
      deletedCount,
    });
  } catch (error) {
    console.error('[cleanup/orphan-actions]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '服务器错误' },
      { status: 500 }
    );
  }
}
