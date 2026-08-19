import { NextResponse } from 'next/server';
import { getAllProgress } from '@/storage/database/continuous-progress-storage';

// GET /api/continuous/progress - 查询全部进展归集
export async function GET() {
  try {
    const map = await getAllProgress();
    return NextResponse.json({ success: true, data: map });
  } catch (error) {
    return NextResponse.json({ success: false, error: '查询失败' }, { status: 500 });
  }
}
