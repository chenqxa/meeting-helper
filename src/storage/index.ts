// 根据 DATABASE_URL 自动选择存储后端
// 有 DATABASE_URL → SQL Server；否则 → 文件/内存
import type { Meeting } from './database/memory-storage';

type StorageBackend = {
  createMeeting: (data: Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Meeting>;
  getMeetings: () => Promise<Meeting[]>;
  getMeetingById: (id: string) => Promise<Meeting | null>;
  updateMeeting: (id: string, data: Partial<Meeting>) => Promise<Meeting | null>;
  deleteMeeting: (id: string) => Promise<boolean>;
};

let _backend: StorageBackend | null = null;

function isStorageConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const code = (error as any)?.code;
  return code === 'ETIMEOUT' || code === 'ESOCKET' || /Failed to connect|ConnectionError|connect timeout/i.test(message);
}

async function getBackend(): Promise<StorageBackend> {
  if (_backend) return _backend;
  if (process.env.DATABASE_URL) {
    console.log('[Storage] 使用 SQL Server 存储');
    _backend = await import('./database/sqlserver-storage');
  } else {
    console.log('[Storage] 使用文件/内存存储');
    _backend = await import('./database/memory-storage');
  }
  return _backend;
}

export const createMeeting = async (data: Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'>) =>
  (async () => {
    try {
      return await (await getBackend()).createMeeting(data);
    } catch (error) {
      if (process.env.DATABASE_URL && isStorageConnectionError(error)) {
        console.warn('[Storage] SQL 不可用，createMeeting 回退到内存存储:', error instanceof Error ? error.message : error);
        const memory = await import('./database/memory-storage');
        return memory.createMeeting(data);
      }
      throw error;
    }
  })();

export const getMeetings = async () =>
  (async () => {
    try {
      return await (await getBackend()).getMeetings();
    } catch (error) {
      if (process.env.DATABASE_URL && isStorageConnectionError(error)) {
        console.warn('[Storage] SQL 不可用，getMeetings 回退到内存存储:', error instanceof Error ? error.message : error);
        const memory = await import('./database/memory-storage');
        return memory.getMeetings();
      }
      throw error;
    }
  })();

export const getMeetingById = async (id: string) =>
  (async () => {
    try {
      return await (await getBackend()).getMeetingById(id);
    } catch (error) {
      if (process.env.DATABASE_URL && isStorageConnectionError(error)) {
        console.warn('[Storage] SQL 不可用，getMeetingById 回退到内存存储:', error instanceof Error ? error.message : error);
        const memory = await import('./database/memory-storage');
        return memory.getMeetingById(id);
      }
      throw error;
    }
  })();

export const updateMeeting = async (id: string, data: Partial<Meeting>) =>
  (async () => {
    try {
      return await (await getBackend()).updateMeeting(id, data);
    } catch (error) {
      if (process.env.DATABASE_URL && isStorageConnectionError(error)) {
        console.warn('[Storage] SQL 不可用，updateMeeting 回退到内存存储:', error instanceof Error ? error.message : error);
        const memory = await import('./database/memory-storage');
        return memory.updateMeeting(id, data);
      }
      throw error;
    }
  })();

export const deleteMeeting = async (id: string) =>
  (async () => {
    try {
      return await (await getBackend()).deleteMeeting(id);
    } catch (error) {
      if (process.env.DATABASE_URL && isStorageConnectionError(error)) {
        console.warn('[Storage] SQL 不可用，deleteMeeting 回退到内存存储:', error instanceof Error ? error.message : error);
        const memory = await import('./database/memory-storage');
        return memory.deleteMeeting(id);
      }
      throw error;
    }
  })();

export type { Meeting } from './database/memory-storage';

export {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  createArtifact,
  getArtifacts,
  getArtifactsByProject,
  getArtifactById,
  updateArtifact,
  createRequirement,
  getRequirements,
  getRequirementsByProject,
  getRequirementById,
  updateRequirement,
  deleteRequirement,
  createProjectRisk,
  getRisks,
  getRisksByProject,
  getRiskById,
  updateProjectRisk,
  deleteProjectRisk,
} from './database/project-storage';
export type { Project, Artifact, Requirement, ProjectRisk } from './database/project-storage';

export {
  getAllActionItems,
  getActionItemById,
  getActionItemByMeetingAndOriginalId,
  getActionItemsByOwner,
  createActionItem,
  updateActionItem,
  deleteActionItem,
  deleteActionItemsByMeetingId,
} from './database/action-storage';
export type { ActionItem as ActionItemRecord } from './database/action-storage';

export {
  createTaskBatch,
  getTaskBatchById,
  getAllTaskBatches,
  updateTaskBatch,
  deleteTaskBatch,
} from './database/batch-storage';
export type { TaskBatch } from './database/batch-storage';
