import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { readFileFromDb } from '@/storage/database/file-storage';
import { EXT_MIME_MAP, isDangerousMime } from '@/lib/file-validator';

function buildHeaders(mime: string, ext: string, size: number, id: string): Record<string, string> {
  const dangerous = isDangerousMime(mime, ext);
  const headers: Record<string, string> = {
    'Content-Type': mime || 'application/octet-stream',
    'Content-Length': String(size),
    'X-Content-Type-Options': 'nosniff',
  };
  if (dangerous) {
    // 危险类型（html/svg/js/exe 等）强制下载，避免内联执行导致 XSS
    headers['Content-Disposition'] = `attachment; filename="${id.replace(/"/g, '')}"`;
    headers['Cache-Control'] = 'private, no-store';
  } else {
    headers['Cache-Control'] = 'public, max-age=86400';
  }
  return headers;
}

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

    const ext = path.extname(id).replace('.', '').toLowerCase();

    // 1) 优先读数据库（主存储：部署重建容器/换机器都不丢）
    try {
      const dbFile = await readFileFromDb(id);
      if (dbFile) {
        const mime = dbFile.mime || EXT_MIME_MAP[ext] || 'application/octet-stream';
        return new NextResponse(new Uint8Array(dbFile.buffer), {
          status: 200,
          headers: buildHeaders(mime, ext, dbFile.buffer.length, id),
        });
      }
    } catch (e) {
      console.warn('[files] 读库失败，回退磁盘:', e instanceof Error ? e.message : e);
    }

    // 2) 回退磁盘（兼容历史落盘文件；容器重建后旧文件可能已不存在）
    try {
      const stat = await fs.stat(filePath);
      const buffer = await fs.readFile(filePath);
      const mime = EXT_MIME_MAP[ext] || 'application/octet-stream';
      return new NextResponse(buffer, {
        status: 200,
        headers: buildHeaders(mime, ext, stat.size, id),
      });
    } catch {
      // 磁盘也没有 → 404
    }
  } catch {
    return NextResponse.json({ success: false, error: '文件不存在' }, { status: 404 });
  }
}
