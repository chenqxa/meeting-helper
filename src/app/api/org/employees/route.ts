import { NextRequest, NextResponse } from 'next/server';
import { createEmployee, getEmployees } from '@/storage/database/org-storage';

// GET /api/org/employees - 获取员工列表
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const departmentId = searchParams.get('departmentId') || undefined;
    const employees = await getEmployees(departmentId);
    return NextResponse.json({ success: true, data: employees });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/org/employees - 创建员工
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, code, position, departmentId, email, phone, managerId, status = 'active', joinedAt } = body;

    if (!name || !code || !departmentId) {
      return NextResponse.json(
        { success: false, error: '缺少必填字段：name, code, departmentId' },
        { status: 400 }
      );
    }

    const emp = await createEmployee({
      name,
      code,
      position,
      departmentId,
      email,
      phone,
      managerId,
      status,
      joinedAt: joinedAt || new Date().toISOString().split('T')[0],
    });

    return NextResponse.json({ success: true, data: emp });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
