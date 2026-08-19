import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getCadenceConfigs, createCadenceConfig, updateCadenceConfig, deleteCadenceConfig } from '@/storage/database/cadence-storage';

export async function GET() {
  try {
    const configs = await getCadenceConfigs();
    return NextResponse.json({ success: true, data: configs });
  } catch (error) {
    return NextResponse.json({ success: false, error: '获取配置失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.loginid !== 'chenqiaoxia' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }
    const body = await request.json();
    const existing = await getCadenceConfigs();
    if (existing.find(c => c.meetingType === body.meetingType)) {
      return NextResponse.json({ success: false, error: '该会议类型已存在配置' }, { status: 400 });
    }
    const config = await createCadenceConfig({
      meetingType: body.meetingType,
      cadence: body.cadence,
      triggerDay: body.triggerDay,
      triggerTime: body.triggerTime,
      enabled: body.enabled !== false,
    });
    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    return NextResponse.json({ success: false, error: '创建失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.loginid !== 'chenqiaoxia' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }
    const body = await request.json();
    const { id, ...rest } = body;
    const config = await updateCadenceConfig(id, rest);
    if (!config) return NextResponse.json({ success: false, error: '配置不存在' }, { status: 404 });
    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    return NextResponse.json({ success: false, error: '修改失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.loginid !== 'chenqiaoxia' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });
    await deleteCadenceConfig(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: '删除失败' }, { status: 500 });
  }
}
