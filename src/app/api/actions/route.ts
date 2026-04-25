import { NextResponse } from 'next/server';
import { getMeetings } from '@/storage/database/memory-storage';

// GET /api/actions - 聚合所有会议中的行动项
export async function GET() {
  try {
    const meetings = await getMeetings();

    const allActions = meetings.flatMap(meeting =>
      (meeting.actionItems || []).map((item: any) => ({
        id: `${meeting.id}-${item.id}`, // 确保ID唯一：会议ID+行动项ID
        description: item.description,
        owner: item.assignee || item.owner || null,
        due_date: item.dueDate || item.due_date || null,
        priority: item.priority || 'medium',
        status: item.status || 'pending',
        confidence_owner: item.confidence?.assignee ?? item.confidence_owner ?? 0.5,
        confidence_date: item.confidence?.dueDate ?? item.confidence_date ?? 0.5,
        source_sentence: item.sourceText || item.source_sentence || '',
        initial_result: item.initialResult || item.initial_result || null,
        meeting_id: meeting.id,
        meeting_title: meeting.title,
        confirmed_by: item.confirmed_by || null,
        confirmed_at: item.confirmed_at || null,
        completed_by: item.completed_by || null,
        completed_at: item.completed_at || null,
        completion_note: item.completion_note || null,
        evidence_files: item.evidence_files || [],
        block_reason: item.block_reason || null,
        blocked_by: item.blocked_by || null,
        blocked_at: item.blocked_at || null,
      }))
    );

    return NextResponse.json({ success: true, data: allActions });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
