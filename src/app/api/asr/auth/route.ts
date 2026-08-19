import { NextRequest, NextResponse } from 'next/server';
import { getBaiduAccessToken, getBaiduASRConfig } from '@/lib/asr/baidu-token';
import { getIflytekASRConfig } from '@/lib/asr/iflytek-sign';

// GET /api/asr/auth?provider=baidu|iflytek
// 返回前端直连 ASR WebSocket 所需的签名/token 配置
export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get('provider') || 'baidu';

  try {
    if (provider === 'baidu') {
      const token = await getBaiduAccessToken();
      const config = getBaiduASRConfig(token);
      return NextResponse.json({ success: true, data: config });
    }

    if (provider === 'iflytek') {
      const config = getIflytekASRConfig();
      return NextResponse.json({ success: true, data: config });
    }

    if (provider === 'doubao') {
      // 豆包用 HTTP 短批次模式，不需要 WebSocket 鉴权
      return NextResponse.json({
        success: true,
        data: {
          provider: 'doubao',
          wsUrl: '',
          sampleRate: 16000,
          frameSize: 1280,
          frameInterval: 40,
          mode: 'http-batch',
          batchInterval: 3000,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: `不支持的 ASR 提供商: ${provider}` },
      { status: 400 }
    );
  } catch (error) {
    console.error('[asr/auth]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'ASR 鉴权失败' },
      { status: 500 }
    );
  }
}
