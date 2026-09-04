// OA 附件下载：通过 SSO token 建立 session，下载附件并缓存到本地
import { promises as fs } from 'fs';
import path from 'path';

const OA_URL = () => process.env.WEAVER_OA_URL || '';
const APPID = () => process.env.WEAVER_OA_APPID || '';
const SECRET = () => process.env.WEAVER_OA_SECRET || '';

// docid → imagefileid 映射缓存（避免频繁查库）
const docToImageCache = new Map<string, string>();

// 解析 docid 为真正的 imagefileid（wcqkfj 存的是 docid，需经 docimagefile 表映射）
async function resolveImageFileId(docId: string): Promise<string> {
  if (docToImageCache.has(docId)) return docToImageCache.get(docId)!;
  try {
    const { getAppPool } = await import('./oa-task-push');
    const pool = await getAppPool();
    const linked = process.env.OA_LINKED_SERVER || 'FWsv';
    const oaDb = process.env.OA_DATABASE_NAME || 'ecology';
    const res = await pool.request()
      .input('docid', require('mssql').BigInt, docId)
      .query(`
        SELECT TOP 1 imagefileid FROM [${linked}].[${oaDb}].[dbo].[docimagefile]
        WHERE docid = @docid ORDER BY id DESC
      `);
    if (res.recordset.length > 0) {
      const imageFileId = String(res.recordset[0].imagefileid);
      docToImageCache.set(docId, imageFileId);
      return imageFileId;
    }
  } catch (e) {
    console.warn('[oa-attachment] docimagefile 查询失败，回退原值:', e instanceof Error ? e.message : e);
  }
  return docId;
}

// getToken 有严格限流（约30-60秒一次），做全局缓存 + 间隔控制
let cachedToken: string | null = null;
let lastTokenAt = 0;
let tokenFetching: Promise<string> | null = null;

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function fetchToken(): Promise<string> {
  const url = `${OA_URL()}/ssologin/getToken`;
  const body = `appid=${encodeURIComponent(APPID())}&secret=${encodeURIComponent(SECRET())}&loginid=chenqiaoxia`;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!text.startsWith('Token')) return text.trim();
    // 限流：等 40s 重试
    await sleep(40000);
  }
  throw new Error('OA getToken 多次失败（限流）');
}

// 获取 token（带缓存，10分钟内复用，且两次调用间隔≥45秒）
export async function getOaToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now - lastTokenAt < 10 * 60 * 1000 && now - lastTokenAt >= 45000) {
    return cachedToken;
  }
  if (!tokenFetching) {
    tokenFetching = fetchToken().then(t => {
      cachedToken = t;
      lastTokenAt = Date.now();
      return t;
    }).finally(() => {
      tokenFetching = null;
    });
  }
  return tokenFetching;
}

// 建立 OA session，返回 cookie 字符串
async function getOaSession(): Promise<string> {
  const token = await getOaToken();
  const cookieParts: string[] = [];
  const res = await fetch(`${OA_URL()}/wui/index.html?ssoToken=${encodeURIComponent(token)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  const setCookies = res.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const name = c.split('=')[0];
    const val = c.split(';')[0].split('=').slice(1).join('=');
    const idx = cookieParts.findIndex(p => p.startsWith(name + '='));
    if (idx >= 0) cookieParts[idx] = `${name}=${val}`;
    else cookieParts.push(`${name}=${val}`);
  }
  if (cookieParts.length === 0) throw new Error('SSO 登录未建立 session');
  return cookieParts.join('; ');
}

// 下载附件并返回 buffer + 类型
export async function downloadOaAttachment(docOrFileId: string): Promise<{ buffer: Buffer; contentType: string; size: number; imageFileId: string }> {
  // 先解析：docid → imagefileid（wcqkfj 存的是 docid）
  const fileId = await resolveImageFileId(docOrFileId);
  const cookie = await getOaSession();
  const url = `${OA_URL()}/weaver/weaver.file.FileDownload?fileid=${encodeURIComponent(fileId)}&download=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`OA 附件下载失败 HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error('OA 附件内容为空');
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType, size: buffer.length, imageFileId: fileId };
}

// 根据内容判断 MIME/扩展名/类型
function detectMime(buffer: Buffer): { mime: string; ext: string; kind: 'image' | 'pdf' | 'office' | 'other' } {
  const hex = buffer.slice(0, 12).toString('hex');
  const bytes = buffer.slice(0, 8);
  // 图片
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (hex.startsWith('89504e47')) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (hex.startsWith('47494638')) return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  if (hex.startsWith('52494646')) return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (hex.startsWith('424d')) return { mime: 'image/bmp', ext: 'bmp', kind: 'image' };
  // PDF
  if (hex.startsWith('25504446')) return { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' };
  // Office 文档 (ZIP: PK)
  if (hex.startsWith('504b0304')) {
    // docx/xlsx/pptx 都是 zip，按扩展名难以区分，统一 office
    return { mime: 'application/octet-stream', ext: 'docx', kind: 'office' };
  }
  // 老版 doc (OLE: D0 CF 11 E0)
  if (hex.startsWith('d0cf11e0')) return { mime: 'application/msword', ext: 'doc', kind: 'office' };
  // Excel 97 (OLE 同 DOC，无法区分，按 office)
  // RTF
  if (bytes.toString('ascii').startsWith('{\\rtf')) return { mime: 'application/rtf', ext: 'rtf', kind: 'office' };
  // 纯文本
  const text = buffer.toString('utf8').slice(0, 2000);
  if (text && !buffer.subarray(0, 256).some(b => b === 0)) return { mime: 'text/plain', ext: 'txt', kind: 'other' };
  return { mime: 'application/octet-stream', ext: 'bin', kind: 'other' };
}

// 下载附件并保存到本地，返回本地访问 URL
// 若已缓存过（同 fileid），直接返回缓存
const savedCache = new Map<string, string>();

export async function saveOaAttachment(docId: string): Promise<{
  url: string;
  filename: string;
  mime: string;
  size: number;
  cached: boolean;
  kind: 'image' | 'pdf' | 'office' | 'other';
}> {
  // 解析 docid → imagefileid（作为缓存 key 和下载目标）
  const imageFileId = await resolveImageFileId(docId);
  const cacheKey = `${docId}:${imageFileId}`;
  if (savedCache.has(cacheKey)) {
    const cached = savedCache.get(cacheKey)!;
    try {
      const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), '.uploads');
      const stat = await fs.stat(path.join(uploadDir, cached));
      const kind = cached.endsWith('.pdf') ? 'pdf' as const : cached.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/) ? 'image' as const : cached.match(/\.(docx?|xlsx?|pptx?|rtf)$/) ? 'office' as const : 'other' as const;
      return { url: `/api/files/${cached}`, filename: cached, mime: kind === 'pdf' ? 'application/pdf' : kind === 'image' ? 'image/*' : 'application/octet-stream', size: stat.size, cached: true, kind };
    } catch { /* 文件可能被删，重新下载 */ }
  }

  const { buffer, contentType, imageFileId: realFileId } = await downloadOaAttachment(docId);
  const { mime, ext, kind } = detectMime(buffer);
  const filename = `oa_${realFileId}_${Date.now()}.${ext}`;
  // 入库（主存储）+ 落盘（缓存）
  try {
    const { saveFileToDb } = await import('@/storage/database/file-storage');
    await saveFileToDb(filename, contentType || mime, buffer);
  } catch (e) {
    console.warn('[oa-attachment] 附件入库失败（继续落盘）:', e instanceof Error ? e.message : e);
  }
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), '.uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, filename), buffer);
  savedCache.set(cacheKey, filename);
  return { url: `/api/files/${filename}`, filename, mime: contentType || mime, size: buffer.length, cached: false, kind };
}
