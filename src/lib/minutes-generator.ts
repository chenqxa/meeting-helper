// 会议纪要生成器 - 一次性生成完整结构化会议纪要（参照飞书/钉钉风格）
import { createClient } from './siliconflow-client';
import { buildCompanyContextPrompt, OWNER_OVERRIDES, APPROVER_ONLY_KEYWORDS } from './company-context';

// 混合模式：DeepSeek-V3（SiliconFlow）负责读取全文提取，默认混元 Pro 负责生成格式化纪要
// 懒加载：避免 Next.js build 阶段模块评估时因 API Key 未配置报错
let _extractClient: ReturnType<typeof createClient> | null = null;
const _generateClients: Partial<Record<string, ReturnType<typeof createClient>>> = {};
function getExtractClient() { return _extractClient ??= createClient('siliconflow'); }
function getGenerateClient(provider = 'tencent') {
  return _generateClients[provider] ??= createClient(provider);
}

export interface MinutesPoint {
  label: string;    // 标签: "问题" | "决议" | "共识" | "方向" | "进展" | "待办" | "背景"
  text: string;     // 内容正文
  bullets?: string[]; // 可选的列表子项（决议/行动通常是列表）
}

export interface MinutesItem {
  seq: number;
  subtitle: string;
  points: MinutesPoint[];
}

export interface MinutesSection {
  title: string;      // 一、核心讨论与决议
  items: MinutesItem[];
}

export interface MeetingMinutes {
  title: string;
  meetingDate: string;
  meetingTheme: string;
  meetingContent: string;
  sections: MinutesSection[];
  actionTable: Array<{
    seq: number;
    task: string;
    owner: string;
    ownerLoginId?: string;
    ownerOaId?: string;
    ownerDept?: string;
    goal: string;
  }>;
  markdownBody?: string; // 正文 Markdown（前端直接渲染）
  debug_step1a_markdown?: string; // 调试用：完整原始 Markdown
  conclusion: string;
}

// ── Step 0 输出的会议分析结构 ──
interface MeetingAnalysis {
  meetingType: string;  // 自由文本，如"周例会"/"信息化系统会议"/"产品评审会"
  suggestedChapters: Array<{
    title: string;        // 章节标题，如"一、核心数据通报"
    scope: string;        // 本章节应涵盖的内容范围
    isDataSection?: boolean;  // 该章节含精确数字数据（需逐项提取，不得省略）
    isDiscussionSection?: boolean; // 该章节为专项讨论与决议型（需三层结构）
    perItemRule?: string; // 该章节每个条目的特殊规则（如"每个部门一条"）
    items?: Array<{       // 讨论型章节中，每个具体议题
      title: string;      // 议题标题（如"订单交期管理"）
      initiator?: string; // 提出方（如"销售"、"财务"），无法确定时省略
      scope: string;      // 本议题应涵盖的内容
    }>;
  }>;
  actionCandidates: Array<{
    raw: string;          // 原文中与此行动项相关的原始表述
    source: string;       // "会议决议" | "未完成任务" | "持续跟进" | "专项讨论"
    suggestedOwner: string; // 建议责任人/部门，确认不了写"待明确"
    urgencyHint: string;  // 紧迫度提示，如"尽快"/"本周"/"目标6月底"/"待方案确定后"
  }>;
}

// ── 从 Markdown 表格中代码提取行动项 ──
function extractActionTableFromMarkdown(md: string): Array<{ seq: number; task: string; owner: string; goal: string }> {
  const lines = md.split('\n');
  const rows: Array<{ seq: number; task: string; owner: string; goal: string }> = [];

  // 找到行动项表格：搜索含"序号"或"#"+"任务"+"责任人"的表头行
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('|') && /(序号|#)/.test(t) && /(任务|内容)/.test(t) && /责任人/.test(t)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    console.log('[extractActionTable] No action table header found in Markdown');
    return rows;
  }

  // 跳过表头行和紧随的分隔行 |---|---|
  let dataStart = headerIdx + 1;
  if (dataStart < lines.length && /^\|[\s\-:|]+\|/.test(lines[dataStart].trim())) {
    dataStart++;
  }

  // 读取数据行直到非表格行
  for (let i = dataStart; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|')) break;
    if (/^\|[\s\-:|]+\|/.test(t)) continue; // 跳过意外的分隔行

    const cells = t.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 3) {
      rows.push({
        seq: parseInt(cells[0]) || rows.length + 1,
        task: cells[1] || '',
        owner: cells[2] || '',
        goal: cells[3] || '',
      });
    }
  }

  console.log(`[extractActionTable] Found ${rows.length} action items from Markdown table`);
  return rows;
}

// ── 从 Markdown 中提取并移除行动项表格和会议总结 ──
function splitMarkdownParts(md: string): { body: string; conclusion: string } {
  const lines = md.split('\n');
  const keep = new Array(lines.length).fill(true); // 标记每行是否保留
  let conclusion = '';

  // 1. 找到会议总结标题行（兼容多种格式：## 会议总结、**会议总结**、会议总结 等）
  let summaryStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (/^#{1,3}\s*会议总结/.test(t) || /^\*{2}会议总结\*{2}/.test(t) || t === '会议总结') {
      summaryStart = i;
      break;
    }
  }
  if (summaryStart >= 0) {
    keep[summaryStart] = false; // 移除标题行
    const summaryLines: string[] = [];
    for (let i = summaryStart + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      // 遇到新的 ## 标题或表格行就停止
      if (/^#{1,3}\s/.test(t) || (t.startsWith('|') && /(序号|#)/.test(t))) break;
      keep[i] = false; // 移除总结内容行
      if (t) summaryLines.push(t);
    }
    conclusion = summaryLines.join('');
  }

  // 2. 找到行动项表格并标记移除
  for (let i = 0; i < lines.length; i++) {
    if (/序号.*任务.*责任人/.test(lines[i]) && lines[i].includes('|')) {
      // 向上标记章节标题（如"## 行动项"）
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        if (/行动项|待办|跟踪|后续行动/.test(lines[j])) { for (let k = j; k <= i; k++) keep[k] = false; break; }
      }
      keep[i] = false; // 表头行
      // 分隔行 + 数据行
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t.startsWith('|') && t !== '') break;
        keep[j] = false;
      }
      break;
    }
  }

  const body = lines.filter((_, i) => keep[i]).join('\n').trim();
  console.log(`[splitMarkdownParts] body=${body.length} chars, conclusion=${conclusion.length} chars`);
  return { body, conclusion };
}

// ── Step 0：会议分析系统提示 ──
const ANALYSIS_SYSTEM_PROMPT = `你是会议分析专家。读取会议内容，输出一份分析JSON，供后续生成会议纪要使用。
公司关键系统与术语（必须原样保留）：K3（金蝶ERP）、BOM、OA（泛微OA）、ERP、企微、微盘、恒研通。
输出严格JSON，不输出任何JSON以外的文字。`;

// ── Step 1：纪要生成的通用写作规则（精简版 - 只保留核心约束）──
const MINUTES_SYSTEM_PROMPT_SUFFIX = `

【核心原则】
1. 完整不遗漏：每个部门每条工作都要出现，每个有任务的人都要列出。
2. 内容忠实：只写会议实际说过的内容，保留关键数字、人名、系统名（K3、BOM、OA等）。
3. 责任人准确：只写被明确点名的人，没有指定写部门名，绝对不猜。决策者≠执行人。

【写作质量 - 最重要】
- ⚠️ 禁止照搬ASR原文：语音转写是口语流水账，必须理解含义后用书面语精炼表述
- 每条 bullet/text 用简洁书面语，一句话概括核心事实，不要写口语长句
- 坏例（照搬口语）："反馈问题回复有但不能处理；提付款按他要求；规范性开票沈总写OK但零七八单立业违规"
- 好例（精炼书面语）："发票合规问题尚在协调处理中；付款审核按规范执行"
- 同一件事只写一次，不在多个章节重复出现
- text 字段用直接陈述句，不加"关于…""经过讨论…"等废话

【数据/任务章节规则】
- 未完成任务/持续性任务：按人合并，格式 "部门（人名）：任务1、任务2"
  ⚠️ 每个有任务的人/部门都必须出现，一个不能少
- 各部门工作汇报：每部门独立 item，部门内每条工作独立 bullet（每条精炼为一句话）
  ⚠️ 所有部门都必须出现（销售/研发/计划/生产/采购/财务/信息化/人事等）
- 数据通报：精确抄录数字，包含"未按时提交人名""较上周变化"等对比信息

【专项讨论章节规则】
- 每个议题至少含：问题 → 讨论（如有）→ 决议
- 决议有多条时用 bullets 逐条列出，不合并
- 保留案例细节（"例如"后面的列举不删减），但用书面语改写

【label 可选值（仅供写作参考，不影响输出格式）】
问题、数据通报、决议、共识、方向、进展、汇报内容、待办、风险提示、背景、讨论`;

// ASR 误识别纠正表（语音转写的常见错误 → 正确术语）
const ASR_CORRECTIONS: Array<[RegExp, string]> = [
  [/保姆工价|包母工价|保母工价/g, 'BOM工价'],
  [/保姆表|包母表|保母表/g, 'BOM表'],
  [/保姆|包母|保母|包目/g, 'BOM'],
  [/K\s*三|K三|k3/g, 'K3'],
  [/发言人\s*\d+/g, '[待指定]'],
];

// ── 中文日期 → 阿拉伯数字日期（五月十四号 → 5月14日）──
const CN_MONTH_NUM: Record<string, number> = {
  '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,
};
const CN_DAY_NUM: Record<string, number> = {
  '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,
  '十':10,'十一':11,'十二':12,'十三':13,'十四':14,'十五':15,
  '十六':16,'十七':17,'十八':18,'十九':19,'二十':20,
  '二十一':21,'二十二':22,'二十三':23,'二十四':24,'二十五':25,
  '二十六':26,'二十七':27,'二十八':28,'二十九':29,'三十':30,'三十一':31,
};
function normalizeCnDates(text: string): string {
  return text.replace(
    /(十二|十一|[一二三四五六七八九十])(月)(三十一|三十|二十[一二三四五六七八九]|二十|十[一二三四五六七八九]|十|[一二三四五六七八九])(号|日)/g,
    (full, m, _月, d) => {
      const mo = CN_MONTH_NUM[m], dy = CN_DAY_NUM[d];
      return (mo && dy) ? `${mo}月${dy}日` : full;
    }
  );
}

// ── 语音口读数字序列 → 阿拉伯数字（幺零六五七 → 10657）──
// 规则：包含"幺"字（口读数字专用，只在念序列号时出现）的连续数字串全部转换
const SPEECH_DIGIT: Record<string, string> = {
  '幺':'1','零':'0','一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9',
};
function normalizeCnDigits(text: string): string {
  const toArabic = (m: string) => m.split('').map(c => SPEECH_DIGIT[c] ?? c).join('');
  // 规则1：含"幺"的数字串（幺是口读1的专用字，绝不出现在正常文字中）
  let result = text.replace(
    /[幺零一二三四五六七八九]*幺[幺零一二三四五六七八九]*/g,
    (m) => m.length >= 2 ? toArabic(m) : m
  );
  // 规则2：紧跟在"、"后面的纯数字串（同一列举中，前项已是阿拉伯数字时，后项大概率也是数字）
  // 例：...1065752248584654、四七零二七八一... → 四七零二七八一 也转换
  result = result.replace(
    /(?<=\d[^，。；\n]{0,5}[、,])([零一二三四五六七八九]{4,})/g,
    (m) => toArabic(m)
  );
  return result;
}

function normalizeTranscript(text: string): string {
  let result = text;
  for (const [pattern, replacement] of ASR_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  result = normalizeCnDates(result);
  result = normalizeCnDigits(result);
  return result;
}

// ── 责任人硬重映射（通用：处理结构化 task/owner 对）──
function remapOwner(task: string, owner: string): string {
  for (const rule of OWNER_OVERRIDES) {
    const matchesKeyword = rule.keywords.some(kw => task.includes(kw));
    const matchesForbidden = rule.forbidden.some(f => owner.includes(f));
    if (matchesKeyword && matchesForbidden) return rule.assignTo;
  }
  if (owner.includes('朱总') || owner.includes('朱剑军')) {
    if (APPROVER_ONLY_KEYWORDS.some(kw => task.includes(kw))) return '待明确';
  }
  return owner;
}

// actionTable 版本
function applyOwnerOverrides(
  actionTable: MeetingMinutes['actionTable']
): MeetingMinutes['actionTable'] {
  return actionTable.map(item => {
    const newOwner = remapOwner(item.task, item.owner);
    if (newOwner !== item.owner) {
      console.log(`[OwnerOverride/action] seq=${item.seq} "${item.task}" → "${item.owner}" 改为 "${newOwner}"`);
      return { ...item, owner: newOwner };
    }
    return item;
  });
}

// sections bullets 版本（自由文本如 "朱总：世纪停产物料..."）
function applyOwnerOverridesToSections(sections: MinutesSection[]): MinutesSection[] {
  return sections.map(section => ({
    ...section,
    items: section.items.map(item => ({
      ...item,
      points: item.points.map(point => {
        if (!point.bullets?.length) return point;
        const fixedBullets = point.bullets.map(bullet => {
          let fixed = bullet;
          for (const rule of OWNER_OVERRIDES) {
            const matchesKeyword = rule.keywords.some(kw => fixed.includes(kw));
            const matchesForbidden = rule.forbidden.some(f => fixed.includes(f));
            if (matchesKeyword && matchesForbidden) {
              for (const forbidden of rule.forbidden) {
                const before = fixed;
                fixed = fixed.replace(new RegExp(forbidden, 'g'), rule.assignTo);
                if (fixed !== before) console.log(`[OwnerOverride/section] bullet: "${before}" → "${fixed}"`);
              }
            }
          }
          return fixed;
        });
        return { ...point, bullets: fixedBullets };
      }),
    })),
  }));
}

// ── 一致性校验（生成完成后打印警告，不阻断输出）──
function validateActionTable(actionTable: MeetingMinutes['actionTable']): void {
  const violations: string[] = [];
  for (const item of actionTable) {
    if ((item.owner.includes('朱总') || item.owner.includes('朱剑军')) &&
        !item.task.includes('主持') && !item.task.includes('汇报')) {
      violations.push(`⚠️ seq=${item.seq} owner含朱总但任务非主持/汇报："${item.task}"`);
    }
  }
  const hasShiji = actionTable.some(i => i.task.includes('世纪') || i.task.includes('停产物料'));
  if (!hasShiji) {
    violations.push('⚠️ 行动项中未找到"世纪/停产物料"相关任务，可能被遗漏');
  }
  if (violations.length > 0) {
    console.warn('[ValidateActionTable] 一致性问题：\n' + violations.join('\n'));
  } else {
    console.log('[ValidateActionTable] 校验通过');
  }
}

export class MinutesGenerator {
  static async generateMinutes(
    text: string,
    meetingTitle: string,
    meetingDate: string,
    participants: string[],
    generateProvider: string = 'tencent'
  ): Promise<MeetingMinutes> {
    const participantList = participants.length > 0
      ? participants.join('、')
      : '待明确';

    // ASR 误识别纠正
    text = normalizeTranscript(text);
    console.log('[MinutesGenerator] ASR normalization applied');

    // 运行时构建 system prompt（含 OA 人员信息）
    const companyCtx = await buildCompanyContextPrompt();
    // system prompt 在 Step 1 调用时直接拼接，不再使用独立变量

    // ── 自适应策略 ──
    // 大上下文模型：直接传全文，一步生成（顺序完整、质量最好）
    //   - siliconflow (DeepSeek-V3): 128k
    //   - tencent hunyuan-2.0: 256k
    //   - qwen (qwen-max/qwen-long): 32k~1M
    // 小上下文模型（hunyuan-pro / 32k）：两步法——并行提取 → 汇总生成
    const LARGE_CONTEXT_THRESHOLD = 20000;
    // 使用用户实际选择的 provider，而不是环境变量（修复：前者才是真正运行时的选择）
    const activeProvider = generateProvider.toLowerCase();
    const tencentModel = (process.env.TENCENT_MODEL || '').toLowerCase();
    const isLargeContext =
      activeProvider === 'siliconflow' ||
      activeProvider === 'qwen' ||
      activeProvider === 'deepseek' ||
      activeProvider === 'deepseek-v4' ||
      activeProvider === 'deepseek-v4-pro' ||
      (activeProvider === 'tencent' && tencentModel.includes('hunyuan-2.0'));
    console.log(`[MinutesGenerator] provider=${activeProvider}, isLargeContext=${isLargeContext}, textLen=${text.length}`);

    let meetingContext: string;

    if (!isLargeContext && text.length > LARGE_CONTEXT_THRESHOLD) {
      // ── 两步法（Hunyuan-Pro）──
      const EXTRACT_CHUNK = 10000;
      console.log(`[MinutesGenerator] Two-step mode: ${text.length} chars → ${Math.ceil(text.length / EXTRACT_CHUNK)} chunks`);

      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += EXTRACT_CHUNK) {
        chunks.push(text.substring(i, i + EXTRACT_CHUNK));
      }

      const EXTRACT_SYSTEM = `你是会议内容提取助手，服务于一家灯具制造业企业。
公司关键系统与术语（必须原样保留）：K3（金蝶ERP）、BOM、OA（泛微OA）、ERP、企微、微盘、恒研通、MRP。
提取要求：
- 严格按本段内容的先后顺序提取，不得调换顺序
- 保留所有人名、系统名、具体数字，不要泛化
- 数字类数据（出勤人数、任务完成率、金额等）必须精确抄录，不得模糊
- 责任人只提取被明确点名或本人主动承诺的，不得推断；推断不出的写"[待指定]"
- 决策者不等于执行人（"朱总同意"不代表朱总负责执行）`;

      const extractPrompt = (chunk: string, idx: number) =>
        `会议转写（第${idx + 1}/${chunks.length}段）参会人：${participantList}\n\n${chunk}\n\n请从本段按出现先后顺序提取要点，输出格式如下（只输出有内容的类别）：\n\n【数据播报】本段出现的数字性数据（出勤、完成率、金额等），每项一行，精确保留数字。\n【汇报内容】发言人姓名或部门：工作要点（按顺序，每部门/人一段）。\n【专项讨论】多人参与讨论的问题：问题描述。决议/结论：XXX。\n【行动项（最多3条）】明确被指定的任务：任务描述 → 责任人（只写被明确点名的人，否则写部门名，推断不出写[待指定]）。`;

      let extractions: string[];
      try {
        extractions = await Promise.all(chunks.map((chunk, idx) =>
          getExtractClient().generateText(extractPrompt(chunk, idx), EXTRACT_SYSTEM, 0.1, 2048)
        ));
        console.log(`[MinutesGenerator] Extraction via SiliconFlow OK`);
      } catch (extractErr) {
        console.warn(`[MinutesGenerator] SiliconFlow extraction failed (${(extractErr as Error).message}), falling back to ${generateProvider}...`);
        extractions = await Promise.all(chunks.map((chunk, idx) =>
          getGenerateClient(generateProvider).generateText(extractPrompt(chunk, idx), EXTRACT_SYSTEM, 0.1, 2048)
        ));
        console.log(`[MinutesGenerator] Extraction via ${generateProvider} OK (fallback)`);
      }

      // ── 融合步骤：将多段提取结果按议题归并，消除跨chunk碎片化 ──
      const rawContext = extractions.join('\n---\n');
      if (chunks.length > 1) {
        console.log(`[MinutesGenerator] Fusing ${chunks.length} chunk extractions...`);
        try {
          const FUSION_PROMPT = `你是会议纪要融合助手。以下是从同一场会议的多个段落分别提取的信息碎片。
请将它们按会议进行顺序整合（段落1内容在前，段落2在后），输出一份完整的会议要点。规则：
- 严格保持各段落的先后顺序，不得按重要性重新排序
- 同一个人/部门在多个段落有相同议题的，就地合并到第一次出现的位置
- 不要改变事实，不要添加原文没有的内容
- 保留所有人名、系统名、具体数据

${rawContext}`;
          meetingContext = await getExtractClient().generateText(FUSION_PROMPT, EXTRACT_SYSTEM, 0.1, 4096); // fusion always uses siliconflow
          console.log(`[MinutesGenerator] Fusion complete: ${meetingContext.length} chars`);
        } catch (fusionErr) {
          console.warn(`[MinutesGenerator] Fusion failed, using raw join:`, (fusionErr as Error).message);
          meetingContext = rawContext;
        }
      } else {
        meetingContext = rawContext;
      }
      console.log(`[MinutesGenerator] Two-step extracted: ${meetingContext.length} chars`);
    } else {
      // ── 单步法（DeepSeek-V3 直接读全文，不超过 128k）──
      meetingContext = text;
      console.log(`[MinutesGenerator] Single-step mode: ${text.length} chars (full text via DeepSeek)`);
    }

    const inputText = meetingContext.substring(0, isLargeContext ? 120000 : 14000);

    // ════════════════════════════════════════
    // Step 1：生成 Markdown 会议纪要（包含行动项表格）
    // ════════════════════════════════════════
    const isWeeklyMeeting = /周例会|周会|例会/.test(meetingTitle);

    // 周例会提供参考章节结构（不强制，原文无对应内容时可省略该子项）
    const structureTemplate = isWeeklyMeeting
      ? `
## 章节参考结构（依据原文实际内容生成，无对应内容的子项直接省略）

一、核心数据通报
  - 出勤与报告：应到/实到人数、按时提交率、未提交人员名单
  - 任务达成：上周到期任务数、完成数、完成率、与上周对比
  - 关键未完成任务：按"部门（人名）：任务1（截止日期）、任务2"格式，每人一行，一个不漏
  - 持续性任务：各部门正在进行、尚未结案的常规任务

二、各部门上周重点工作复盘
  - 每个汇报部门独立列出（销售/研发/计划/生产/采购/财务/信息化/人事/行政等）
  - 每条工作一个bullet，语言书面精炼

三、专项问题讨论与决议
  - 每个议题三层：**问题** → **讨论** → **决议**（每层内容完整，不省略细节）

## 会议总结
  - 必须使用 "## 会议总结" 作为标题（二级标题）
  - 一段话概括核心问题、共识和后续方向`
      : '';

    const markdownPrompt = `你是专业的会议纪要撰写助手。请根据以下会议转写文本，生成一份详细、完整的会议纪要。

## 会议基本信息
- 会议标题：${meetingTitle}
- 会议日期：${meetingDate}
- 参会人员：${participantList}
${structureTemplate}

## 写作要求
1. 内容完整：每个部门每条工作都要出现，每个有未完成任务的人都要列出，不遗漏
2. 不因简短就遗漏：即使一句话的计划/目标也要完整记录
3. 语言自然：用简洁书面语概括核心事实，避免机械模板感和重复套话
4. 专项讨论保留原文结构：有"问题/讨论/决议"时按层次写，没有某层时直接省略
5. ⚠️ 每个人/部门独立成行：涉及多人/多部门任务时（如关键未完成任务、持续性任务），每人/每部门单独一个 bullet，格式为"- **人名/部门名**：任务1、任务2"，禁止把多人任务合并到同一行
6. 保留关键数字、人名、系统名（K3、BOM、OA等）
7. 货币单位规则（重要，语音转写常有歧义）：
   - 只有当"美元/美金/USD"明确修饰该金额时才标注货币单位
   - ⚠️ "XX万美金没有"/"美金没有"/"美金无"→ 意思是"没有美金收款"，前面的金额不是美金
   - ⚠️ "XX万，美金"后面紧跟"没有/无/不是"→ 该金额不是美金，默认为人民币
   - 无法确定货币时，只写数字不加单位（如"81.09万"）
8. ⚠️ 会议总结必须使用 "## 会议总结" 二级标题，独立成章，放在正文最后（行动项表格之前）
9. ⚠️ 禁止编造发言归属（非常重要）：
   - 不要猜测谁说了什么。只有原文明确出现"XXX说/提出/反映/表示"时才写"XXX指出…"
   - 原文没有明确发言人时，直接写内容本身，不加人名，如"与会者指出…"或直接陈述事实
   - 不要写"由XX代为汇报"，除非原文明确说了
   - 不要根据部门猜测发言人：比如财务相关内容不一定是财务负责人说的，可能是其他人提出
   - 讨论环节如果无法确定发言人，用"与会者讨论认为…"或直接写讨论内容
10. ⚠️ 订单号/编号中的中文数字转换：
    - 判断依据：由纯数字汉字（零一二三四五六七八九）逐位连续读出，且出现在订单、合同、单号、尾号、编号等上下文中，则转换为阿拉伯数字
    - 例：订单尾号"五七" → 57，"三二九" → 329，"八八零六" → 8806
    - 识别技巧：这类读法是"逐位朗读"（五=5、七=7），不是"量词读法"（五十七=57）
    - 保持不变的情况：有量词含义的中文数字不转换，如"五个""三五天""七八成""两件""十来个"

## 会议转写文本
${inputText}

## ⚠️ 必须包含行动项表格（非常重要）
在会议纪要末尾（会议总结之后），必须附加一个行动项表格，包含 8~10 条从会议中提取的关键行动项。
格式如下：

| 序号 | 任务 | 责任人 | 截止/目标 |
|------|------|--------|-----------|
| 1 | 具体任务描述 | 张三 | 5月15日 |

⚠️ 如果缺少此表格，整个纪要视为不合格。

请直接输出 Markdown 格式的会议纪要（不要输出其他说明文字）：`;

    try {
      console.log(`[MinutesGenerator] Step 1: Generating Markdown minutes...`);
      const markdownMinutes = await getGenerateClient(generateProvider).generateText(
        markdownPrompt,
        `你是专业的会议纪要撰写助手。输出详细完整的 Markdown 格式会议纪要。\n\n${companyCtx}${MINUTES_SYSTEM_PROMPT_SUFFIX}`,
        0.3,
        32768
      );
      console.log(`[MinutesGenerator] Step 1 done: ${markdownMinutes.length} chars`);

      // ════════════════════════════════════════
      // Step 2：代码提取行动项表格（不调 AI）
      // ════════════════════════════════════════
      let actionTable = extractActionTableFromMarkdown(markdownMinutes);
      actionTable = applyOwnerOverrides(actionTable);
      validateActionTable(actionTable);
      console.log(`[MinutesGenerator] Extracted ${actionTable.length} action items from Markdown`);

      // 从 Markdown 中拆分：正文 / 会议总结 / 行动项表格（前端分别渲染）
      const { body, conclusion } = splitMarkdownParts(markdownMinutes);

      return {
        title: `${meetingDate} ${meetingTitle} 会议纪要`,
        meetingDate,
        meetingTheme: meetingTitle,
        meetingContent: '',
        sections: [],
        actionTable,
        conclusion,
        markdownBody: body, // 正文 Markdown（前端直接渲染）
        debug_step1a_markdown: markdownMinutes, // 调试用：完整原始 Markdown
      };
    } catch (error) {
      console.error('[MinutesGenerator] Generation failed:', error);
      return {
        title: `${meetingDate} ${meetingTitle} 会议纪要`,
        meetingDate,
        meetingTheme: meetingTitle,
        meetingContent: '',
        sections: [],
        actionTable: [],
        conclusion: '纪要生成失败，请重试。',
      };
    }
  }
}
