import { NextResponse } from 'next/server';
import { guardWrite } from '@/lib/api-guard';
import { clearAllData } from '@/storage/database/org-storage';

// POST /api/org/clear - 清空所有组织架构数据
export async function POST() {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;
    await clearAllData();
    return NextResponse.json({ success: true, message: '数据已清空' });
  } catch (error) {
    console.error('Clear Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
