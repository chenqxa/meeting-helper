// Excel 带图导入解析：文本（exceljs）+ 内嵌图片锚点（jszip 手解 drawing）
// 背景：目标文件的图片存放在非标准路径 xl/drawings/media/，exceljs 读不到，故手动解包。
// 匹配键：Excel 行号（序号可能重复，绝不用序号做键）。
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export interface ParsedImage {
  buffer: Buffer;
  ext: string;
  mediaPath: string;
}

export interface ParsedRecord {
  row: number;
  seq: string;
  location: string;
  description: string;
  measure: string;
  dept: string;
  owner: string;
  dueDate: string;
  images: ParsedImage[];
}

export interface ParseResult {
  records: ParsedRecord[];
  totalImages: number;
  departments: string[];
  warnings: string[];
}

function cleanCell(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const anyV = v as Record<string, unknown>;
    if ('text' in anyV) return String(anyV.text ?? '').trim();
    if ('result' in anyV) return String(anyV.result ?? '').trim();
    if ('richText' in anyV) return (anyV.richText as { text: string }[]).map(t => t.text).join('').trim();
  }
  return String(v).trim();
}

/** 归一化部门：合并空白、去首尾 */
function normalizeDept(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export async function parseExcelWithImages(buffer: Buffer): Promise<ParseResult> {
  const warnings: string[] = [];

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('未找到工作表');

  // ── 表头定位（存在才映射；兼容将来新增「责任人 / 节点时间」列）──
  const colIndex: Record<string, number> = {};
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    const v = cleanCell(cell.value);
    if (v) colIndex[v] = col;
  });
  const findCol = (...names: string[]): number => {
    for (const n of names) {
      for (const [k, c] of Object.entries(colIndex)) if (k.includes(n)) return c;
    }
    return 0; // 0 = 未找到（falsy，可安全 || 兜底）
  };
  const colSeq = findCol('序号');
  const colLoc = findCol('问题位置', '位置');
  const colDesc = findCol('问题现状描述', '现状', '描述');
  const colMeasure = findCol('整改措施', '措施');
  const colDept = findCol('整改责任部门', '责任部门', '部门');
  const colPhoto = findCol('照片', '现场照片');
  const colOwner = findCol('责任人', '负责人');
  const colDue = findCol('节点时间', '节点', '截止', '期限');

  // 表头必须能识别出"描述"列，否则多半不是这份模板
  if (!colDesc) {
    throw new Error('未识别到表头「问题现状描述」，请确认这是《厂区环境问题记录表》模板（首行需为表头）');
  }

  // 安全取单元格（列号 <=0 表示该列不存在，返回空）
  const cv = (row: ExcelJS.Row, col: number): string => (col > 0 ? cleanCell(row.getCell(col).value) : '');

  // ── 文本行（按合并区去重：只取合并主行）──
  const records: ParsedRecord[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const c = row.getCell(colDesc);
    const master = c.master as unknown as { row?: number } | undefined;
    if (c.isMerged && master && master.row !== undefined && master.row !== rowNumber) return;
    const description = cleanCell(c.value);
    if (!description) return;
    records.push({
      row: rowNumber,
      seq: cv(row, colSeq),
      location: cv(row, colLoc),
      description,
      measure: cv(row, colMeasure),
      dept: normalizeDept(cv(row, colDept)),
      owner: normalizeDept(cv(row, colOwner)),
      dueDate: cv(row, colDue),
      images: [],
    });
  });

  // ── 图片锚点（jszip）──
  const zip = await JSZip.loadAsync(buffer);
  // 定位 sheet1 引用的 drawing（找不到则回退 drawing1.xml）
  let drawingPath = 'xl/drawings/drawing1.xml';
  try {
    const sheetRels = zip.file('xl/worksheets/_rels/sheet1.xml.rels');
    if (sheetRels) {
      const rels = await sheetRels.async('string');
      const m = rels.match(/Target="([^"]*drawings\/drawing\d+\.xml)"/);
      if (m) drawingPath = m[1].startsWith('xl/') ? m[1] : 'xl/' + m[1].replace(/^\/?\.\.\//, '').replace(/^\//, '');
    }
  } catch { /* 用默认 */ }

  const drawingFile = zip.file(drawingPath);
  if (!drawingFile) {
    warnings.push(`未找到 drawing（${drawingPath}），无图片可导入`);
    return { records, totalImages: 0, departments: summarizeDepts(records), warnings };
  }
  const drawingXml = await drawingFile.async('string');
  const relsPath = drawingPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const relsFile = zip.file(relsPath);
  const relMap = new Map<string, string>();
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      let target = m[2];
      if (target.startsWith('../')) target = 'xl/' + target.slice(3);
      else if (!target.startsWith('xl/')) target = 'xl/drawings/' + target.replace(/^\/?/, '');
      relMap.set(m[1], target);
    }
  }

  // 记录行号 → 最近记录（锚点落在合并区内也归位）
  const rowsSorted = records.map(r => r.row).sort((a, b) => a - b);
  const recordByRow = new Map(records.map(r => [r.row, r]));
  const nearestRecord = (anchorRow: number): ParsedRecord | null => {
    if (recordByRow.has(anchorRow)) return recordByRow.get(anchorRow)!;
    let best: number | null = null;
    for (const r of rowsSorted) { if (r <= anchorRow) best = r; else break; }
    if (best != null && anchorRow - best <= 3) return recordByRow.get(best)!;
    return null;
  };

  let totalImages = 0;
  for (const m of drawingXml.matchAll(/<(xdr:twoCellAnchor|xdr:oneCellAnchor)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const body = m[2];
    const fromBlock = body.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/)?.[1] || body;
    const row0 = Number(fromBlock.match(/<xdr:row>(\d+)<\/xdr:row>/)?.[1] ?? -1);
    const col0 = Number(fromBlock.match(/<xdr:col>(\d+)<\/xdr:col>/)?.[1] ?? -1);
    const rid = body.match(/r:embed="([^"]+)"/)?.[1];
    if (row0 < 0 || !rid) continue;
    const anchorRow = row0 + 1;
    const anchorCol = col0 + 1;
    const rec = nearestRecord(anchorRow);
    if (!rec) { warnings.push(`图片锚点行 ${anchorRow} 未匹配到数据行（孤儿图）`); continue; }
    if (colPhoto > 0 && anchorCol !== colPhoto) { warnings.push(`图片锚点列 ${anchorCol} ≠ 照片列 ${colPhoto}（行 ${anchorRow}）`); }
    const target = relMap.get(rid);
    const imgFile = target ? zip.file(target) : null;
    if (!imgFile) { warnings.push(`图片资源缺失：${rid}（行 ${anchorRow}）`); continue; }
    const imgBuf = Buffer.from(await imgFile.async('nodebuffer'));
    const ext = (target!.split('.').pop() || 'jpg').toLowerCase();
    rec.images.push({ buffer: imgBuf, ext, mediaPath: target! });
    totalImages++;
  }

  return { records, totalImages, departments: summarizeDepts(records), warnings };
}

function summarizeDepts(records: ParsedRecord[]): string[] {
  return [...new Set(records.map(r => r.dept).filter(Boolean))];
}
