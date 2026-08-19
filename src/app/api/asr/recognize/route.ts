import { NextRequest, NextResponse } from 'next/server';
import { getBaiduAccessToken } from '@/lib/asr/baidu-token';

// 允许较大请求体（音频 base64）
export const runtime = 'nodejs';

// POST /api/asr/recognize
// 接收 PCM 音频 base64，调用百度短语音识别 REST API 返回文本
export async function POST(request: NextRequest) {
  try {
    const rawText = await request.text();
    console.log('[ASR REST] 收到请求, body长度:', rawText.length);
    if (!rawText || rawText.length < 10) {
      return NextResponse.json({ success: false, error: '请求体为空' }, { status: 400 });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ success: false, error: 'JSON解析失败' }, { status: 400 });
    }

    const { audio, format, rate, provider } = parsed;
    if (!audio) {
      return NextResponse.json({ success: false, error: '缺少 audio 参数' }, { status: 400 });
    }
    console.log('[ASR REST] audio长度:', audio.length, 'provider:', provider);

    if (provider === 'iflytek') {
      // TODO: 讯飞 REST 接口
      return NextResponse.json({ success: false, error: '讯飞 REST 模式暂未实现' }, { status: 501 });
    }

    // 百度短语音识别 REST API
    const token = await getBaiduAccessToken();
    const appid = process.env.BAIDU_ASR_APP_ID;

    const body = {
      format: format || 'pcm',
      rate: rate || 16000,
      channel: 1,
      cuid: `hyzs_server_${Date.now()}`,
      token,
      // dev_pid: 1537=普通话, 1536=普通话(不加标点), 1737=英语, 1637=粤语
      dev_pid: 1537,
      speech: audio,  // base64 编码的音频
      len: Buffer.from(audio, 'base64').length,
    };

    const res = await fetch('https://vop.baidu.com/server_api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    console.log('[ASR REST] baidu response:', JSON.stringify(data).slice(0, 200));

    if (data.err_no === 0 && data.result?.length > 0) {
      return NextResponse.json({
        success: true,
        data: { text: data.result.join(''), isFinal: true },
      });
    }

    if (data.err_no === 3301) {
      // 音频质量差/静音
      return NextResponse.json({ success: true, data: { text: '', isFinal: true } });
    }

    return NextResponse.json({
      success: false,
      error: `百度ASR错误(${data.err_no}): ${data.err_msg || '未知'}`,
    });
  } catch (error) {
    console.error('[asr/recognize]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'ASR识别失败' },
      { status: 500 }
    );
  }
}
