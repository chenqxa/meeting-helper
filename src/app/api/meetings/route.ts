import { NextRequest, NextResponse } from 'next/server';
import { createMeeting } from '@/storage/database/memory-storage';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, type, meetingDate, participants, organizer, inputType, content, fileUrl, fileName } = body;

    // 验证必填字段
    if (!title || !type || !meetingDate || !participants || !organizer) {
      return NextResponse.json(
        { success: false, error: '缺少必填字段' },
        { status: 400 }
      );
    }

    // Create meeting record using memory storage
    const meetingData = await createMeeting({
      title,
      type,
      meetingDate,
      participants,
      organizer,
      content: inputType === 'text' ? content : undefined,
    });

    // Create audit log (skipped for memory storage)

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
