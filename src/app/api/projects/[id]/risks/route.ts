import { NextRequest, NextResponse } from 'next/server';
import { getRisksByProject, createProjectRisk } from '@/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const risks = await getRisksByProject(id);
    return NextResponse.json({ success: true, data: risks });
  } catch (error) {
    console.error('[projects/:id/risks][GET]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 });
    }

    const risk = await createProjectRisk({
      projectId: id,
      title: body.title.trim(),
      description: body.description ?? null,
      level: body.level ?? 'medium',
      status: body.status ?? 'open',
      owner: body.owner ?? null,
      ownerLoginId: body.ownerLoginId ?? null,
      relatedActionId: body.relatedActionId ?? null,
      detectedBy: body.detectedBy ?? 'manual',
      mitigationPlan: body.mitigationPlan ?? null,
      dueDate: body.dueDate ?? null,
    });

    return NextResponse.json({ success: true, data: risk });
  } catch (error) {
    console.error('[projects/:id/risks][POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
