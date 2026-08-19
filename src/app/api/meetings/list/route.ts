import { NextResponse } from 'next/server';
import { getMeetings } from '@/storage';
import { getCurrentUser } from '@/lib/session';
import { resolveRole } from '@/lib/roles';

export async function GET() {
  try {
    const user = await getCurrentUser();
    const all = await getMeetings();

    let meetings = all;
    if (user) {
      const role = await resolveRole(user.loginid);

      const isSelf = (m: (typeof all)[0]) =>
        (m as any).organizerLoginId === user.loginid ||
        m.organizer === user.loginid ||
        m.organizer === user.name ||
        m.participants.includes(user.loginid) ||
        m.participants.includes(user.name);

      if (role === 'admin') {
        // admin：看全部会议
        meetings = all;
      } else if (role === 'manager' || role === 'secretary') {
        // manager & secretary：本部门所有 + 自己参与/创建的
        const dept = user.dept || '';
        meetings = all.filter(m =>
          (dept && (m as any).department === dept) || isSelf(m)
        );
      } else {
        // employee：仅自己创建或参与的
        meetings = all.filter(isSelf);
      }
    }

    return NextResponse.json({
      success: true,
      data: meetings,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
