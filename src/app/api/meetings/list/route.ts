import { NextResponse } from 'next/server';
import { getMeetings } from '@/storage/database/memory-storage';

export async function GET() {
  try {
    const meetings = await getMeetings();

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
