import { NextRequest, NextResponse } from 'next/server';
import { transcribeWithTencentRecTask } from '@/lib/asr/tencent-rec-task';
import { pcmToWavBuffer } from '@/lib/asr/tencent-flash';

export const maxDuration = 600; // 允许最长 10 分钟（COS 上传 + 轮询等待）

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const format     = (formData.get('format') as string) || 'pcm';
    const sampleRate = parseInt(formData.get('sampleRate') as string || '16000', 10);

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

    const result = await transcribeWithTencentRecTask(wavBuffer, sampleRate);
    console.log('[TencentRecTask] 完成，说话人数:', result.utterances.map(u => u.speaker_id).filter((v, i, a) => a.indexOf(v) === i).length);

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[TencentRecTask] Error:', error.message, '| cause:', error.cause?.message ?? error.cause);
    return NextResponse.json(
      { success: false, error: `${error.message}${error.cause ? ' | ' + (error.cause.message ?? error.cause) : ''}` },
      { status: 500 }
    );
  }
}
