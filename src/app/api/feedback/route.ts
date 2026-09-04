import { NextRequest, NextResponse } from 'next/server';

import { guardWrite } from '@/lib/api-guard';
import { createFeedback, getFeedbacks, resolveFeedback, reopenFeedback, deleteFeedback } from '@/storage/database/feedback-storage';
import { getCurrentUser } from '@/lib/session';

export async function GET() {
  try {
    const [items, user] = await Promise.all([getFeedbacks(), getCurrentUser()]);

    // 权限过滤：admin/manager 看全部（处置需要）；其他人仅看自己提交的
    let visible = items;
    if (user) {
      const { resolveRole } = await import('@/lib/roles');
      const role = await resolveRole(user.loginid);
      if (role !== 'admin' && role !== 'manager') {
        visible = items.filter(it =>
          it.createdBy === user.name || it.createdByLoginId === user.loginid
        );
      }
    } else {
      visible = [];
    }
    return NextResponse.json({ success: true, data: visible });
  } catch (error) {
    console.error('获取反馈列表失败:', error);
    return NextResponse.json({ success: false, error: '获取反馈列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, content, category, images } = body;

    if (!title) {
      return NextResponse.json({ success: false, error: '标题不能为空' }, { status: 400 });
    }

    const user = await getCurrentUser();
    const cleanImages = Array.isArray(images)
      ? images
          .filter((img: any) => img && typeof img.url === 'string' && img.url.trim())
          .map((img: any) => ({ url: img.url.trim(), name: typeof img.name === 'string' ? img.name : undefined }))
      : undefined;

    const item = await createFeedback({
      title,
      content,
      images: cleanImages && cleanImages.length > 0 ? cleanImages : undefined,
      category: category || 'other',
      createdBy: user?.name || '匿名用户',
      createdByLoginId: user?.loginid,
    });

    return NextResponse.json({ success: true, data: item });
  } catch (error) {
    console.error('创建反馈失败:', error);
    return NextResponse.json({ success: false, error: '创建反馈失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;
    const body = await request.json();
    const { id, action, resolveNote } = body;

    if (!id || !action) {
      return NextResponse.json({ success: false, error: '缺少参数' }, { status: 400 });
    }

    const user = await getCurrentUser();

    if (action === 'resolve') {
      const item = await resolveFeedback(id, {
        resolvedBy: user?.name || '管理员',
        resolveNote,
      });
      if (!item) return NextResponse.json({ success: false, error: '反馈不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: item });
    }

    if (action === 'reopen') {
      const item = await reopenFeedback(id);
      if (!item) return NextResponse.json({ success: false, error: '反馈不存在' }, { status: 404 });
      return NextResponse.json({ success: true, data: item });
    }

    return NextResponse.json({ success: false, error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('更新反馈失败:', error);
    return NextResponse.json({ success: false, error: '更新反馈失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 id 参数' }, { status: 400 });
    }

    const deleted = await deleteFeedback(id);
    if (!deleted) return NextResponse.json({ success: false, error: '反馈不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除反馈失败:', error);
    return NextResponse.json({ success: false, error: '删除反馈失败' }, { status: 500 });
  }
}
