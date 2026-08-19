import { NextResponse } from 'next/server';
import { getAllActionItems, getMeetingById, updateActionItem, updateMeeting } from '@/storage';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';

// POST /api/actions/backfill-owner-oaid
// 为历史行动项批量补齐 ownerOaId / ownerLoginId / owner
export async function POST() {
  try {
    const items = await getAllActionItems();
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const item of items) {
      scanned++;

      if (item.ownerOaId && item.ownerLoginId && item.owner) {
        skipped++;
        continue;
      }

      const resolved = await resolveActionOwnerIdentity({
        owner: item.owner,
        ownerLoginId: item.ownerLoginId,
        ownerOaId: item.ownerOaId,
        dept: item.dept,
      });

      const hasChanges =
        resolved.owner !== (item.owner || null) ||
        resolved.ownerLoginId !== (item.ownerLoginId || null) ||
        resolved.ownerOaId !== (item.ownerOaId || null) ||
        resolved.dept !== (item.dept || null);

      if (!hasChanges) {
        skipped++;
        continue;
      }

      try {
        const saved = await updateActionItem(item.id, {
          owner: resolved.owner,
          ownerLoginId: resolved.ownerLoginId,
          ownerOaId: resolved.ownerOaId,
          dept: resolved.dept,
        });

        if (saved?.meetingId) {
          const meeting = await getMeetingById(saved.meetingId);
          if (meeting) {
            const nextItems = [...(meeting.actionItems || [])];
            const idx = nextItems.findIndex((it: any) =>
              it.id === saved.originalId || it.id === saved.id
            );
            if (idx !== -1) {
              nextItems[idx] = {
                ...nextItems[idx],
                assignee: saved.owner,
                owner: saved.owner,
                ownerLoginId: saved.ownerLoginId,
                ownerOaId: saved.ownerOaId,
                dept: saved.dept,
              };
              await updateMeeting(saved.meetingId, { actionItems: nextItems });
            }
          }
        }

        updated++;
      } catch (error) {
        errors.push(`${item.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        scanned,
        updated,
        skipped,
        errors,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '回填失败',
      },
      { status: 500 }
    );
  }
}
