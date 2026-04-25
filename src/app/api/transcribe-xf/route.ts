import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { transcribeWithXf } from '@/lib/xf-asr';

const execAsync = promisify(exec);

// 从环境变量读取讯飞配置
const XF_APP_ID = process.env.XF_APP_ID;
const XF_API_KEY = process.env.XF_API_KEY;
const XF_API_SECRET = process.env.XF_API_SECRET;

// 将音频转换为 PCM 16k 16bit 单声道（讯飞要求的格式）
async function convertToPcm(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    // 使用 ffmpeg 转换为 s16le 格式
    await execAsync(`ffmpeg -i "${inputPath}" -f s16le -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}" -y`);
    return true;
  } catch (e) {
    console.error('[TranscribeXF] FFmpeg conversion failed:', e);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // 检查配置
    if (!XF_APP_ID || !XF_API_KEY || !XF_API_SECRET) {
      return NextResponse.json(
        { 
          success: false, 
          error: '服务器未配置讯飞 API 密钥。请在 .env 文件设置 XF_APP_ID, XF_API_KEY, XF_API_SECRET' 
        },
        { status: 500 }
      );
    }

    // 解析上传的文件
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: '没有收到音频文件' },
        { status: 400 }
      );
    }

    console.log('[TranscribeXF] Received audio:', audioFile.size, 'bytes, type:', audioFile.type);

    // 检查文件大小（限制 10MB）
    const maxSize = 10 * 1024 * 1024;
    if (audioFile.size > maxSize) {
      return NextResponse.json(
        { success: false, error: '文件过大，请控制在 10MB 以内（约5分钟）' },
        { status: 400 }
      );
    }

    // 保存临时文件
    const bytes = await audioFile.arrayBuffer();
    const timestamp = Date.now();
    const inputPath = join(tmpdir(), `audio-xf-${timestamp}.webm`);
    const pcmPath = join(tmpdir(), `audio-xf-${timestamp}.pcm`);
    
    await writeFile(inputPath, Buffer.from(bytes));
    console.log('[TranscribeXF] Saved to:', inputPath);

    // 转换为 PCM 格式（讯飞要求）
    const converted = await convertToPcm(inputPath, pcmPath);
    if (!converted) {
      await unlink(inputPath).catch(() => {});
      return NextResponse.json(
        { success: false, error: '音频格式转换失败，请检查是否安装了 ffmpeg' },
        { status: 500 }
      );
    }

    console.log('[TranscribeXF] Converted to PCM');

    try {
      // 读取 PCM 数据
      const { readFile } = await import('fs/promises');
      const pcmBuffer = await readFile(pcmPath);
      
      // 调用讯飞 ASR
      const result = await transcribeWithXf(
        {
          appId: XF_APP_ID,
          apiKey: XF_API_KEY,
          apiSecret: XF_API_SECRET,
        },
        pcmBuffer,
        16000
      );

      console.log('[TranscribeXF] Result:', result);

      if (!result.text || result.text.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: '未能识别出文字，请检查录音质量或离麦克风更近一些' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        text: result.labeledText || result.text, // 优先返回带说话人标注的文本
        rawText: result.text,
        speakers: result.speakers,
        hasSpeakers: result.hasSpeakers,
      });

    } finally {
      // 清理临时文件
      await unlink(inputPath).catch(() => {});
      await unlink(pcmPath).catch(() => {});
    }

  } catch (error: any) {
    console.error('[TranscribeXF] Error:', error);
    return NextResponse.json(
      { success: false, error: '转写失败: ' + (error.message || '未知错误') },
      { status: 500 }
    );
  }
}
