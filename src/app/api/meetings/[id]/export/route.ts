import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;
    const { format } = await request.json();

    if (!format || !['word', 'pdf'].includes(format)) {
      return NextResponse.json(
        { success: false, error: '无效的导出格式' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient();

    // 获取会议记录和行动项
    const { data: meeting } = await client
      .from('meeting_records')
      .select('*')
      .eq('id', meetingId)
      .single();

    const { data: actionItems } = await client
      .from('meeting_action_items')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });

    if (!meeting) {
      return NextResponse.json(
        { success: false, error: '会议不存在' },
        { status: 404 }
      );
    }

    const summary = meeting.summary || {};

    // 生成纪要内容
    let content = '';
    content += `会议纪要\n`;
    content += `====================================================\n\n`;
    content += `会议主题: ${meeting.title}\n`;
    content += `会议日期: ${meeting.meeting_date.split('T')[0]}\n`;
    content += `组织者: ${meeting.organizer}\n`;
    content += `参会人: ${meeting.participants.join(', ')}\n`;
    content += `版本: v${meeting.version}\n`;
    content += `导出时间: ${new Date().toLocaleString('zh-CN')}\n\n`;

    content += `一、会议摘要\n`;
    content += `----------------------------------------------------\n\n`;
    content += `1. 核心议题\n`;
    (summary.topics || []).forEach((topic: string, index: number) => {
      content += `   ${index + 1}. ${topic}\n`;
    });
    content += `\n`;

    content += `2. 关键决策\n`;
    (summary.keyDecisions || []).forEach((decision: string, index: number) => {
      content += `   ${index + 1}. ${decision}\n`;
    });
    content += `\n`;

    content += `3. 风险提醒\n`;
    (summary.risks || []).forEach((risk: string, index: number) => {
      content += `   ${index + 1}. ${risk}\n`;
    });
    content += `\n`;

    content += `4. 下一步建议\n`;
    (summary.nextSteps || []).forEach((step: string, index: number) => {
      content += `   ${index + 1}. ${step}\n`;
    });
    content += `\n`;

    if (actionItems && actionItems.length > 0) {
      content += `二、行动项\n`;
      content += `----------------------------------------------------\n\n`;
      actionItems.forEach((item, index) => {
        content += `${index + 1}. ${item.description}\n`;
        content += `   责任人: ${item.assignee || '未指定'}\n`;
        content += `   截止日期: ${item.dueDate || '未指定'}\n`;
        content += `   优先级: ${item.priority === 'high' ? '高' : item.priority === 'medium' ? '中' : '低'}\n`;
        content += `   状态: ${item.status === 'pending' ? '待处理' : item.status === 'in_progress' ? '进行中' : item.status === 'completed' ? '已完成' : '已取消'}\n`;
        content += `\n`;
      });
    }

    // 创建导出记录
    await client
      .from('meeting_export_records')
      .insert({
        meeting_id: meetingId,
        version: meeting.version as number,
        format,
        exported_by: meeting.organizer as string,
      });

    // 创建审计日志
    await client
      .from('meeting_audit_logs')
      .insert({
        meeting_id: meetingId,
        action: 'export',
        actor: meeting.organizer as string,
        details: `导出${format === 'word' ? 'Word' : 'PDF'}格式`,
      });

    // 返回文件内容（简化版本，实际应该生成真正的Word/PDF文件）
    // 这里返回一个data URI，前端可以下载
    const fileContent = Buffer.from(content, 'utf-8');
    const mimeType = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const dataUri = `data:${mimeType};base64,${fileContent.toString('base64')}`;

    return NextResponse.json({
      success: true,
      data: {
        fileUrl: dataUri,
        filename: `会议纪要_${meeting.title as string}_${(meeting.meeting_date as string)?.split('T')[0]}.${format === 'word' ? 'txt' : 'txt'}`,
      },
    });
  } catch (error) {
    console.error('导出失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '服务器内部错误',
      },
      { status: 500 }
    );
  }
}
