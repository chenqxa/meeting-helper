import { NextRequest, NextResponse } from 'next/server';
import { createShareToken, getShareTokensByMeeting, deleteShareToken } from '@/storage/database/share-token-storage';
import { getCurrentUser } from '@/lib/session';
import { getMeetingById } from '@/storage';

/**
 * 生成会议分享链接
 * POST /api/meetings/[id]/share
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    // 检查会议是否存在
    const meeting = await getMeetingById(meetingId);
    if (!meeting) {
      return NextResponse.json({ success: false, error: '会议不存在' }, { status: 404 });
    }

    const body = await request.json();
    const { expiresInHours = 72, maxAccess = null } = body;

    // 生成分享令牌
    const shareToken = await createShareToken(meetingId, user.name, expiresInHours, maxAccess);

    // 生成完整的分享链接
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || '';
    const shareUrl = `${baseUrl}/meeting/share/${shareToken.token}`;

    return NextResponse.json({
      success: true,
      data: {
        ...shareToken,
        shareUrl,
      },
    });
  } catch (error) {
    console.error('[share] 生成分享链接失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '生成分享链接失败' },
      { status: 500 }
    );
  }
}

/**
 * 获取会议的所有分享链接
 * GET /api/meetings/[id]/share
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const tokens = await getShareTokensByMeeting(meetingId);

    // 添加完整URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || '';
    const tokensWithUrl = tokens.map(token => ({
      ...token,
      shareUrl: `${baseUrl}/meeting/share/${token.token}`,
      isExpired: new Date(token.expiresAt) < new Date(),
      isMaxedOut: token.maxAccess ? token.accessCount >= token.maxAccess : false,
    }));

    return NextResponse.json({ success: true, data: tokensWithUrl });
  } catch (error) {
    console.error('[share] 获取分享链接失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取分享链接失败' },
      { status: 500 }
    );
  }
}

/**
 * 删除分享链接
 * DELETE /api/meetings/[id]/share?tokenId=xxx
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const tokenId = searchParams.get('tokenId');

    if (!tokenId) {
      return NextResponse.json({ success: false, error: '缺少tokenId参数' }, { status: 400 });
    }

    const deleted = await deleteShareToken(tokenId);

    if (!deleted) {
      return NextResponse.json({ success: false, error: '分享链接不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[share] 删除分享链接失败:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '删除分享链接失败' },
      { status: 500 }
    );
  }
}
