import { NextRequest, NextResponse } from 'next/server';
import { transcribeWithTencentFlash, pcmToWavBuffer } from '@/lib/asr/tencent-flash';

export const maxDuration = 60; // 单段最长 60 秒

// 接收原始 PCM 字节（16kHz 16-bit mono），转 WAV 后调 Flash ASR，返回说话人标注
export async function POST(request: NextRequest) {
  try {
    const pcmBytes = await request.arrayBuffer();

    if (pcmBytes.byteLength < 3200) {
      return NextResponse.json({ success: true, utterances: [] });
    }

    const wavBuffer = pcmToWavBuffer(Buffer.from(pcmBytes), 16000);
    const result = await transcribeWithTencentFlash(wavBuffer, 16000);

    return NextResponse.json({ success: true, utterances: result.utterances });
  } catch (error: any) {
    console.error('[FlashSegment] Error:', error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
