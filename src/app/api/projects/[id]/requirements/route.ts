import { NextRequest, NextResponse } from 'next/server';
import {
  getRequirementsByProject,
  createRequirement,
} from '@/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const requirements = await getRequirementsByProject(id);
    return NextResponse.json({ success: true, data: requirements });
  } catch (error) {
    console.error('[projects/:id/requirements][GET]', error);
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

    const requirement = await createRequirement({
      projectId: id,
      title: body.title.trim(),
      description: body.description ?? null,
      status: body.status ?? 'draft',
      priority: body.priority ?? 'medium',
      owner: body.owner ?? null,
      ownerLoginId: body.ownerLoginId ?? null,
      relatedArtifactId: body.relatedArtifactId ?? null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      dueDate: body.dueDate ?? null,
    });

    return NextResponse.json({ success: true, data: requirement });
  } catch (error) {
    console.error('[projects/:id/requirements][POST]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
