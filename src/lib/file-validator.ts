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

// ─────────────────────────────────────────────────────────────
// 通用文件支持（2026-09）：汇报附件放开为任意类型
// 策略：不做扩展名白名单拦截；用魔数探测决定 Content-Type；
//       对可内联执行的危险类型强制下载（见 files 路由）。
// ─────────────────────────────────────────────────────────────

export const EXT_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain; charset=utf-8', md: 'text/markdown', log: 'text/plain',
  json: 'application/json', xml: 'application/xml',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/m4a', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  html: 'text/html', htm: 'text/html', js: 'application/javascript', mjs: 'application/javascript',
  exe: 'application/x-msdownload', bat: 'application/x-msdownload', cmd: 'application/x-msdownload',
  sh: 'application/x-sh', ps1: 'application/x-powershell', vbs: 'application/x-vbs', jar: 'application/java-archive',
};

const DANGEROUS_EXTS = new Set([
  'html', 'htm', 'svg', 'js', 'mjs', 'jsx', 'tsx', 'exe', 'bat', 'cmd', 'com', 'scr',
  'sh', 'ps1', 'vbs', 'wsf', 'jar', 'php', 'jsp', 'asp', 'aspx', 'cgi', 'hta',
]);

/** 清洗出安全扩展名（仅字母数字，最长 10） */
export function sanitizeExt(filename: string): string {
  const raw = (filename.split('.').pop() || '').toLowerCase();
  return raw.replace(/[^a-z0-9]/g, '').slice(0, 10);
}

export function isDangerousExtension(ext: string): boolean {
  return DANGEROUS_EXTS.has(String(ext || '').toLowerCase());
}

/** 危险类型（可被浏览器内联执行/渲染）→ 强制下载 */
export function isDangerousMime(mime: string, ext: string): boolean {
  const m = String(mime || '').toLowerCase();
  if (isDangerousExtension(ext)) return true;
  return m.includes('html') || m.includes('javascript') || m.includes('x-msdownload')
    || m.includes('x-sh') || m.includes('x-vbs') || m.includes('java-archive') || m.includes('svg');
}

/** 依据魔数探测 MIME，失败回退扩展名映射/客户端声明 */
export function detectMimeFromBuffer(buffer: Buffer, ext: string, fallback = 'application/octet-stream'): string {
  const head = buffer.slice(0, 12).toString('hex').toLowerCase();
  if (head.startsWith('25504446')) return 'application/pdf';
  if (head.startsWith('ffd8ff')) return 'image/jpeg';
  if (head.startsWith('89504e47')) return 'image/png';
  if (head.startsWith('47494638')) return 'image/gif';
  if (head.startsWith('52494646')) {
    if (buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'avi') return 'video/x-msvideo';
    return EXT_MIME_MAP[ext] || fallback;
  }
  if (head.startsWith('d0cf11e0')) return EXT_MIME_MAP[ext] || 'application/vnd.ms-office';
  if (head.startsWith('504b0304')) return EXT_MIME_MAP[ext] || 'application/zip'; // docx/xlsx/pptx/zip
  if (head.startsWith('1a45dfa3')) return 'video/x-matroska';
  // 纯文本兜底
  if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(buffer.slice(0, 64).toString('latin1'))) {
    return EXT_MIME_MAP[ext] || 'text/plain; charset=utf-8';
  }
  return EXT_MIME_MAP[ext] || fallback;
}

/** 为任意扩展名生成安全文件名 */
export function generateSafeFilenameAny(originalName: string): string {
  const ext = sanitizeExt(originalName);
  if (!ext) throw new Error('文件缺少有效扩展名');
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}_${random}.${ext}`;
}
