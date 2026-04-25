import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient();

    // 获取有文件的会议记录
    const { data: meetings, error } = await client
      .from('meeting_records')
      .select('*')
      .not('file_url', 'is', null)
      .not('file_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      throw new Error(`获取文件列表失败: ${error.message}`);
    }

    // 转换为文件列表格式
    const files = meetings?.map(meeting => ({
      id: meeting.id,
      filename: meeting.file_name,
      url: meeting.file_url,
      type: meeting.file_name?.endsWith('.mp3') || meeting.file_name?.endsWith('.wav') ? 'audio/mpeg' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: Math.floor(Math.random() * 10 * 1024 * 1024), // 模拟文件大小
      created_at: meeting.created_at,
    })) || [];

    return NextResponse.json({
      success: true,
      data: files,
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
