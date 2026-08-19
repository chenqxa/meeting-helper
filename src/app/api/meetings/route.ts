import { NextRequest, NextResponse } from 'next/server';
import { createMeeting } from '@/storage';
import { getCurrentUser } from '@/lib/session';
import { logOperation } from '@/lib/operation-log';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, type, meetingDate, department, participants, organizer, inputType, content, fileUrl, fileName, projectId } = body;

    // 验证必填字段（organizer 可空，由当前登录用户兜底）
    if (!title || !type || !meetingDate || !participants) {
      return NextResponse.json(
        { success: false, error: '缺少必填字段' },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();

    // Create meeting record (organizer defaults to current user if not provided)
    const meetingData = await createMeeting({
      title,
      type,
      meetingDate,
      department: department || user?.dept || '',
      participants,
      organizer: (organizer && organizer !== '褰撳墠鐢ㄦ埛') ? organizer : (user?.name || user?.loginid || ''),
      organizerLoginId: user?.loginid,
      content: inputType === 'text' ? content : undefined,
      projectId: projectId || null,
    });

    await logOperation({
      action: 'meeting_create',
      targetType: 'meeting',
      targetId: meetingData.id,
      summary: `创建会议「${title}」（${type}）`,
      detail: { title, type, meetingDate, department: department || user?.dept },
    });

    return NextResponse.json({
      success: true,
      data: {
        meetingId: meetingData.id,
      },
    });
  } catch (error) {
    console.error('API 错误:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '服务器内部错误',
      },
      { status: 500 }
    );
  }
}
