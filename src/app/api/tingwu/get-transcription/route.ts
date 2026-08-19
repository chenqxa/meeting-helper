import { NextRequest, NextResponse } from 'next/server';

// 后端代理：从阿里云 OSS 临时 URL 获取转写结果 JSON
// 避免前端直接 fetch OSS URL 的跨域（CORS）问题
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json({ success: false, error: '缺少 url 参数' }, { status: 400 });
    }

    // 仅允许阿里云 OSS 域名，防止 SSRF
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('.aliyuncs.com') && !parsed.hostname.endsWith('.aliyun.com')) {
      return NextResponse.json({ success: false, error: '非法域名' }, { status: 403 });
    }

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `OSS 请求失败: ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[Tingwu] get-transcription proxy error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
