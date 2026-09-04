import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { readFileFromDb } from '@/storage/database/file-storage';

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

    // 1) 优先读数据库（主存储：部署重建容器/换机器都不丢）
    try {
      const dbFile = await readFileFromDb(id);
      if (dbFile) {
        return new NextResponse(new Uint8Array(dbFile.buffer), {
          status: 200,
          headers: {
            'Content-Type': dbFile.mime || mimeMap[ext] || 'application/octet-stream',
            'Content-Length': String(dbFile.buffer.length),
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    } catch (e) {
      console.warn('[files] 读库失败，回退磁盘:', e instanceof Error ? e.message : e);
    }

    // 2) 回退磁盘（兼容历史落盘文件；容器重建后旧文件可能已不存在）
    try {
      const stat = await fs.stat(filePath);
      const buffer = await fs.readFile(filePath);
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': mimeMap[ext] || 'application/octet-stream',
          'Content-Length': String(stat.size),
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch {
      // 磁盘也没有 → 404
    }
  } catch {
    return NextResponse.json({ success: false, error: '文件不存在' }, { status: 404 });
  }
}
