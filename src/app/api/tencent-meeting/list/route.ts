import { NextResponse } from 'next/server';
import { listMeetings, getMeetingParticipants } from '@/lib/tencent-meeting';

// GET /api/tencent-meeting/list?days=30
export async function GET(request: Request) {
  const userid = process.env.TENCENT_MEETING_USERID || '';
  if (!process.env.TENCENT_MEETING_APPID || !userid) {
    return NextResponse.json(
      { success: false, error: '腾讯会议未配置，请在 .env 中设置 TENCENT_MEETING_APPID / SECRET_ID / SECRET_KEY / USERID' },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '30');

  try {
    const meetings = await listMeetings(userid, days);
    // 并发拉取每个已结束会议的参会人
    const withParticipants = await Promise.all(
      meetings.map(async m => {
        const participants = m.status === 3
          ? await getMeetingParticipants(m.meeting_id, userid)
          : [];
        return {
          meeting_id: m.meeting_id,
          meeting_code: m.meeting_code,
          subject: m.subject,
          start_time: m.start_time,
          end_time: m.end_time,
          status: m.status,
          status_label: m.status === 1 ? '待开始' : m.status === 2 ? '进行中' : '已结束',
          hosts: m.hosts || [],
          participants: participants.slice(0, 50),
        };
      })
    );
    return NextResponse.json({ success: true, data: withParticipants });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
