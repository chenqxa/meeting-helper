import { NextRequest, NextResponse } from 'next/server';
import { getRequirementById, updateRequirement, deleteRequirement } from '@/storage';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reqId: string }> }
) {
  try {
    const { reqId } = await params;
    const body = await request.json();
    const updated = await updateRequirement(reqId, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Requirement not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[projects/:id/requirements/:reqId][PATCH]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; reqId: string }> }
) {
  try {
    const { reqId } = await params;
    const ok = await deleteRequirement(reqId);
    if (!ok) {
      return NextResponse.json({ success: false, error: 'Requirement not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[projects/:id/requirements/:reqId][DELETE]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; reqId: string }> }
) {
  try {
    const { reqId } = await params;
    const requirement = await getRequirementById(reqId);
    if (!requirement) {
      return NextResponse.json({ success: false, error: 'Requirement not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: requirement });
  } catch (error) {
    console.error('[projects/:id/requirements/:reqId][GET]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
