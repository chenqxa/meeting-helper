import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/storage/database/sqlserver-storage';
import sql from 'mssql';

// GET /api/push-batch?pushId=xxx
// 查询某次持续项推送批次包含的行动项 ids（企微卡片点进来精确过滤用）
export async function GET(request: NextRequest) {
  try {
    const pushId = new URL(request.url).searchParams.get('pushId');
    if (!pushId) {
      return NextResponse.json({ success: false, error: '缺少 pushId' }, { status: 400 });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('pushId', sql.NVarChar, pushId)
      .query('SELECT id, meeting_type, item_ids, created_at FROM hyzs_push_batches WHERE id = @pushId');

    if (result.recordset.length === 0) {
      return NextResponse.json({ success: true, data: null });
    }
    const row = result.recordset[0];
    let itemIds: string[] = [];
    try { itemIds = JSON.parse(row.item_ids || '[]'); } catch { itemIds = []; }
    return NextResponse.json({
      success: true,
      data: { pushId: row.id, meetingType: row.meeting_type, itemIds, createdAt: row.created_at },
    });
  } catch (error) {
    console.error('[push-batch]', error);
    return NextResponse.json({ success: false, error: '查询失败' }, { status: 500 });
  }
}
