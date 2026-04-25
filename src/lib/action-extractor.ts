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

const SYSTEM_PROMPT = `你是专业的会议纪要解析助手，只负责从会议文本中提取「待执行的行动项」。

【核心规则】
1. 只提取【未完成、需要执行】的事项。以下内容必须忽略：
   - 已完成的工作汇报（如"需求文档已经完成了"、"发了三篇文章"）
   - 纯背景描述、进度回顾
   - 讨论过程中的提问和回应
2. 行动项的判断标准：有明确的「要做什么」+「谁来做」或「什么时候做」。
3. 输出严格为JSON数组，不允许额外解释、不允许Markdown代码块。

【负责人识别规则 - 重要】
- 如果文本中有姓名（如"张三"），直接使用姓名
- 如果文本中只有部门/角色（如"研发"、"市场"、"产品"、"设计"），使用部门名称作为owner
- 如果文本中只有"说话人1"/"说话人2"等标记，需根据上下文推断其角色或部门
- 通过对话上下文推断：如"研发呢？"后面的回答者就是研发部门的人
- 通过任务分配语境推断：如"你提前找个测试人员"中的"你"指的是上文正在汇报的角色

【优先级规则】
- high: 有明确且紧迫的截止时间（如"明天"、"四月三号前"），或涉及线上风险
- medium: 有截止时间但不紧迫（如"四月八号"、"下周"），或常规事项
- low: 无明确时间要求（如"有空看看"、"后续考虑"）

【置信度规则】
- confidence_owner: 明确姓名1.0，明确部门/角色0.8~0.9，上下文推断0.5~0.7，无法识别0.0
- confidence_date: 明确日期1.0，模糊相对时间0.7~0.9，非常模糊0.3~0.6，无日期0.0

【输出格式】严格JSON数组：
[
  {
    "description": "任务内容，动词开头，简洁明确，不超过80字",
    "owner": "负责人姓名或部门角色（如'研发'、'市场'），无法识别时为null",
    "due_date": "截止日期YYYY-MM-DD，无法识别时为null",
    "priority": "high|medium|low",
    "initial_result": "预期完成标准或交付物（根据上下文推断），无法推断则为null",
    "confidence_owner": 0.0,
    "confidence_date": 0.0,
    "source_sentence": "行动项来源的原文句子（逐字摘录）"
  }
]`;

export class ActionExtractor {
  static async extractActionItems(
    segments: Array<{ content: string; speaker?: string; timestamp?: string }>
  ): Promise<ExtractionResult> {
    const fullText = segments.map(s => {
      if (s.speaker) return `[${s.speaker}]: ${s.content}`;
      return s.content;
    }).join('\n');

    const today = new Date().toISOString().split('T')[0];
    const userPrompt = `今天日期：${today}

## 会议转写文本
${fullText.substring(0, 6000)}

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

    const actionItems: ActionItem[] = rawItems.map((item, index) => ({
      id: `action-${index + 1}`,
      description: item.description || '待明确',
      assignee: item.owner ?? undefined,
      dueDate: item.due_date ?? undefined,
      priority: (['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium') as ActionItem['priority'],
      status: 'pending',
      initialResult: item.initial_result ?? undefined,
      confidence: {
        assignee: item.confidence_owner ?? (item.owner ? 0.8 : 0.1),
        dueDate: item.confidence_date ?? (item.due_date ? 0.8 : 0.1),
        priority: 0.7,
      },
      sourceText: item.source_sentence || '',
      category: inferCategory(item.description),
    }));

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
