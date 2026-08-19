import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { pushContinuousByType } from '@/lib/continuous-push';
import { getCadenceConfigs, updateCadenceConfig } from '@/storage/database/cadence-storage';

// POST /api/continuous/push - 手动触发持续项推送 OA
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.loginid !== 'chenqiaoxia' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }
    const body = await request.json();
    const meetingType = body.meeting_type || body.meetingType;
    if (!meetingType) return NextResponse.json({ success: false, error: '缺少 meeting_type' }, { status: 400 });

    const itemIds: string[] | undefined = Array.isArray(body.item_ids)
      ? body.item_ids.map(String)
      : Array.isArray(body.itemIds)
        ? body.itemIds.map(String)
        : undefined;

    const result = await pushContinuousByType(meetingType, new Date(), itemIds, 'manual');

    // 手动推送也更新"上次推送时间"，保持与自动推送一致
    const configs = await getCadenceConfigs();
    const cfg = configs.find(c => c.meetingType === meetingType);
    if (cfg) {
      await updateCadenceConfig(cfg.id, { lastPushedAt: new Date().toISOString() });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[continuous/push]', error);
    return NextResponse.json({ success: false, error: '推送失败' }, { status: 500 });
  }
}
