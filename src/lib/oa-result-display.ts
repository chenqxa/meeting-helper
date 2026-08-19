// 持续项导入元数据处理
// 背景：Excel 批量导入持续项时，把表格里的年/周/日期（{"y":"2025","w":"29","d":"2025-07-14"}）
// 存进了 oa_result 字段（batch route）。这串 JSON 不是真实汇报内容，
// 展示「上次汇报」和汇报弹窗预填时必须过滤掉，避免混入新一轮汇报文本。

/** 判断一段文本是否为纯导入元数据 JSON（含 y/w/d 任一字段且无其他实质内容） */
export function isImportMetaJson(text: string | null | undefined): boolean {
  if (!text || !text.trim().startsWith('{')) return false;
  try {
    const j = JSON.parse(text);
    return !!(j.y || j.w || j.d);
  } catch {
    return false;
  }
}

/**
 * 从文本中剥离内嵌的导入元数据 JSON（如 "2026-08-19{...}" → "2026-08-19"）。
 * 用于用户误把预填元数据一起提交后的清洗展示。
 */
export function stripEmbeddedMetaJson(text: string | null | undefined): string {
  if (!text) return '';
  // 匹配文本中内嵌的 {...}（内容含 "y"/"w"/"d" 键）并移除
  return text.replace(/\{[^{}]*"(?:y|w|d)"[^{}]*\}/g, '').trim();
}

/**
 * 取「可展示的真实汇报内容」：
 * - 纯元数据 → 返回 ''（视为未汇报过）
 * - 混合文本（含内嵌元数据）→ 剥离内嵌部分
 * - 正常文本 → 原样返回
 */
export function getDisplayOaResult(text: string | null | undefined): string {
  if (!text) return '';
  if (isImportMetaJson(text)) return '';
  return stripEmbeddedMetaJson(text);
}
