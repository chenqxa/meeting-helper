import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getOaPullConfig, updateOaPullConfig, getOaPullRuns, updateOaPullRuntime, recordRunStart, recordRunFinish } from '@/storage/database/oa-pull-config-storage';
import { logOperation } from '@/lib/operation-log';
import { executeOaPullResults } from '@/lib/oa-pull-runner';

// GET /api/settings/oa-pull - 读取完整配置 + 最近执行历史
export async function GET() {
  try {
    const [config, runs] = await Promise.all([getOaPullConfig(), getOaPullRuns(20)]);
    return NextResponse.json({ success: true, data: { config, runs } });
  } catch (error) {
    console.error('[settings/oa-pull GET]', error);
    return NextResponse.json({ success: false, error: '获取配置失败' }, { status: 500 });
  }
}

// PUT /api/settings/oa-pull - 更新配置（白名单字段）+ 审计
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.loginid !== 'chenqiaoxia' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }
    const body = await request.json();
    const before = await getOaPullConfig();
    const config = await updateOaPullConfig({
      enabled: body.enabled !== undefined ? !!body.enabled : undefined,
      cronExpr: body.cronExpr !== undefined ? String(body.cronExpr || '') : undefined,
      intervalMin: body.intervalMin !== undefined ? parseInt(String(body.intervalMin), 10) : undefined,
      incremental: body.incremental !== undefined ? !!body.incremental : undefined,
      maxRetries: body.maxRetries !== undefined ? parseInt(String(body.maxRetries), 10) : undefined,
      retryBaseMin: body.retryBaseMin !== undefined ? parseInt(String(body.retryBaseMin), 10) : undefined,
      alertAfterFails: body.alertAfterFails !== undefined ? parseInt(String(body.alertAfterFails), 10) : undefined,
      alertRecipients: body.alertRecipients !== undefined ? String(body.alertRecipients || '') : undefined,
    });

    // 审计：记录配置变更
    await logOperation({
      action: 'oa_pull_config',
      targetType: 'system',
      targetId: 'oa-pull-config',
      summary: `更新OA回拉配置（cron=${config.cronExpr || '间隔'}/${config.intervalMin}分，增量=${config.incremental ? '开' : '关'}）`,
      detail: { before, after: config, operator: user.loginid },
    });

    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    console.error('[settings/oa-pull PUT]', error);
    return NextResponse.json({ success: false, error: '保存失败' }, { status: 500 });
  }
}

// POST /api/settings/oa-pull - 立即触发一次 OA 回拉
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || (user.loginid !== 'chenqiaoxia' && user.role !== 'admin')) {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }
    // 直接调用回拉核心逻辑（不走内部 HTTP，避免无 cookie 未登录）
    const cfg = await getOaPullConfig();
    const cursorAt = cfg.incremental && cfg.lastCursorAt ? cfg.lastCursorAt : null;

    // 记录运行历史（与定时调度一致）
    const run = await recordRunStart('manual');
    const result = await executeOaPullResults(cursorAt);
    const now = new Date().toISOString();

    if (result.success) {
      const synced = result.synced + result.contSynced;
      await recordRunFinish(run.id, { status: 'success', synced, detail: result.message });
      await updateOaPullRuntime({
        lastRunAt: now,
        lastRunStatus: 'success',
        lastRunDetail: result.message,
        consecutiveFails: 0,
        lastCursorAt: now,
      });
    } else {
      await recordRunFinish(run.id, { status: 'failed', error: result.error || '未知错误' });
      await updateOaPullRuntime({
        lastRunAt: now,
        lastRunStatus: 'failed',
        lastRunDetail: result.error,
        consecutiveFails: cfg.consecutiveFails + 1,
      });
    }

    await logOperation({
      action: 'oa_sync',
      targetType: 'system',
      targetId: 'oa-pull-manual',
      summary: `手动触发OA回拉：${result.success ? '成功' : '失败'}`,
      detail: { result, operator: user.loginid },
    });

    return NextResponse.json({ success: result.success, data: { message: result.message }, error: result.error });
  } catch (error) {
    console.error('[settings/oa-pull POST]', error);
    return NextResponse.json({ success: false, error: '触发失败' }, { status: 500 });
  }
}
