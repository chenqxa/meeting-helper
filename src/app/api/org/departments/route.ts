import { NextRequest, NextResponse } from 'next/server';
import { createDepartment, getDepartments } from '@/storage/database/org-storage';

// GET /api/org/departments - 获取所有部门列表
export async function GET() {
  try {
    const departments = await getDepartments();
    return NextResponse.json({ success: true, data: departments });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/org/departments - 创建部门
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, code, parentId, managerId, description, sort = 0, status = 'active' } = body;

    if (!name || !code) {
      return NextResponse.json(
        { success: false, error: '缺少必填字段：name 或 code' },
        { status: 400 }
      );
    }

    const dept = await createDepartment({
      name,
      code,
      parentId: parentId || null,
      managerId,
      description,
      sort,
      status,
    });

    return NextResponse.json({ success: true, data: dept });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
