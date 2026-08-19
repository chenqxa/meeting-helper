import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { buildCompanyContextPrompt } from '@/lib/company-context';
import { getMeetings } from '@/storage';
import type { Meeting } from '@/storage';

export const runtime = 'nodejs';
export const maxDuration = 120;

const SYSTEM_PROMPT_TEMPLATE = (companyCtx: string, dataCtx: string) => `
你是「会议纪要助手」的内置 AI 助手，服务于 ${process.env.COMPANY_NAME || '宁波恒剑光电科技有限公司'} 的信息化团队。
你可以帮助用户查询会议内容、行动项状态、分析数据趋势，并回答与会议和任务管理相关的问题。

${companyCtx}

${dataCtx}

【能力说明】
- 查询近期会议摘要和行动项
- 分析行动项完成情况和逾期风险
- 解释系统功能和操作方法
- 根据数据给出建议

【回答规范】
- 用简洁专业的中文回答
- 数据引用要准确，不得编造
- 对于系统中没有的数据，明确告知"系统中暂无此数据"
- 回答结构清晰，适当使用 Markdown 格式
`.trim();

async function buildDataContext(userId: string, userRole: string): Promise<string> {
  try {
    const meetings = await getMeetings();
    // 聚合所有行动项
    const allActions = meetings.flatMap(m =>
      (m.actionItems || []).map((a: any) => ({ ...a, meetingTitle: m.title, meetingDate: m.meetingDate }))
    );

    // 行动项统计
    const myActions = userRole === 'admin' ? allActions : allActions.filter(a => a.owner === userId || a.assignee === userId);
    const total = allActions.length;
    const pending = allActions.filter(a => a.status === 'pending' || a.status === 'confirmed').length;
    const inProgress = allActions.filter(a => a.status === 'in_progress').length;
    const done = allActions.filter(a => a.status === 'done').length;
    const blocked = allActions.filter(a => a.status === 'blocked').length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = allActions.filter(a =>
      a.status !== 'done' && a.due_date && new Date(a.due_date) < today
    ).length;

    // 我的逾期/待处理
    const myPending = myActions.filter(a => a.status === 'pending' || a.status === 'confirmed' || a.status === 'in_progress').length;
    const myOverdue = myActions.filter(a =>
      a.status !== 'done' && a.due_date && new Date(a.due_date) < today
    ).length;

    // 近5条待处理行动项
    const recentPending = allActions
      .filter(a => a.status !== 'done')
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
      .slice(0, 5)
      .map(a => `  - [${a.status}] ${a.description}（负责人：${a.owner || '待分配'}，节点：${a.due_date || '无'}）`)
      .join('\n');

    // 近5次会议
    const recentMeetings = [...meetings]
      .sort((a, b) => (b.meetingDate || '').localeCompare(a.meetingDate || ''))
      .slice(0, 5)
      .map(m => `  - ${m.meetingDate || '日期未知'} | ${m.title} | 类型：${m.type || '—'}`)
      .join('\n');

    return `【系统数据快照（实时）】
行动项总计：${total} 条 | 待处理：${pending} | 进行中：${inProgress} | 已完成：${done} | 阻塞：${blocked} | 逾期：${overdue}
当前用户相关：待处理 ${myPending} 条，逾期 ${myOverdue} 条

近期待处理行动项（按节点排序）：
${recentPending || '  暂无'}

近期会议（最新5条）：
${recentMeetings || '  暂无'}`;
  } catch {
    return '【系统数据】暂时无法获取实时数据';
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const userId = user?.loginid || 'unknown';
    const userRole = user?.role || 'employee';

    const { messages } = await req.json() as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!messages?.length) {
      return new Response('缺少消息内容', { status: 400 });
    }

    // 构建上下文（并发）
    const [companyCtx, dataCtx] = await Promise.all([
      buildCompanyContextPrompt(),
      buildDataContext(userId, userRole),
    ]);

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE(companyCtx, dataCtx);

    const provider = process.env.AI_PROVIDER || 'siliconflow';
    const providerCfg = resolveAIConfig(provider);

    // 构建 messages
    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    // 流式调用
    const upstream = await fetch(`${providerCfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${providerCfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: providerCfg.model,
        messages: chatMessages,
        stream: true,
        temperature: 0.6,
        max_tokens: 2048,
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      console.error('[assistant] upstream error:', err);
      return new Response(`AI 服务异常: ${upstream.status}`, { status: 500 });
    }

    // 透传 SSE 流
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
            // 检查是否结束
            const text = decoder.decode(value, { stream: true });
            if (text.includes('data: [DONE]')) break;
          }
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[assistant] error:', err);
    return new Response('服务器错误', { status: 500 });
  }
}

function resolveAIConfig(provider: string) {
  switch (provider.toLowerCase()) {
    case 'tencent':
    case 'hunyuan':
      return {
        apiKey: process.env.TENCENT_API_KEY || '',
        baseUrl: process.env.TENCENT_BASE_URL || 'https://api.hunyuan.cloud.tencent.com/v1',
        model: process.env.TENCENT_MODEL || 'hunyuan-pro',
      };
    case 'qwen':
      return {
        apiKey: process.env.QWEN_API_KEY || '',
        baseUrl: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: process.env.QWEN_MODEL || 'qwen-max',
      };
    case 'deepseek':
      return {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      };
    default:
      return {
        apiKey: process.env.SILICONFLOW_API_KEY || '',
        baseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
        model: process.env.SILICONFLOW_MODEL || 'Pro/deepseek-ai/DeepSeek-V3',
      };
  }
}
