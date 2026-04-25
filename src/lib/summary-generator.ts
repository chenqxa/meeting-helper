// 会议摘要生成模块 - 使用中文提示词 + 单次 API 调用
import { siliconFlowClient } from './siliconflow-client';

export interface StructuredSummary {
  title: string;
  overview: string;
  keyTopics: Array<{
    topic: string;
    description: string;
    importance: 'high' | 'medium' | 'low';
  }>;
  decisions: Array<{
    decision: string;
    rationale: string;
    impact: string;
    stakeholders: string[];
  }>;
  risks: Array<{
    risk: string;
    probability: 'high' | 'medium' | 'low';
    impact: 'high' | 'medium' | 'low';
    mitigation: string;
  }>;
  nextSteps: Array<{
    step: string;
    owner?: string;
    timeline?: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  participants: string[];
  meetingDate: string;
  estimatedDuration: string;
}

const SUMMARY_SYSTEM_PROMPT = `你是专业的会议纪要整理助手，根据会议转写文本生成结构化摘要。

【输出规则】
1. 会议摘要（overview）：用简洁中文总结本次会议的核心议题和关键结论，不超过300字。只写最重要的内容，不要事无巨细。
2. 关键议题（keyTopics）：只提取2~4个最核心的议题，不要把每个发言都当成议题。合并相关话题。
3. 关键决策（decisions）：只提取会议中明确达成共识的决策，讨论中的意见不算决策。没有决策则返回空数组。
4. 风险识别（risks）：只提取明确提到的风险或问题（如延期、目标未达成），不要凭空推测风险。
5. 下一步（nextSteps）：只列出有明确行动要求的后续步骤，纯讨论不算。负责人可以是姓名或部门角色。

【写作规范】
- 客观陈述，不添加原文中没有的信息
- 使用简洁专业的中文，避免冗余
- 若某类信息在原文中不存在，对应数组返回空数组[]
- 负责人：优先用姓名，没有姓名时用部门/角色（如"研发"、"市场"）

【输出格式】严格JSON对象，不要额外文字：
{
  "overview": "会议摘要，不超过300字",
  "keyTopics": [{"topic": "议题名称", "description": "简要描述", "importance": "high|medium|low"}],
  "decisions": [{"decision": "决策内容", "rationale": "决策原因", "impact": "影响范围", "stakeholders": ["相关人员"]}],
  "risks": [{"risk": "风险描述", "probability": "high|medium|low", "impact": "high|medium|low", "mitigation": "应对建议"}],
  "nextSteps": [{"step": "行动描述", "owner": "负责人或null", "timeline": "时间节点或null", "priority": "high|medium|low"}]
}`;

export class SummaryGenerator {
  static async generateSummary(
    segments: Array<{ content: string; speaker?: string; type?: string }>,
    meetingTitle: string,
    meetingDate: string
  ): Promise<StructuredSummary> {
    const fullText = segments.map(s => {
      if (s.speaker) return `[${s.speaker}]: ${s.content}`;
      return s.content;
    }).join('\n');

    const participants = [...new Set(segments.map(s => s.speaker).filter(Boolean))] as string[];
    const estimatedDuration = this.estimateDuration(segments.length);

    const userPrompt = `## 会议信息
- 会议主题：${meetingTitle}
- 会议日期：${meetingDate}
- 参会人：${participants.length > 0 ? participants.join('、') : '待明确'}

## 会议转写文本
${fullText.substring(0, 7000)}

请根据以上内容生成结构化会议摘要，严格按JSON格式输出，不需要任何额外说明。`;

    let result: Partial<StructuredSummary> = {};
    try {
      const raw = await siliconFlowClient.generateJson<{
        overview?: string;
        keyTopics?: StructuredSummary['keyTopics'];
        decisions?: StructuredSummary['decisions'];
        risks?: StructuredSummary['risks'];
        nextSteps?: StructuredSummary['nextSteps'];
      }>(userPrompt, SUMMARY_SYSTEM_PROMPT, 0.3);

      result = raw;
    } catch (error) {
      console.error('[SummaryGenerator] AI generation failed:', error);
    }

    return {
      title: meetingTitle,
      overview: result.overview || '摘要生成失败，请重试。',
      keyTopics: result.keyTopics || [],
      decisions: result.decisions || [],
      risks: result.risks || [],
      nextSteps: result.nextSteps || [],
      participants,
      meetingDate,
      estimatedDuration,
    };
  }

  private static estimateDuration(segmentCount: number): string {
    const estimatedMinutes = Math.max(segmentCount * 2.5, 5);
    const hours = Math.floor(estimatedMinutes / 60);
    const minutes = Math.round(estimatedMinutes % 60);
    return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
  }
}
