// 自动取数「取数源」元数据（纯常量，可被客户端页面安全 import，不含服务端依赖）
export interface AutoFetchSourceMeta {
  key: string;
  name: string;  // 展示名
  src: string;   // 数据来源：哪个系统/库/表
  how: string;   // 怎么取：口径规则（哪一类单据、什么状态、怎么汇总）
  when: string;  // 何时自动更新
}

// 取数源注册表：以后新增报表源在下面加一行即可（key 唯一）
export const AUTO_FETCH_SOURCES: AutoFetchSourceMeta[] = [
  {
    key: 'k3-scrap-issue',
    name: '呆滞出库',
    src: '金蝶K3「其他出库单（呆滞）」。',
    how: '取上一自然周（周一~周日）内已审核、用途为"呆滞处理"的其他出库单，按单据分组列出每张单的物料出库明细。',
    when: '每周一 00:30（北京时间）自动抓取并写入本期进展；开启后不再人工催报。',
  },
  {
    key: 'oa-price-maintenance',
    name: '采购价格维护',
    src: '泛微OA「采购价格审批单」。',
    how: '取上一自然周（周一~周日）已批准/归档的价格审批单，按单据列出物料及规格/单位/原价/新价/终价。',
    when: '每周一 00:30（北京时间）自动抓取并写入本期进展；开启后不再人工催报。',
  },
  {
    key: 'oa-work-price-maintenance',
    name: '工价维护',
    src: '泛微OA「工价审批单」。',
    how: '统计上一自然周（周一~周日）已批准/归档的整机工价单（即本周新增的工价条数），可展开查看每单各工序的工时/件工数/工价/人数。',
    when: '每周一 00:30（北京时间）自动抓取并写入本期进展；开启后不再人工催报。',
  },
  {
    key: 'oa-supplier-review',
    name: '新供应商评审',
    src: '泛微OA「新供应商评审」。',
    how: '取上一自然周（周一~周日）已批准/归档的新供应商评审，一家一行：申请日期/供应商/联系人/评审产品/类别/质量分/结论。',
    when: '每周一 00:30（北京时间）自动抓取并写入本期进展；开启后不再人工催报。',
  },
];

export const firstAutoFetchSourceKey = (): string | null => AUTO_FETCH_SOURCES[0]?.key ?? null;
export const autoFetchSourceName = (key?: string | null): string | null =>
  AUTO_FETCH_SOURCES.find(s => s.key === key)?.name ?? null;
export const autoFetchSourceInfo = (key?: string | null): AutoFetchSourceMeta | null =>
  AUTO_FETCH_SOURCES.find(s => s.key === key) ?? null;
// 悬停提示用的一句口径（持续项跟进页等）
export const autoFetchSourceDesc = (key?: string | null): string | null => {
  const m = AUTO_FETCH_SOURCES.find(s => s.key === key);
  if (!m) return null;
  return `数据来源：${m.src}取数规则：${m.how}更新：${m.when}`;
};
