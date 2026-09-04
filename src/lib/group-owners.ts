// 群体/部门类责任人判定（非具体个人，无法推送到人、无法自助填写）
// 用于：贡献榜排除、mytasks 管理员代填入口、企微推送跳过等，口径统一

export const GROUP_OWNERS = new Set([
  '全体', '各部门', '采购', '研发', '销售', '品质', '生产', '计划', '项目部', '总经办',
  '采购部', '研发部', '销售部', '品质部', '生产部', '计划部', '工程部', '财务部',
  '品质部/生产部', '财务与研发', '各部门负责人', '各业务部门', '全体成员',
  '所有人', '全体员工', '全体人员', '相关责任人', '各责任人',
]);

// 判定是否群体责任人：精确名单 + 常见群体词缀（"各部门xxx"“xxx全体"等）
export function isGroupOwner(owner?: string | null): boolean {
  const o = String(owner || '').trim();
  if (!o) return false;
  if (GROUP_OWNERS.has(o)) return true;
  if (/^(全体|所有|各)/.test(o)) return true;      // 全体成员 / 所有人员 / 各部门…
  if (/(全体|所有人|各部门)$/.test(o)) return true; // xx部全体 / xx所有人
  return false;
}
