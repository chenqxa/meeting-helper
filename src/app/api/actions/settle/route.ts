import { NextResponse } from 'next/server';
import { getMeetings, updateMeeting } from '@/storage';
import { guardWrite } from '@/lib/api-guard';

// POST /api/actions/settle
// 将所有超期且无 OA 回传的行动项 oa_score 写入 -1，供个人积分汇总使用
export async function POST() {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const meetings = await getMeetings();
    let settled = 0;

    for (const meeting of meetings) {
      const items: any[] = meeting.actionItems || [];
      let changed = false;

      const updated = items.map((item: any) => {
        // 已有 oa_score 或已完成/勾稽 → 跳过
        if (item.oa_score !== null && item.oa_score !== undefined) return item;
        if (item.status === 'done' || item.status === 'verified') return item;
        if (!item.due_date) return item;
        if (new Date(item.due_date) >= today) return item;
        if (item.oa_result) return item;

        // 超期且无回传 → 自动 -1
        changed = true;
        settled++;
        return {
          ...item,
          oa_score: -1,
          oa_auto_detected: true,
          oa_result_at: new Date().toISOString(),
        };
      });

      if (changed) {
        await updateMeeting(meeting.id, { actionItems: updated });
      }
    }

    return NextResponse.json({ success: true, data: { settled } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
