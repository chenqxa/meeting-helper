import { NextRequest, NextResponse } from 'next/server';
import {
  createProject,
  getProjects,
  getMeetings,
  getArtifacts,
  getRequirements,
  getRisks,
  getAllActionItems,
} from '@/storage';

export async function GET() {
  try {
    const [projectsResult, meetingsResult, artifactsResult, requirementsResult, risksResult, actionsResult] = await Promise.allSettled([
      getProjects(),
      getMeetings(),
      getArtifacts(),
      getRequirements(),
      getRisks(),
      getAllActionItems(),
    ]);

    const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : [];
    const meetings = meetingsResult.status === 'fulfilled' ? meetingsResult.value : [];
    const artifacts = artifactsResult.status === 'fulfilled' ? artifactsResult.value : [];
    const requirements = requirementsResult.status === 'fulfilled' ? requirementsResult.value : [];
    const risks = risksResult.status === 'fulfilled' ? risksResult.value : [];
    const actions = actionsResult.status === 'fulfilled' ? actionsResult.value : [];

    const data = projects.map(project => {
      const projectId = project.id;
      const projectMeetings = meetings.filter((meeting: any) => meeting && (meeting.project_id === projectId || meeting.projectId === projectId));
      const projectArtifacts = artifacts.filter((artifact: any) => artifact && artifact.projectId === projectId);
      const projectRequirements = requirements.filter((requirement: any) => requirement && requirement.projectId === projectId);
      const projectRisks = risks.filter((risk: any) => risk && risk.projectId === projectId);
      const projectActions = actions.filter((action: any) => action && action.projectId === projectId);

      return {
        ...project,
        stats: {
          meetingCount: projectMeetings.length,
          artifactCount: projectArtifacts.length,
          requirementCount: projectRequirements.length,
          requirementLive: projectRequirements.filter((item: any) => item?.status === 'live').length,
          actionTotal: projectActions.length,
          actionDone: projectActions.filter((item: any) => item?.status === 'done').length,
          actionBlocked: projectActions.filter((item: any) => item?.status === 'blocked').length,
          riskOpen: projectRisks.filter((item: any) => item?.status === 'open').length,
        },
      };
    });

    return NextResponse.json({ success: true, data });
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
    if (!body.name) {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }
    const project = await createProject({
      name: body.name,
      description: body.description || null,
      status: body.status || 'planning',
      phase: body.phase || null,
      owner: body.owner || null,
      ownerLoginId: body.ownerLoginId || null,
      members: body.members || [],
      targetDate: body.targetDate || null,
    });
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
