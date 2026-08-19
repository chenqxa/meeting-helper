// 公司信息化项目责任人配置
// 维护这里即可，所有会议纪要生成时自动注入
// 新增项目或换人时直接修改此文件

import { getEmployees, getDepartments } from '@/storage/database/org-storage';

export const COMPANY_CONTEXT = {
  industry: '灯具制造业',
  companyName: '宁波恒剑光电科技有限公司',

  // ── 项目 / 模块 → 主要负责人（手动维护，OA不含项目归属）──
  // 格式：'模块名': '责任人姓名或角色'
  moduleOwners: {
    '会议助手':     '陈巧霞',
    '任务管理平台':  '付天宇',
    '供应链中台':   '汪华正',
    '经营看板':     '沈意玲',
    '应付看板':     '沈意玲',
    '恒研通':       '陈巧霞',
    '研发AI平台':   '沈意玲',
    'AI生图工具':   '陈巧霞',
    '规格书工具':   '沈意玲',
    '生产指令打印': '汪华正',
    '日报表跟踪':   '沈意玲',
    '脚本管理':     '付天宇',
    '软件专利':     '付天宇',    // 信息化/AI/软件类专利
    '研发专利':     '虞周峰',    // 产品/硬件/工艺类专利
    '历史订单查询': '汪华正',
    'OA集成':       '陈巧霞',
    '企微集成':     '汪华正',
    '微盘':         '汪华正',
  },

  // ── 易混淆人名备注（简称/同音字）──
  personNotes: [
    '⚠️ "玉英"=李玉英(计划)，"意玲"=沈意玲(信息化)，两人完全不同',
    '⚠️ "沈总"=沈旭日(销售)≠沈旭挺(仓储)≠沈意玲(信息化)',
    '⚠️ "阿婷"=沈旭挺（仓储部），负责模具/试模/停产物料，不是行政部或财务部',
    '⚠️ "洪香"=财务部负责人，"戎双娇/戎总"=总经办兼人事，两人不得互换',
    '⚠️ "沈意玲/意玲/意林"只属于信息化部，绝对不能出现在财务部或人事行政部的汇报人位置',
    '⚠️ "朱总同意"≠"朱总执行"，执行人必须来自原文，否则写"待明确"',
    '⚠️ 禁止推断：专项讨论中，责任人只能来自原文，不得通过模块负责人表推断',
  ],

  // ── 关键系统术语（禁止AI替换）──
  systemTerms: [
    'K3（金蝶ERP）',
    'BOM（客户BOM/公共BOM）',
    'OA（泛微OA）',
    '企微（企业微信）',
    '微盘',
    '恒研通',
    '供应链中台',
  ],
};

// ── 责任人强制重映射表（代码层面兜底，不依赖AI）──
// 当 task 包含 keywords 中任意词，且 owner 包含 forbidden 中任意词时，强制覆盖为 assignTo
export const OWNER_OVERRIDES: Array<{
  keywords: string[];
  forbidden: string[];
  assignTo: string;
}> = [
  {
    keywords: ['世纪产品', '停产物料', '遗留物料', '世纪停产'],
    forbidden: ['朱总', '朱剑军'],
    assignTo: '沈旭挺',
  },
  {
    keywords: ['临时生产线', '协调生产线', '组建生产线', '建临时线', '临时线'],
    forbidden: ['朱总', '朱剑军'],
    assignTo: '计划部、行政部、生产部',
  },
];

// ── 朱总禁止作为执行人的关键词（若 owner=朱总/朱剑军 且 task 含这些词，强制改为"待明确"）──
export const APPROVER_ONLY_KEYWORDS = ['同意', '批准', '确认', '审批', '支持', '推动'];

// 从本地DB（已同步自OA）动态读取人员职责
async function buildStaffRolesFromDB(): Promise<string> {
  try {
    const [employees, departments] = await Promise.all([getEmployees(), getDepartments()]);
    const deptMap = new Map(departments.map(d => [d.id, d.name]));
    const active = employees.filter(e => e.status === 'active');
    if (active.length === 0) return '';
    const lines = active.map(e => {
      const dept = deptMap.get(e.departmentId) || '';
      const pos = e.position ? `${e.position}` : '';
      return `  ${e.name}：${[dept, pos].filter(Boolean).join(' · ')}`;
    });
    return lines.join('\n');
  } catch {
    return '';
  }
}

// 生成注入AI提示词的公司背景描述（异步，运行时从DB读人员信息）
export async function buildCompanyContextPrompt(): Promise<string> {
  const { industry, moduleOwners, systemTerms, personNotes } = COMPANY_CONTEXT;

  const ownerLines = Object.entries(moduleOwners)
    .map(([mod, owner]) => `  ${mod} → ${owner}`)
    .join('\n');

  const staffLines = await buildStaffRolesFromDB();

  return `【公司背景】行业：${industry}，公司：${COMPANY_CONTEXT.companyName}

【人名易混淆提醒（严格区分）】
${personNotes.join('\n')}

【项目负责人对照表（actionTable owner字段优先参考此表）】
${ownerLines}

【关键系统术语（必须原样使用）】
${systemTerms.join('、')}
${staffLines ? `\n【人员与职责（来自OA，辅助推断责任人）】\n${staffLines}` : ''}`;
}
