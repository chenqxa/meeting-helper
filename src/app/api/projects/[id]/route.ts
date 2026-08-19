import { NextRequest, NextResponse } from 'next/server';
import {
  getProjectById,
  updateProject,
  deleteProject,
  getMeetings,
  getArtifactsByProject,
  getRequirementsByProject,
  getRisksByProject,
} from '@/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await getProjectById(id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const [meetingsResult, artifactsResult, requirementsResult, risksResult] = await Promise.allSettled([
      getMeetings(),
      getArtifactsByProject(id),
      getRequirementsByProject(id),
      getRisksByProject(id),
    ]);

    const meetings = meetingsResult.status === 'fulfilled' ? (meetingsResult.value || []) : [];
    const artifacts = artifactsResult.status === 'fulfilled' ? (artifactsResult.value || []) : [];
    const requirements = requirementsResult.status === 'fulfilled' ? (requirementsResult.value || []) : [];
    const risks = risksResult.status === 'fulfilled' ? (risksResult.value || []) : [];

    const projectMeetings = Array.isArray(meetings) 
      ? meetings.filter((m: any) => m && (m.project_id === id || m.projectId === id))
      : [];

    const actionItems = projectMeetings.flatMap((m: any) =>
      Array.isArray(m.actionItems) 
        ? m.actionItems.map((item: any) => ({
            ...item,
            meeting_id: m.id,
            meeting_title: m.title,
          }))
        : []
    );

    const stats = {
      meetingCount: projectMeetings.length,
      artifactCount: artifacts.length,
      requirementCount: requirements.length,
      requirementLive: requirements.filter((r: any) => r && r.status === 'live').length,
      actionTotal: actionItems.length,
      actionDone: actionItems.filter((a: any) => a && a.status === 'done').length,
      actionBlocked: actionItems.filter((a: any) => a && a.status === 'blocked').length,
      riskOpen: risks.filter((r: any) => r && r.status === 'open').length,
    };

    return NextResponse.json({
      success: true,
      data: {
        project,
        meetings: projectMeetings,
        artifacts,
        requirements,
        risks,
        actionItems,
        stats,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateProject(id, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteProject(id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
