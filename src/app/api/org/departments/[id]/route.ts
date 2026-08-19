import { NextRequest, NextResponse } from 'next/server';
import { getDepartmentById, updateDepartment, deleteDepartmentCascade } from '@/storage/database/org-storage';

// GET /api/org/departments/[id] - 获取单个部门
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const dept = await getDepartmentById(id);
    if (!dept) {
      return NextResponse.json(
        { success: false, error: '部门不存在' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: dept });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/org/departments/[id] - 更新部门
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const dept = await updateDepartment(id, body);
    if (!dept) {
      return NextResponse.json(
        { success: false, error: '部门不存在' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: dept });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/org/departments/[id] - 删除部门
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteDepartmentCascade(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
