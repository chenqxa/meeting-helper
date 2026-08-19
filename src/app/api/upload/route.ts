import { NextRequest, NextResponse } from 'next/server';
import { validateFile, generateSafeFilename } from '@/lib/file-validator';
import { promises as fs } from 'fs';
import path from 'path';

// 文件类型映射
const FILE_TYPE_MIME_MAP: Record<string, string> = {
  'recording': 'audio/mpeg', // 录音文件主要支持MP3
  'upload': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image': 'image/jpeg',
};

// 支持的MIME类型（可扩展）
const SUPPORTED_MIME_TYPES: Record<string, string[]> = {
  'recording': ['audio/mpeg', 'audio/wav', 'audio/m4a'],
  'upload': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
  'image': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const fileType = formData.get('type') as string; // 'recording' or 'upload' or 'image'

    if (!file) {
      return NextResponse.json(
        { success: false, error: '请选择文件' },
        { status: 400 }
      );
    }

    // 验证文件类型参数
    if (!fileType || !SUPPORTED_MIME_TYPES[fileType]) {
      return NextResponse.json(
        { success: false, error: '不支持的文件类型' },
        { status: 400 }
      );
    }

    // 验证文件大小（50MB限制）
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: '文件大小不能超过50MB' },
        { status: 413 } // Payload Too Large
      );
    }

    // 最小文件大小（防止空文件）
    if (file.size < 10) {
      return NextResponse.json(
        { success: false, error: '文件内容为空' },
        { status: 400 }
      );
    }

    // 确定期望的MIME类型
    const supportedMimes = SUPPORTED_MIME_TYPES[fileType];
    let expectedMimeType = file.type;

    // 如果客户端MIME类型不在支持列表中，使用默认类型
    if (!supportedMimes.includes(file.type)) {
      expectedMimeType = FILE_TYPE_MIME_MAP[fileType] || supportedMimes[0];
    }

    // 验证文件安全性（扩展名 + 魔数）
    const validation = await validateFile(file, expectedMimeType);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error || '文件验证失败' },
        { status: 400 }
      );
    }

    // 生成安全的文件名
    const safeFilename = generateSafeFilename(file.name, expectedMimeType);

    // 确定上传目录（非public目录，避免直接访问）
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), '.uploads');
    const filePath = path.join(uploadDir, safeFilename);

    // 确保目录存在
    await fs.mkdir(uploadDir, { recursive: true });

    // 保存文件
    await fs.writeFile(filePath, validation.buffer!);

    // 返回文件ID，前端通过API访问
    return NextResponse.json({
      success: true,
      url: `/api/files/${safeFilename}`,
      fileId: safeFilename,
      filename: file.name,
      size: file.size,
      type: expectedMimeType,
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '服务器内部错误',
      },
      { status: 500 }
    );
  }
}
