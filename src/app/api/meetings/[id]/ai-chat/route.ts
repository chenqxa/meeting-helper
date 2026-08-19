import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/siliconflow-client';
import { getMeetingById } from '@/storage';

export const maxDuration = 60;

const _clients: Partial<Record<string, ReturnType<typeof createClient>>> = {};
function getClient(provider = 'tencent') {
  return _clients[provider] ??= createClient(provider);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { question } = await request.json();
    if (!question?.trim()) {
      return NextResponse.json({ success: false, error: 'Missing question' }, { status: 400 });
    }

    const meeting = await getMeetingById(id);
    if (!meeting) {
      return NextResponse.json({ success: false, error: 'Meeting not found' }, { status: 404 });
    }

    const content = meeting.content || '';
    const minutesText = meeting.minutes
      ? (() => {
          try {
            const m = typeof meeting.minutes === 'string' ? JSON.parse(meeting.minutes) : meeting.minutes;
            const sections = m.sections?.map((s: any) =>
              `${s.title}\n${s.items?.map((it: any) => `  - ${it.subtitle}: ${it.points?.map((p: any) => p.text).join('；')}`).join('\n') || ''}`
            ).join('\n\n') || '';
            const actions = m.actionTable?.map((r: any) => `${r.seq}. ${r.task} → ${r.owner} (${r.goal || ''})`).join('\n') || '';
            return `【纪要摘要】\n${m.meetingContent || ''}\n\n【议题详情】\n${sections}\n\n【行动项】\n${actions}`;
          } catch { return ''; }
        })()
      : '';

    const context = [
      `会议标题：${meeting.title}`,
      `会议日期：${meeting.meetingDate || ''}`,
      `参会人：${(meeting.participants || []).join('、') || '未知'}`,
      minutesText ? minutesText : (content ? `【原始内容】\n${content.slice(0, 3000)}` : ''),
    ].filter(Boolean).join('\n\n');

    const systemPrompt = `你是一个专业的会议助手，负责解答用户关于特定会议的问题。
请根据以下会议信息，简洁、准确地回答用户的问题。
如果信息中没有相关内容，请如实说明"会议记录中未找到相关信息"。
回答要简洁（不超过200字），用中文。

${context}`;

    const answer = await getClient('tencent').generateText(question, systemPrompt, 0.3, 512);

    return NextResponse.json({ success: true, answer });
  } catch (error) {
    console.error('[AI Chat] Error:', error);
    return NextResponse.json({ success: false, error: 'AI 回复生成失败' }, { status: 500 });
  }
}
