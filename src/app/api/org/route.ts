import { NextResponse } from 'next/server';
import { getOrgTree, searchEmployees } from '@/storage/database/org-storage';

// GET /api/org - 获取组织架构树
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('search');

    if (keyword) {
      // 搜索员工
      const employees = await searchEmployees(keyword);
      return NextResponse.json({ success: true, data: employees });
    }

    // 获取完整树
    const tree = await getOrgTree();
    return NextResponse.json({ success: true, data: tree });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
