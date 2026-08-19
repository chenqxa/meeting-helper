// 行动项提取模块 - 使用中文提示词 + 单次 API 调用
import { siliconFlowClient } from './siliconflow-client';

export interface ActionItem {
  id: string;
  description: string;        // 任务内容，动词开头
  assignee?: string;          // 负责人
  dueDate?: string;           // 截止日期 YYYY-MM-DD
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  initialResult?: string;     // AI 预测的初步结果/交付标准（供后期校验）
  confidence: {
    assignee: number;         // 负责人置信度 0-1
    dueDate: number;          // 截止日期置信度 0-1
    priority: number;         // 优先级置信度 0-1
  };
  sourceText: string;         // 原文来源句子
  category: 'task' | 'follow-up' | 'decision' | 'review' | 'other';
}

export interface ExtractionResult {
  actionItems: ActionItem[];
  metadata: {
    totalItems: number;
    byPriority: Record<string, number>;
    byAssignee: Record<string, number>;
    byCategory: Record<string, number>;
    confidence: number;
  };
}

// AI 返回的原始行动项格式
interface RawActionItem {
  description: string;
  owner: string | null;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low';
  initial_result: string | null;
  confidence_owner: number;
  confidence_date: number;
  source_sentence: string;
}

const SYSTEM_PROMPT = `你是专业的会议纪要解析助手，从会议文本中提取关键行动项。

【核心原则】追求精准、可读、高质量，不追求数量。

【提取规则】
1. 只提取【有实际价值的待办事项】，忽略：已完成的汇报、纯背景描述、讨论中的提问。
2. 合并同类项：相关联的小任务合并成一个有意义的行动项。例如"添加筛选功能"和"添加物料筛选"合并为"各业务模块增加筛选功能"。
3. 提炼概括：不要照搬原文碎片，用简洁专业的语言概括任务目标和方向。
4. 数量控制：根据会议内容自然输出，不必凑数，最多不超过20条。只保留有明确方向和价值的事项。
5. 每条行动项必须让不参会的人也能看懂。

【负责人识别】
- 优先用姓名（如"张三"），没有姓名用部门/角色（如"研发"、"市场"）
- 多人协作的写主要负责人/方向（如"信息化/销售"）
- 通过上下文推断说话人身份

【优先级】
- high: 有紧迫截止时间或涉及线上风险
- medium: 有时间要求但不紧迫，或常规推进事项
- low: 无明确时间，后续规划

【置信度】
- confidence_owner: 明确姓名1.0，部门/角色0.8~0.9，推断0.5~0.7，无0.0
- confidence_date: 明确日期1.0，模糊时间0.7~0.9，无0.0

【输出格式】严格JSON数组，不要任何额外文字：
[
  {
    "description": "任务内容，动词开头，简洁专业，不超过50字",
    "owner": "负责人姓名或部门（如'信息化/销售'），无法识别为null",
    "due_date": "截止日期，必须为YYYY-MM-DD格式。所有时间信息（如'6月25日前'→2026-06-25、'下周五'→计算具体日期、'月底'→当月最后一天）都必须转换为此字段，不要放到其他字段。无法推断为null",
    "priority": "high|medium|low",
    "initial_result": "预期交付物或成果（如'需求文档初稿'、'系统上线可演示'），仅描述交付物，不含时间，无法推断为null",
    "confidence_owner": 0.0,
    "confidence_date": 0.0,
    "source_sentence": "关键来源原文"
  }
]`;

export class ActionExtractor {
  static async extractActionItems(
    segments: Array<{ content: string; speaker?: string; timestamp?: string }>,
    participants?: string[]
  ): Promise<ExtractionResult> {
    const fullText = segments.map(s => {
      if (s.speaker) return `[${s.speaker}]: ${s.content}`;
      return s.content;
    }).join('\n');

    const today = new Date().toISOString().split('T')[0];
    const participantHint = participants && participants.length > 0
      ? `\n- 参会人员：${participants.join('、')}\n  请尽量将行动项的负责人匹配到以上具体人名，而不是笼统的部门名。`
      : '';
    const userPrompt = `今天日期：${today}${participantHint}

## 会议转写文本
${fullText.substring(0, 12000)}

请从以上文本中提取所有行动项，严格按JSON数组格式输出，不需要任何说明文字。`;

    let rawItems: RawActionItem[] = [];
    try {
      rawItems = await siliconFlowClient.generateJson<RawActionItem[]>(
        userPrompt,
        SYSTEM_PROMPT,
        0.1  // 低温度，追求确定性
      );
      if (!Array.isArray(rawItems)) rawItems = [];
    } catch (error) {
      console.error('[ActionExtractor] AI extraction failed:', error);
      rawItems = [];
    }

    const actionItems: ActionItem[] = rawItems.map((item, index) => {
      let dueDate = item.due_date ?? undefined;
      const dateSource = dueDate ? null : [item.initial_result, item.description, item.source_sentence].find(s => {
        if (!s) return false;
        return /\d{1,2}月\d{1,2}|月底|下[周月]|\d{4}年\d{1,2}月|\d{1,2}[\/\-]\d{1,2}/.test(s);
      });
      if (!dueDate && dateSource) {
        const m = dateSource.match(/(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/);
        if (m) {
          dueDate = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
        }
      }
      if (!dueDate && dateSource) {
        const m = dateSource.match(/(\d{1,2})[月/\-.](\d{1,2})/);
        if (m) {
          const y = new Date().getFullYear();
          dueDate = `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
        }
      }
      return {
        id: `action-${index + 1}`,
        description: item.description || '待明确',
        assignee: item.owner ?? undefined,
        dueDate,
        priority: (['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium') as ActionItem['priority'],
        status: 'pending',
        initialResult: item.initial_result ?? undefined,
        confidence: {
          assignee: item.confidence_owner ?? (item.owner ? 0.8 : 0.1),
          dueDate: item.confidence_date ?? (dueDate ? 0.7 : 0.1),
          priority: 0.7,
        },
        sourceText: item.source_sentence || '',
        category: inferCategory(item.description),
      };
    });

    return { actionItems, metadata: calcMetadata(actionItems) };
  }
}

function inferCategory(description: string): ActionItem['category'] {
  const d = description || '';
  if (/审查|审核|检查|核查|review|check/i.test(d)) return 'review';
  if (/决策|决定|确定方案|decide/i.test(d)) return 'decision';
  if (/跟进|跟踪|follow/i.test(d)) return 'follow-up';
  if (/完成|实现|开发|编写|制作|整理|输出/i.test(d)) return 'task';
  return 'other';
}

function calcMetadata(items: ActionItem[]): ExtractionResult['metadata'] {
  const byPriority: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const byAssignee: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalConf = 0;

  for (const item of items) {
    byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
    if (item.assignee) byAssignee[item.assignee] = (byAssignee[item.assignee] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    totalConf += (item.confidence.assignee + item.confidence.dueDate + item.confidence.priority) / 3;
  }

  return {
    totalItems: items.length,
    byPriority,
    byAssignee,
    byCategory,
    confidence: items.length > 0 ? totalConf / items.length : 0,
  };
}
