// 自动取数「取数源」元数据（纯常量，可被客户端页面安全 import，不含服务端依赖）
export interface AutoFetchSourceMeta {
  key: string;
  name: string;      // 展示名
  desc: string;      // 取数标准/口径说明（让使用人、看的人明白数据从哪来、怎么算、何时更新）
}

// 取数源注册表：以后新增报表源在下面加一行即可（key 唯一）
export const AUTO_FETCH_SOURCES: AutoFetchSourceMeta[] = [
  {
    key: 'k3-scrap-issue',
    name: '呆滞出库（K3其他出库单·呆滞）',
    desc: '数据源：金蝶K3「其他出库单」（FTranType=29，用途含"呆滞"）。口径：取上一自然周（周一~周日）已审核的单据，按单据汇总出库物料明细；每周一凌晨自动更新，开启后不再人工催报。',
  },
  {
    key: 'oa-price-maintenance',
    name: '采购价格维护（OA价格审批单·formtable_main_29）',
    desc: '数据源：OA采购价格审批单。口径：取上一自然周已批准/归档的单据，按单列出物料及原价/新价/终价；每周一凌晨自动更新，开启后不再人工催报。',
  },
  {
    key: 'oa-work-price-maintenance',
    name: '工价维护（OA工价审批单·formtable_main_51）',
    desc: '数据源：OA工价审批单。口径：取上一自然周已批准/归档的整机工价单，按整机展开各工序的工时/件工数/工价/人数；每周一凌晨自动更新，开启后不再人工催报。',
  },
  {
    key: 'oa-supplier-review',
    name: '新供应商评审（OA供应商评审·formtable_main_178）',
    desc: '数据源：OA供应商评审单。口径：取上一自然周已批准/归档的新供应商评审，一家一行展示（含质量分/结论）；每周一凌晨自动更新，开启后不再人工催报。',
  },
];

export const firstAutoFetchSourceKey = (): string | null => AUTO_FETCH_SOURCES[0]?.key ?? null;
export const autoFetchSourceName = (key?: string | null): string | null =>
  AUTO_FETCH_SOURCES.find(s => s.key === key)?.name ?? null;
export const autoFetchSourceDesc = (key?: string | null): string | null =>
  AUTO_FETCH_SOURCES.find(s => s.key === key)?.desc ?? null;
