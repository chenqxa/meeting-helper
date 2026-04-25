import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;
    const client = getSupabaseClient();

    // 获取当前会议信息
    const { data: meeting, error: meetingError } = await client
      .from('meeting_records')
      .select('*')
      .eq('id', meetingId)
      .single();

    if (meetingError || !meeting) {
      return NextResponse.json(
        { success: false, error: '会议不存在' },
        { status: 404 }
      );
    }

    // 更新会议状态为锁定
    const { error: updateError } = await client
      .from('meeting_records')
      .update({
        status: 'locked',
        version: meeting.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', meetingId);

    if (updateError) {
      throw new Error(`更新会议状态失败: ${updateError.message}`);
    }

    // 创建审计日志
    await client
      .from('meeting_audit_logs')
      .insert({
        meeting_id: meetingId,
        action: 'lock_version',
        actor: meeting.organizer,
        details: `锁定版本 v${meeting.version + 1}`,
      });

    return NextResponse.json({
      success: true,
      message: '版本已锁定',
      data: {
        version: meeting.version + 1,
      },
    });
  } catch (error) {
    console.error('锁定版本失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '服务器内部错误',
      },
      { status: 500 }
    );
  }
}
