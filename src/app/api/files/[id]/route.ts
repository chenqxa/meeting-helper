import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), '.uploads');
    const filePath = path.join(uploadDir, id);

    // 安全检查：防止路径穿越
    if (!filePath.startsWith(uploadDir)) {
      return NextResponse.json({ success: false, error: '非法路径' }, { status: 403 });
    }

    const stat = await fs.stat(filePath);
    const buffer = await fs.readFile(filePath);

    const ext = path.extname(id).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.gif': 'image/gif',
      '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain; charset=utf-8', '.rtf': 'application/rtf',
    };

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mimeMap[ext] || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: '文件不存在' }, { status: 404 });
  }
}
