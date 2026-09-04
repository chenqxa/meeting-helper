import { NextResponse } from 'next/server';
import { guardWrite } from '@/lib/api-guard';

// 泛微OA API配置（从环境变量读取）
const WEAVER_API_URL = process.env.WEAVER_API_URL || '';
const WEAVER_API_KEY = process.env.WEAVER_API_KEY || '';

// POST /api/org/pull - 从泛微OA拉取组织架构数据
export async function POST() {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;
    if (!WEAVER_API_URL || !WEAVER_API_KEY) {
      return NextResponse.json(
        { success: false, error: '未配置泛微OA API地址和密钥，请在.env文件中设置 WEAVER_API_URL 和 WEAVER_API_KEY' },
        { status: 400 }
      );
    }

    // 调用泛微OA API获取部门数据
    const deptRes = await fetch(`${WEAVER_API_URL}/api/departments`, {
      headers: {
        'Authorization': `Bearer ${WEAVER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const deptData = await deptRes.json();

    // 调用泛微OA API获取员工数据
    const empRes = await fetch(`${WEAVER_API_URL}/api/employees`, {
      headers: {
        'Authorization': `Bearer ${WEAVER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const empData = await empRes.json();

    // 将拉取的数据转发到同步接口
    const syncRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000'}/api/org/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'full',
        removeMissing: true,
        departments: deptData.data || [],
        employees: empData.data || [],
      }),
    });
    const syncResult = await syncRes.json();

    return NextResponse.json(syncResult);
  } catch (error) {
    console.error('Pull Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
