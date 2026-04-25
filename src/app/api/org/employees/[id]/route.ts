import { NextRequest, NextResponse } from 'next/server';
import { getEmployeeById, updateEmployee, deleteEmployee } from '@/storage/database/org-storage';

// GET /api/org/employees/[id] - 获取单个员工
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const emp = await getEmployeeById(id);
    if (!emp) {
      return NextResponse.json(
        { success: false, error: '员工不存在' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: emp });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/org/employees/[id] - 更新员工
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const emp = await updateEmployee(id, body);
    if (!emp) {
      return NextResponse.json(
        { success: false, error: '员工不存在' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: emp });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/org/employees/[id] - 删除员工
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const success = await deleteEmployee(id);
    if (!success) {
      return NextResponse.json(
        { success: false, error: '员工不存在' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
