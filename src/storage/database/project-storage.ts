import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  status: 'planning' | 'active' | 'at_risk' | 'completed' | 'archived';
  phase?: string | null;
  owner?: string | null;
  ownerLoginId?: string | null;
  members?: string[];
  targetDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch (e) {
    console.warn('Failed to parse JSON:', str, e);
    return fallback;
  }
}

function rowToRequirement(row: any): Requirement {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description || null,
    status: (row.status || 'draft') as Requirement['status'],
    priority: (row.priority || 'medium') as Requirement['priority'],
    owner: row.owner || null,
    ownerLoginId: row.owner_login_id || null,
    relatedArtifactId: row.related_artifact_id || null,
    tags: safeJsonParse<string[]>(row.tags, []),
    dueDate: row.due_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRisk(row: any): ProjectRisk {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description || null,
    level: (row.level || 'medium') as ProjectRisk['level'],
    status: (row.status || 'open') as ProjectRisk['status'],
    owner: row.owner || null,
    ownerLoginId: row.owner_login_id || null,
    relatedActionId: row.related_action_id || null,
    detectedBy: row.detected_by || null,
    mitigationPlan: row.mitigation_plan || null,
    dueDate: row.due_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface Artifact {
  id: string;
  projectId?: string | null;
  artifactType: 'meeting' | 'document' | 'research' | 'proposal' | 'email' | 'other';
  title: string;
  content?: string | null;
  sourceRef?: string | null;
  parseStatus: 'pending' | 'processing' | 'done' | 'failed';
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Requirement {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  status: 'draft' | 'in_review' | 'approved' | 'live';
  priority: 'low' | 'medium' | 'high';
  owner?: string | null;
  ownerLoginId?: string | null;
  relatedArtifactId?: string | null;
  tags: string[];
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRisk {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  level: 'low' | 'medium' | 'high';
  status: 'open' | 'mitigated' | 'closed';
  owner?: string | null;
  ownerLoginId?: string | null;
  relatedActionId?: string | null;
  detectedBy?: 'manual' | 'ai' | null;
  mitigationPlan?: string | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

let pool: sql.ConnectionPool | null = null;
let tablesEnsured = false;
let lastConnectFailureAt = 0;
let lastConnectFailureError: Error | null = null;
const CONNECT_RETRY_COOLDOWN_MS = 10000;

async function getPool(): Promise<sql.ConnectionPool> {
  if ((!pool || !pool.connected) && lastConnectFailureError && Date.now() - lastConnectFailureAt < CONNECT_RETRY_COOLDOWN_MS) {
    throw lastConnectFailureError;
  }
  if (!pool || !pool.connected) {
    pool = new sql.ConnectionPool(parseConnectionString());
    try {
      await pool.connect();
      lastConnectFailureError = null;
    } catch (error) {
      lastConnectFailureAt = Date.now();
      lastConnectFailureError = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }
  if (!tablesEnsured) {
    await ensureTables(pool);
    tablesEnsured = true;
  }
  return pool;
}

async function ensureTables(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_projects')
    CREATE TABLE hyzs_projects (
      id             NVARCHAR(64)   NOT NULL PRIMARY KEY,
      name           NVARCHAR(200)  NOT NULL,
      description    NVARCHAR(MAX)  NULL,
      status         NVARCHAR(20)   NOT NULL DEFAULT 'planning',
      phase          NVARCHAR(50)   NULL,
      owner          NVARCHAR(100)  NULL,
      owner_login_id NVARCHAR(64)   NULL,
      members        NVARCHAR(MAX)  NULL,
      target_date    NVARCHAR(64)   NULL,
      created_at     NVARCHAR(64)   NOT NULL,
      updated_at     NVARCHAR(64)   NOT NULL
    )
  `);

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_artifacts')
    CREATE TABLE hyzs_artifacts (
      id            NVARCHAR(64)   NOT NULL PRIMARY KEY,
      project_id    NVARCHAR(64)   NULL,
      artifact_type NVARCHAR(50)   NOT NULL DEFAULT 'other',
      title         NVARCHAR(200)  NOT NULL,
      content       NVARCHAR(MAX)  NULL,
      source_ref    NVARCHAR(200)  NULL,
      parse_status  NVARCHAR(20)   NOT NULL DEFAULT 'pending',
      created_by    NVARCHAR(100)  NULL,
      created_at    NVARCHAR(64)   NOT NULL,
      updated_at    NVARCHAR(64)   NOT NULL
    )
  `);

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('hyzs_meetings') AND name = 'project_id')
    ALTER TABLE hyzs_meetings ADD project_id NVARCHAR(64) NULL
  `);

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_requirements')
    CREATE TABLE hyzs_requirements (
      id                   NVARCHAR(64)  NOT NULL PRIMARY KEY,
      project_id           NVARCHAR(64)  NOT NULL,
      title                NVARCHAR(200) NOT NULL,
      description          NVARCHAR(MAX) NULL,
      status               NVARCHAR(20)  NOT NULL DEFAULT 'draft',
      priority             NVARCHAR(10)  NOT NULL DEFAULT 'medium',
      owner                NVARCHAR(100) NULL,
      owner_login_id       NVARCHAR(64)  NULL,
      related_artifact_id  NVARCHAR(64)  NULL,
      tags                 NVARCHAR(MAX) NULL,
      due_date             NVARCHAR(64)  NULL,
      created_at           NVARCHAR(64)  NOT NULL,
      updated_at           NVARCHAR(64)  NOT NULL
    )
  `);

  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_project_risks')
    CREATE TABLE hyzs_project_risks (
      id                 NVARCHAR(64)  NOT NULL PRIMARY KEY,
      project_id         NVARCHAR(64)  NOT NULL,
      title              NVARCHAR(200) NOT NULL,
      description        NVARCHAR(MAX) NULL,
      level              NVARCHAR(10)  NOT NULL DEFAULT 'medium',
      status             NVARCHAR(20)  NOT NULL DEFAULT 'open',
      owner              NVARCHAR(100) NULL,
      owner_login_id     NVARCHAR(64)  NULL,
      related_action_id  NVARCHAR(64)  NULL,
      detected_by        NVARCHAR(20)  NULL,
      mitigation_plan    NVARCHAR(MAX) NULL,
      due_date           NVARCHAR(64)  NULL,
      created_at         NVARCHAR(64)  NOT NULL,
      updated_at         NVARCHAR(64)  NOT NULL
    )
  `);
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    status: row.status || 'planning',
    phase: row.phase || null,
    owner: row.owner || null,
    ownerLoginId: row.owner_login_id || null,
    members: safeJsonParse<string[]>(row.members, []),
    targetDate: row.target_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToArtifact(row: any): Artifact {
  return {
    id: row.id,
    projectId: row.project_id || null,
    artifactType: row.artifact_type || 'other',
    title: row.title,
    content: row.content || null,
    sourceRef: row.source_ref || null,
    parseStatus: row.parse_status || 'pending',
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Projects ────────────────────────────────────────────────────────────────

export const createProject = async (data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> => {
  const p = await getPool();
  const id = `PRJ_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('name', sql.NVarChar, data.name)
    .input('description', sql.NVarChar, data.description || null)
    .input('status', sql.NVarChar, data.status || 'planning')
    .input('phase', sql.NVarChar, data.phase || null)
    .input('owner', sql.NVarChar, data.owner || null)
    .input('owner_login_id', sql.NVarChar, data.ownerLoginId || null)
    .input('members', sql.NVarChar, JSON.stringify(data.members || []))
    .input('target_date', sql.NVarChar, data.targetDate || null)
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_projects
      (id,name,description,status,phase,owner,owner_login_id,members,target_date,created_at,updated_at)
      VALUES (@id,@name,@description,@status,@phase,@owner,@owner_login_id,@members,@target_date,@created_at,@updated_at)`);

  return { ...data, id, createdAt: now, updatedAt: now };
};

export const getProjects = async (): Promise<Project[]> => {
  const p = await getPool();
  const result = await p.request().query(`SELECT * FROM hyzs_projects ORDER BY created_at DESC`);
  return result.recordset.map(rowToProject);
};

export const getProjectById = async (id: string): Promise<Project | null> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`SELECT * FROM hyzs_projects WHERE id = @id`);
  return result.recordset[0] ? rowToProject(result.recordset[0]) : null;
};

export const updateProject = async (id: string, data: Partial<Project>): Promise<Project | null> => {
  const p = await getPool();
  const existing = await getProjectById(id);
  if (!existing) return null;

  const updated: Project = { ...existing, ...data, updatedAt: new Date().toISOString() };
  await p.request()
    .input('id', sql.NVarChar, id)
    .input('name', sql.NVarChar, updated.name)
    .input('description', sql.NVarChar, updated.description || null)
    .input('status', sql.NVarChar, updated.status)
    .input('phase', sql.NVarChar, updated.phase || null)
    .input('owner', sql.NVarChar, updated.owner || null)
    .input('owner_login_id', sql.NVarChar, updated.ownerLoginId || null)
    .input('members', sql.NVarChar, JSON.stringify(updated.members || []))
    .input('target_date', sql.NVarChar, updated.targetDate || null)
    .input('updated_at', sql.NVarChar, updated.updatedAt)
    .query(`UPDATE hyzs_projects SET
      name=@name, description=@description, status=@status, phase=@phase,
      owner=@owner, owner_login_id=@owner_login_id, members=@members,
      target_date=@target_date, updated_at=@updated_at
      WHERE id=@id`);

  return updated;
};

// ─── Requirements ────────────────────────────────────────────────────────────

export const createRequirement = async (data: Omit<Requirement, 'id' | 'createdAt' | 'updatedAt'>): Promise<Requirement> => {
  const p = await getPool();
  const id = `REQ_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('project_id', sql.NVarChar, data.projectId)
    .input('title', sql.NVarChar, data.title)
    .input('description', sql.NVarChar, data.description || null)
    .input('status', sql.NVarChar, data.status)
    .input('priority', sql.NVarChar, data.priority || 'medium')
    .input('owner', sql.NVarChar, data.owner || null)
    .input('owner_login_id', sql.NVarChar, data.ownerLoginId || null)
    .input('related_artifact_id', sql.NVarChar, data.relatedArtifactId || null)
    .input('tags', sql.NVarChar, JSON.stringify(data.tags || []))
    .input('due_date', sql.NVarChar, data.dueDate || null)
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_requirements
      (id, project_id, title, description, status, priority, owner, owner_login_id, related_artifact_id, tags, due_date, created_at, updated_at)
      VALUES (@id, @project_id, @title, @description, @status, @priority, @owner, @owner_login_id, @related_artifact_id, @tags, @due_date, @created_at, @updated_at)`);

  return { ...data, id, createdAt: now, updatedAt: now };
};

export const getRequirementsByProject = async (projectId: string): Promise<Requirement[]> => {
  const p = await getPool();
  const result = await p.request()
    .input('project_id', sql.NVarChar, projectId)
    .query(`SELECT * FROM hyzs_requirements WHERE project_id = @project_id ORDER BY updated_at DESC`);
  return result.recordset.map(rowToRequirement);
};

export const getRequirements = async (): Promise<Requirement[]> => {
  const p = await getPool();
  const result = await p.request()
    .query(`SELECT * FROM hyzs_requirements ORDER BY updated_at DESC`);
  return result.recordset.map(rowToRequirement);
};

export const getRequirementById = async (id: string): Promise<Requirement | null> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`SELECT * FROM hyzs_requirements WHERE id = @id`);
  return result.recordset[0] ? rowToRequirement(result.recordset[0]) : null;
};

export const updateRequirement = async (id: string, data: Partial<Requirement>): Promise<Requirement | null> => {
  const p = await getPool();
  const existing = await getRequirementById(id);
  if (!existing) return null;

  const updated: Requirement = {
    ...existing,
    ...data,
    tags: data.tags ?? existing.tags,
    updatedAt: new Date().toISOString(),
  };

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('title', sql.NVarChar, updated.title)
    .input('description', sql.NVarChar, updated.description || null)
    .input('status', sql.NVarChar, updated.status)
    .input('priority', sql.NVarChar, updated.priority)
    .input('owner', sql.NVarChar, updated.owner || null)
    .input('owner_login_id', sql.NVarChar, updated.ownerLoginId || null)
    .input('related_artifact_id', sql.NVarChar, updated.relatedArtifactId || null)
    .input('tags', sql.NVarChar, JSON.stringify(updated.tags || []))
    .input('due_date', sql.NVarChar, updated.dueDate || null)
    .input('updated_at', sql.NVarChar, updated.updatedAt)
    .query(`UPDATE hyzs_requirements SET
      title=@title, description=@description, status=@status, priority=@priority,
      owner=@owner, owner_login_id=@owner_login_id, related_artifact_id=@related_artifact_id,
      tags=@tags, due_date=@due_date, updated_at=@updated_at
      WHERE id=@id`);

  return updated;
};

export const deleteRequirement = async (id: string): Promise<boolean> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`DELETE FROM hyzs_requirements WHERE id = @id`);
  return (result.rowsAffected[0] || 0) > 0;
};

// ─── Risks ───────────────────────────────────────────────────────────────────

export const createProjectRisk = async (data: Omit<ProjectRisk, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProjectRisk> => {
  const p = await getPool();
  const id = `RSK_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('project_id', sql.NVarChar, data.projectId)
    .input('title', sql.NVarChar, data.title)
    .input('description', sql.NVarChar, data.description || null)
    .input('level', sql.NVarChar, data.level || 'medium')
    .input('status', sql.NVarChar, data.status || 'open')
    .input('owner', sql.NVarChar, data.owner || null)
    .input('owner_login_id', sql.NVarChar, data.ownerLoginId || null)
    .input('related_action_id', sql.NVarChar, data.relatedActionId || null)
    .input('detected_by', sql.NVarChar, data.detectedBy || null)
    .input('mitigation_plan', sql.NVarChar, data.mitigationPlan || null)
    .input('due_date', sql.NVarChar, data.dueDate || null)
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_project_risks
      (id, project_id, title, description, level, status, owner, owner_login_id, related_action_id, detected_by, mitigation_plan, due_date, created_at, updated_at)
      VALUES (@id, @project_id, @title, @description, @level, @status, @owner, @owner_login_id, @related_action_id, @detected_by, @mitigation_plan, @due_date, @created_at, @updated_at)`);

  return { ...data, id, createdAt: now, updatedAt: now };
};

export const getRisksByProject = async (projectId: string): Promise<ProjectRisk[]> => {
  const p = await getPool();
  const result = await p.request()
    .input('project_id', sql.NVarChar, projectId)
    .query(`SELECT * FROM hyzs_project_risks WHERE project_id = @project_id ORDER BY updated_at DESC`);
  return result.recordset.map(rowToRisk);
};

export const getRisks = async (): Promise<ProjectRisk[]> => {
  const p = await getPool();
  const result = await p.request()
    .query(`SELECT * FROM hyzs_project_risks ORDER BY updated_at DESC`);
  return result.recordset.map(rowToRisk);
};

export const getRiskById = async (id: string): Promise<ProjectRisk | null> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`SELECT * FROM hyzs_project_risks WHERE id = @id`);
  return result.recordset[0] ? rowToRisk(result.recordset[0]) : null;
};

export const updateProjectRisk = async (id: string, data: Partial<ProjectRisk>): Promise<ProjectRisk | null> => {
  const p = await getPool();
  const existing = await getRiskById(id);
  if (!existing) return null;

  const updated: ProjectRisk = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('title', sql.NVarChar, updated.title)
    .input('description', sql.NVarChar, updated.description || null)
    .input('level', sql.NVarChar, updated.level)
    .input('status', sql.NVarChar, updated.status)
    .input('owner', sql.NVarChar, updated.owner || null)
    .input('owner_login_id', sql.NVarChar, updated.ownerLoginId || null)
    .input('related_action_id', sql.NVarChar, updated.relatedActionId || null)
    .input('detected_by', sql.NVarChar, updated.detectedBy || null)
    .input('mitigation_plan', sql.NVarChar, updated.mitigationPlan || null)
    .input('due_date', sql.NVarChar, updated.dueDate || null)
    .input('updated_at', sql.NVarChar, updated.updatedAt)
    .query(`UPDATE hyzs_project_risks SET
      title=@title, description=@description, level=@level, status=@status,
      owner=@owner, owner_login_id=@owner_login_id, related_action_id=@related_action_id,
      detected_by=@detected_by, mitigation_plan=@mitigation_plan, due_date=@due_date,
      updated_at=@updated_at
      WHERE id=@id`);

  return updated;
};

export const deleteProjectRisk = async (id: string): Promise<boolean> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`DELETE FROM hyzs_project_risks WHERE id = @id`);
  return (result.rowsAffected[0] || 0) > 0;
};

export const deleteProject = async (id: string): Promise<boolean> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`DELETE FROM hyzs_projects WHERE id = @id`);
  return (result.rowsAffected[0] || 0) > 0;
};

// ─── Artifacts ───────────────────────────────────────────────────────────────

export const createArtifact = async (data: Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Artifact> => {
  const p = await getPool();
  const id = `ART_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = new Date().toISOString();

  await p.request()
    .input('id', sql.NVarChar, id)
    .input('project_id', sql.NVarChar, data.projectId || null)
    .input('artifact_type', sql.NVarChar, data.artifactType || 'other')
    .input('title', sql.NVarChar, data.title)
    .input('content', sql.NVarChar, data.content || null)
    .input('source_ref', sql.NVarChar, data.sourceRef || null)
    .input('parse_status', sql.NVarChar, data.parseStatus || 'pending')
    .input('created_by', sql.NVarChar, data.createdBy || null)
    .input('created_at', sql.NVarChar, now)
    .input('updated_at', sql.NVarChar, now)
    .query(`INSERT INTO hyzs_artifacts
      (id,project_id,artifact_type,title,content,source_ref,parse_status,created_by,created_at,updated_at)
      VALUES (@id,@project_id,@artifact_type,@title,@content,@source_ref,@parse_status,@created_by,@created_at,@updated_at)`);

  return { ...data, id, createdAt: now, updatedAt: now };
};

export const getArtifactsByProject = async (projectId: string): Promise<Artifact[]> => {
  const p = await getPool();
  const result = await p.request()
    .input('project_id', sql.NVarChar, projectId)
    .query(`SELECT * FROM hyzs_artifacts WHERE project_id = @project_id ORDER BY created_at DESC`);
  return result.recordset.map(rowToArtifact);
};

export const getArtifacts = async (): Promise<Artifact[]> => {
  const p = await getPool();
  const result = await p.request()
    .query(`SELECT * FROM hyzs_artifacts ORDER BY created_at DESC`);
  return result.recordset.map(rowToArtifact);
};

export const getArtifactById = async (id: string): Promise<Artifact | null> => {
  const p = await getPool();
  const result = await p.request()
    .input('id', sql.NVarChar, id)
    .query(`SELECT * FROM hyzs_artifacts WHERE id = @id`);
  return result.recordset[0] ? rowToArtifact(result.recordset[0]) : null;
};

export const updateArtifact = async (id: string, data: Partial<Artifact>): Promise<Artifact | null> => {
  const p = await getPool();
  const existing = await getArtifactById(id);
  if (!existing) return null;

  const updated: Artifact = { ...existing, ...data, updatedAt: new Date().toISOString() };
  await p.request()
    .input('id', sql.NVarChar, id)
    .input('project_id', sql.NVarChar, updated.projectId || null)
    .input('title', sql.NVarChar, updated.title)
    .input('content', sql.NVarChar, updated.content || null)
    .input('parse_status', sql.NVarChar, updated.parseStatus)
    .input('updated_at', sql.NVarChar, updated.updatedAt)
    .query(`UPDATE hyzs_artifacts SET
      project_id=@project_id, title=@title, content=@content,
      parse_status=@parse_status, updated_at=@updated_at
      WHERE id=@id`);

  return updated;
};
