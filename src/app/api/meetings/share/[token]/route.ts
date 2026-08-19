import { NextRequest, NextResponse } from 'next/server';
import { validateShareToken } from '@/storage/database/share-token-storage';
import { getTraceFromRequest } from '@/lib/trace';

/**
 * 通过分享链接访问会议
 * GET /api/meetings/share/[token]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const traceId = getTraceFromRequest(request, 'share');
  const log = (step: string, extra: Record<string, unknown> = {}) => {
    console.log('[share-trace]', JSON.stringify({ traceId, step, ...extra }));
  };
  try {
    const { token } = await params;

    // 验证token
    const validation = await validateShareToken(token);
    log('share.validate', { tokenPrefix: token.slice(0, 8), valid: validation.valid, meetingId: validation.meetingId, error: validation.error });

    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error || '无效的分享链接' },
        { status: 403 }
      );
    }

    const redirectUrl = `/meeting/${validation.meetingId}?shared=true&_t=${encodeURIComponent(traceId)}`;
    log('share.redirect', { meetingId: validation.meetingId, redirectUrl });

    return NextResponse.json({
      success: true,
      data: {
        meetingId: validation.meetingId,
        redirectUrl,
      },
    });
  } catch (error) {
    console.error('[share] 访问分享链接失败:', error);
    log('share.exception', { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '访问失败' },
      { status: 500 }
    );
  }
}
