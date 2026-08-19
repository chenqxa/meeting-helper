import { NextRequest, NextResponse } from 'next/server';
import { createMeeting } from '@/storage';

// POST /api/tencent-meeting/import
// body: { meeting_id, subject, start_time, participants: [{userid, username}], hosts }
export async function POST(request: NextRequest) {
  try {
    const { subject, start_time, participants, hosts, meeting_code } = await request.json();

    const dateStr = new Date(Number(start_time) * 1000).toISOString().slice(0, 10);
    const participantNames = (participants || []).map((p: any) => p.username || p.userid).filter(Boolean);
    const hostNames = (hosts || []).map((h: any) => h.username || h.userid).filter(Boolean);

    const meeting = await createMeeting({
      title: subject || '腾讯会议导入',
      type: 'general',
      meeting_date: dateStr,
      source: 'tencent',
      tencent_meeting_code: meeting_code || '',
      participants: [...new Set([...hostNames, ...participantNames])],
      organizer: hostNames[0] || '',
      transcript: '',
      summary: '',
      actionItems: [],
      status: 'draft',
    } as any);

    return NextResponse.json({ success: true, data: { id: meeting.id, title: meeting.title } });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
