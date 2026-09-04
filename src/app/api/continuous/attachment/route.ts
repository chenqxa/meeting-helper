import { NextRequest, NextResponse } from 'next/server';

import { guardWrite } from '@/lib/api-guard';
import { saveOaAttachment } from '@/lib/oa-attachment';

// POST /api/continuous/attachment - 抓取 OA 附件存本地，返回可预览 URL
// body: { fileid: string }
export async function POST(request: NextRequest) {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;
    const body = await request.json().catch(() => ({}));
    const fileid = String(body.fileid || '').trim();
    if (!fileid) {
      return NextResponse.json({ success: false, error: '缺少 fileid' }, { status: 400 });
    }
    const result = await saveOaAttachment(fileid);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[continuous/attachment]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '附件抓取失败',
    }, { status: 500 });
  }
}
