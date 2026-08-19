import { NextRequest, NextResponse } from 'next/server';
import { transcribeWithLFASR, pcmToWavBuffer } from '@/lib/asr/iflytek-lfasr';

export const maxDuration = 600; // 允许最长 10 分钟（支持超长录音轮询）

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const format     = (formData.get('format') as string) || 'pcm';
    const sampleRate = parseInt(formData.get('sampleRate') as string || '16000', 10);
    const duration   = parseFloat(formData.get('duration') as string || '0');
    const speakerNum = parseInt(formData.get('speakerNum') as string || '0', 10);

    if (!audioFile) {
      return NextResponse.json({ success: false, error: '未收到音频文件' }, { status: 400 });
    }

    const bytes = await audioFile.arrayBuffer();
    let wavBuffer: Buffer;

    if (format === 'pcm') {
      wavBuffer = pcmToWavBuffer(Buffer.from(bytes), sampleRate);
    } else if (format === 'wav') {
      wavBuffer = Buffer.from(bytes);
    } else {
      return NextResponse.json(
        { success: false, error: '仅支持 pcm/wav 格式' },
        { status: 400 }
      );
    }

    if (wavBuffer.length < 1000) {
      return NextResponse.json({ success: true, labeledText: '', utterances: [] });
    }

    const result = await transcribeWithLFASR(wavBuffer, duration, speakerNum);
    console.log('[LFASR] 完成，说话人数:', result.utterances.map(u => u.speaker).filter((v, i, a) => a.indexOf(v) === i).length);

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[LFASR] Error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message || 'LFASR 识别失败' },
      { status: 500 }
    );
  }
}
