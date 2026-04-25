import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const fileType = formData.get('type') as string; // 'recording' or 'upload'

    if (!file) {
      return NextResponse.json(
        { success: false, error: '请选择文件' },
        { status: 400 }
      );
    }

    // 验证文件类型
    if (fileType === 'recording') {
      if (
!['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp3', 'audio/m4a'].includes(file.type)
 &&
!file.name.match(/\.(mp3|wav|m4a)$/i)
) {
        return NextResponse.json(
          { success: false, error: '只支持 .mp3, .wav 格式的音频文件' },
          { status: 400 }
        );
      }
    } else if (fileType === 'upload') {
      if (
!['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].includes(file.type)
 &&
!file.name.match(/\.(docx|txt)$/i)
) {
        return NextResponse.json(
          { success: false, error: '只支持 .docx, .txt 格式的文件' },
          { status: 400 }
        );
      }
    }

    // 验证文件大小（50MB限制）
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: '文件大小不能超过50MB' },
        { status: 400 }
      );
    }

    // 生成唯一文件名
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    const extension = file.name.split('.').pop();
    const uniqueFilename = `${timestamp}_${random}.${extension}`;

    // 将文件保存到/tmp目录（生产环境）或public目录（开发环境）
    const buffer = Buffer.from(await file.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs').promises;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');

    const isDev = process.env.COZE_PROJECT_ENV === 'DEV';
    const uploadDir = isDev ? '/workspace/projects/public/uploads' : '/tmp';
    const filePath = path.join(uploadDir, uniqueFilename);

    // 确保目录存在
    try {
      await fs.mkdir(uploadDir, { recursive: true });
    } catch (error) {
      console.error('创建目录失败:', error);
    }

    // 保存文件
    await fs.writeFile(filePath, buffer);

    // 生成访问URL
    const fileUrl = isDev
      ? `/uploads/${uniqueFilename}`
      : `/tmp/${uniqueFilename}`;

    return NextResponse.json({
      success: true,
      data: {
        filename: file.name,
        url: fileUrl,
        size: file.size,
        type: file.type,
      },
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
