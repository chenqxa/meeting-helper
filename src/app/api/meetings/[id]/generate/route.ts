import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById, updateMeeting } from '@/storage/database/memory-storage';
import { MeetingProcessor } from '@/lib/meeting-processor';

export async function POST(request: NextRequest) {
  try {
    const { meetingId } = await request.json();

    if (!meetingId) {
      return NextResponse.json(
        { success: false, error: 'Missing meetingId' },
        { status: 400 }
      );
    }

    const meeting = await getMeetingById(meetingId);
    if (!meeting) {
      return NextResponse.json(
        { success: false, error: 'Meeting not found' },
        { status: 404 }
      );
    }

    // Check if content exists
    const content = meeting.content;
    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Meeting content is empty' },
        { status: 400 }
      );
    }

    console.log(`Starting processing for meeting ${meetingId}`);

    // Process meeting using the new pipeline
    const processedMeeting = await MeetingProcessor.processMeeting(
      content,
      meeting.title,
      meeting.meetingDate,
      {
        enableCleaning: true,
        enableSegmentation: true,
        enableSummary: true,
        enableActionExtraction: true,
        maxTextLength: 8000
      }
    );

    // Validate results
    const validation = MeetingProcessor.validateResults(processedMeeting);
    if (!validation.isValid) {
      console.warn('Processing validation warnings:', validation.warnings);
    }

    // Update meeting with processed data (summary + actionItems)
    await updateMeeting(meetingId, {
      summary: processedMeeting.summary,
      actionItems: processedMeeting.actionItems.actionItems,
      status: 'review',
    });

    // Generate processing report
    const report = MeetingProcessor.generateReport(processedMeeting);
    console.log('Processing completed:', report);

    return NextResponse.json({
      success: true,
      data: {
        meetingId,
        summary: processedMeeting.summary,
        actionItems: processedMeeting.actionItems.actionItems,
        segments: processedMeeting.segments.segments,
        metadata: processedMeeting.metadata,
        processingTime: processedMeeting.processingTime,
        validation: validation
      },
    });
  } catch (error) {
    console.error('Meeting processing failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
