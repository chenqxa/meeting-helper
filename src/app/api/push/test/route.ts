import { NextRequest, NextResponse } from 'next/server';
import { guardPermission } from '@/lib/api-guard';
import { recordPushLog } from '@/storage/database/push-log-storage';

// POST /api/push/test - 企微推送自测（admin）
// body: { name: string, title?: string, content?: string }
// 仅发给指定的一人，用于核验 userid 匹配与实际到达，不会群发。
export async function POST(request: NextRequest) {
  const g = await guardPermission('canManagePushConfig');
  if (!g.ok) return g.response;
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) {
      return NextResponse.json({ success: false, error: '请提供接收人姓名' }, { status: 400 });
    }

    const { sendTextCardMessage, resolveUserIdsByNames } = await import('@/lib/wecom-message');
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();

    const map = await resolveUserIdsByNames([name], false);
    const userId = map.get(name);
    if (!userId) {
      await recordPushLog({ pushType: 'todo', channel: 'wecom', recipient: name, success: false, error: '企微未匹配到用户' });
      return NextResponse.json({ success: false, error: `未匹配到企微用户：${name}`, data: { name, baseUrl } }, { status: 404 });
    }

    const title = String(body.title || '会议助手 · 企微推送自测');
    const content = String(body.content || `这是一条来自会议助手的测试卡片（接收人：${name}）`);
    const link = baseUrl || undefined;

    const r = await sendTextCardMessage([userId], title, content, link as string);
    await recordPushLog({
      pushType: 'todo',
      channel: 'wecom',
      recipient: name,
      success: r.success,
      error: r.success ? null : (r.error || '发送失败'),
    });

    return NextResponse.json({
      success: r.success,
      data: { name, userId, baseUrl: baseUrl || '(未配置)', result: r },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[push/test]', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
