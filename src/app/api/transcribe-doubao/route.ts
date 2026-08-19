import { NextRequest, NextResponse } from 'next/server';
import { transcribeWithDoubao } from '@/lib/asr/doubao-sign';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json({ success: false, error: '没有收到音频文件' }, { status: 400 });
    }

    const bytes = await audioFile.arrayBuffer();
    const format = formData.get('format') as string || '';
    const sampleRate = parseInt(formData.get('sampleRate') as string || '16000', 10);

    // 前端已转好 PCM，直接使用
    if (format === 'pcm' || audioFile.type === 'audio/pcm') {
      const pcmBuffer = Buffer.from(bytes);

      if (pcmBuffer.length < 640) {
        return NextResponse.json({ success: true, text: '' });
      }

      const result = await transcribeWithDoubao(pcmBuffer, sampleRate);
      console.log('[Doubao] 识别结果:', JSON.stringify(result));

      return NextResponse.json({
        success: true,
        text: result.text,
        utterances: result.utterances,
      });
    }

    return NextResponse.json(
      { success: false, error: '仅支持 PCM 格式，请在前端转换' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('[TranscribeDoubao] Error:', error);
    return NextResponse.json(
      { success: false, error: '豆包转写失败: ' + (error.message || '未知错误') },
      { status: 500 }
    );
  }
}
