/**
 * 文件安全验证工具
 * 基于文件魔数（magic bytes）验证文件类型，防止伪造
 */

// 文件魔数映射
const MAGIC_BYTES: Record<string, string[]> = {
  'audio/mpeg': ['fffb', 'fff3', 'fff2', '4944'], // MP3: FFFB/FFF3/FFF2 或 ID3
  'audio/wav': ['52494646'], // WAV: RIFF
  'audio/m4a': ['66747970'], // M4A: ftyp (offset 4)
  'image/jpeg': ['ffd8ff'], // JPEG
  'image/png': ['89504e47'], // PNG
  'image/gif': ['47494638'], // GIF
  'image/webp': ['52494646'], // WEBP: RIFF (需进一步检查WEBP标识)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['504b0304'], // DOCX: PK (ZIP格式)
  'text/plain': [], // 纯文本无固定魔数
};

// 允许的文件扩展名
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
  'audio/m4a': ['m4a'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'text/plain': ['txt'],
};

/**
 * 验证文件魔数
 */
export function validateFileMagic(buffer: Buffer, expectedMimeType: string): boolean {
  const magicBytes = MAGIC_BYTES[expectedMimeType];

  // 纯文本无魔数要求
  if (!magicBytes || magicBytes.length === 0) {
    return true;
  }

  // 读取文件头部字节
  const header = buffer.slice(0, 12).toString('hex').toLowerCase();

  // M4A 需要检查偏移4的位置
  if (expectedMimeType === 'audio/m4a') {
    const ftypOffset = buffer.slice(4, 8).toString('hex').toLowerCase();
    return magicBytes.some(magic => ftypOffset.startsWith(magic));
  }

  // WEBP 需要同时检查 RIFF 和 WEBP 标识
  if (expectedMimeType === 'image/webp') {
    const riff = buffer.slice(0, 4).toString('hex').toLowerCase();
    const webp = buffer.slice(8, 12).toString('ascii');
    return riff === '52494646' && webp === 'WEBP';
  }

  // 其他格式检查头部
  return magicBytes.some(magic => header.startsWith(magic));
}

/**
 * 验证文件扩展名
 */
export function validateFileExtension(filename: string, expectedMimeType: string): boolean {
  const allowedExts = ALLOWED_EXTENSIONS[expectedMimeType];
  if (!allowedExts) return false;

  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return false;

  return allowedExts.includes(ext);
}

/**
 * 安全提取文件扩展名（防止双重扩展名攻击）
 */
export function safeExtractExtension(filename: string, expectedMimeType: string): string | null {
  const allowedExts = ALLOWED_EXTENSIONS[expectedMimeType];
  if (!allowedExts) return null;

  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext || !allowedExts.includes(ext)) return null;

  return ext;
}

/**
 * 生成安全的文件名
 */
export function generateSafeFilename(originalName: string, mimeType: string): string {
  const ext = safeExtractExtension(originalName, mimeType);
  if (!ext) {
    throw new Error('Invalid file extension');
  }

  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}_${random}.${ext}`;
}

/**
 * 综合验证文件安全性
 */
export async function validateFile(
  file: File,
  expectedMimeType: string
): Promise<{ valid: boolean; error?: string; buffer?: Buffer }> {
  // 1. 验证扩展名
  if (!validateFileExtension(file.name, expectedMimeType)) {
    return { valid: false, error: '文件扩展名不合法' };
  }

  // 2. 读取文件内容
  const buffer = Buffer.from(await file.arrayBuffer());

  // 3. 验证文件大小（最小10字节）
  if (buffer.length < 10) {
    return { valid: false, error: '文件内容异常' };
  }

  // 4. 验证魔数
  if (!validateFileMagic(buffer, expectedMimeType)) {
    return { valid: false, error: '文件内容与声明类型不符' };
  }

  return { valid: true, buffer };
}
