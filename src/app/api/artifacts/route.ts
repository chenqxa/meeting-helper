import { NextRequest, NextResponse } from 'next/server';
import { createArtifact, getArtifactsByProject } from '@/storage';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('project_id');
    if (!projectId) {
      return NextResponse.json({ success: false, error: 'project_id is required' }, { status: 400 });
    }
    const artifacts = await getArtifactsByProject(projectId);
    return NextResponse.json({ success: true, data: artifacts });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.title) {
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 });
    }
    const artifact = await createArtifact({
      projectId: body.projectId || null,
      artifactType: body.artifactType || 'other',
      title: body.title,
      content: body.content || null,
      sourceRef: body.sourceRef || null,
      parseStatus: 'pending',
      createdBy: body.createdBy || null,
    });
    return NextResponse.json({ success: true, data: artifact });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
