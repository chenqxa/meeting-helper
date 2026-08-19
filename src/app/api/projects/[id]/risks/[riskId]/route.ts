import { NextRequest, NextResponse } from 'next/server';
import { getRiskById, updateProjectRisk, deleteProjectRisk } from '@/storage';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; riskId: string }> }
) {
  try {
    const { riskId } = await params;
    const body = await request.json();
    const updated = await updateProjectRisk(riskId, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Risk not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[projects/:id/risks/:riskId][PATCH]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; riskId: string }> }
) {
  try {
    const { riskId } = await params;
    const ok = await deleteProjectRisk(riskId);
    if (!ok) {
      return NextResponse.json({ success: false, error: 'Risk not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[projects/:id/risks/:riskId][DELETE]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; riskId: string }> }
) {
  try {
    const { riskId } = await params;
    const risk = await getRiskById(riskId);
    if (!risk) {
      return NextResponse.json({ success: false, error: 'Risk not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: risk });
  } catch (error) {
    console.error('[projects/:id/risks/:riskId][GET]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
