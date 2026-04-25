import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY;
const SILICONFLOW_BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn';

// 将音频转换为 MP3 格式（如果 ffmpeg 可用）
async function convertToMp3(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    await execAsync(`ffmpeg -i "${inputPath}" -vn -ar 16000 -ac 1 -b:a 32k "${outputPath}" -y`);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // 检查配置
    if (!SILICONFLOW_API_KEY) {
      return NextResponse.json(
        { success: false, error: '服务器未配置 API Key' },
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

    console.log('[Transcribe] Received audio:', audioFile.size, 'bytes, type:', audioFile.type);

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
    const inputPath = join(tmpdir(), `audio-${timestamp}.webm`);
    const mp3Path = join(tmpdir(), `audio-${timestamp}.mp3`);
    
    await writeFile(inputPath, Buffer.from(bytes));
    console.log('[Transcribe] Saved to:', inputPath);

    // 尝试转换为 MP3（如果 ffmpeg 可用）
    let uploadPath = inputPath;
    let uploadMimeType = audioFile.type || 'audio/webm';
    
    const converted = await convertToMp3(inputPath, mp3Path);
    if (converted) {
      uploadPath = mp3Path;
      uploadMimeType = 'audio/mpeg';
      console.log('[Transcribe] Converted to MP3');
    }

    try {
      // 读取文件用于上传
      const fileBuffer = await readFile(uploadPath);
      
      // 使用正确的 Silicon Flow ASR API 端点
      const apiFormData = new FormData();
      apiFormData.append('file', new Blob([fileBuffer], { type: uploadMimeType }), 'audio.mp3');
      apiFormData.append('model', 'FunAudioLLM/SenseVoiceSmall');
      
      console.log('[Transcribe] Calling API:', `${SILICONFLOW_BASE_URL}/v1/audio/transcriptions`);
      
      const response = await fetch(`${SILICONFLOW_BASE_URL}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
        },
        body: apiFormData,
      });

      const responseText = await response.text();
      console.log('[Transcribe] API response:', response.status, responseText.substring(0, 500));

      if (!response.ok) {
        // 如果 Whisper API 失败，回退到使用文本模型的兜底方案
        // 注意：这里我们只是返回一个友好的错误
        let errorMsg = `ASR 服务错误 (${response.status})`;
        try {
          const errorJson = JSON.parse(responseText);
          errorMsg = errorJson.message || errorJson.error || errorMsg;
        } catch {}
        
        return NextResponse.json(
          { success: false, error: errorMsg + '。请尝试直接粘贴文本。' },
          { status: 500 }
        );
      }

      const result = JSON.parse(responseText);

      // 返回结果
      const text = result.text || '';
      
      if (!text) {
        return NextResponse.json(
          { success: false, error: '未能识别出文字，请检查录音质量或离麦克风更近一些' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        text: text,
      });

    } finally {
      // 清理临时文件
      await unlink(inputPath).catch(() => {});
      await unlink(mp3Path).catch(() => {});
    }

  } catch (error: any) {
    console.error('[Transcribe] Error:', error);
    return NextResponse.json(
      { success: false, error: '转写失败: ' + (error.message || '未知错误') },
      { status: 500 }
    );
  }
}
