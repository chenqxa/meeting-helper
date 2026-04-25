//  temporary in-memory storage for demo purposes
//  uses globalThis to survive Next.js dev-mode HMR re-imports
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface Meeting {
  id: string;
  title: string;
  content?: string;
  type: string;
  meetingDate: string;
  participants: string[];
  organizer: string;
  createdAt: string;
  updatedAt: string;
  status?: 'draft' | 'locked' | 'archived' | 'review';
  summary?: any;
  actionItems?: any[];
}

// File-based persistence
const DATA_FILE = join(process.cwd(), 'meetings-data.json');

// globalThis singleton to survive HMR
const GLOBAL_KEY = '__meeting_storage__';

interface StorageState {
  meetings: Meeting[];
  nextId: number;
}

function getState(): StorageState {
  if (!(globalThis as any)[GLOBAL_KEY]) {
    (globalThis as any)[GLOBAL_KEY] = { meetings: [], nextId: 1 };
    loadFromFile();
  }
  return (globalThis as any)[GLOBAL_KEY];
}

// Load data from file
function loadFromFile() {
  try {
    if (existsSync(DATA_FILE)) {
      const data = readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      const state = getState();
      state.meetings = parsed.meetings || [];
      state.nextId = parsed.nextId || 1;
    }
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

// Save data to file
function saveToFile() {
  try {
    const state = getState();
    writeFileSync(DATA_FILE, JSON.stringify({ meetings: state.meetings, nextId: state.nextId }, null, 2));
  } catch (error) {
    console.error('Failed to save data:', error);
  }
}

// Force re-read from file to get latest state (handles multi-instance issues)
function freshRead(): StorageState {
  try {
    if (existsSync(DATA_FILE)) {
      const data = readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      const state = getState();
      state.meetings = parsed.meetings || [];
      state.nextId = parsed.nextId || 1;
    }
  } catch { /* use in-memory fallback */ }
  return getState();
}

export const createMeeting = async (data: Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'>): Promise<Meeting> => {
  const state = freshRead();
  const meeting: Meeting = {
    ...data,
    id: state.nextId.toString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.meetings.push(meeting);
  state.nextId++;
  saveToFile();
  return meeting;
};

export const getMeetings = async (): Promise<Meeting[]> => {
  const state = freshRead();
  return state.meetings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const getMeetingById = async (id: string): Promise<Meeting | null> => {
  const state = freshRead();
  return state.meetings.find(m => m.id === id) || null;
};

export const updateMeeting = async (id: string, data: Partial<Meeting>): Promise<Meeting | null> => {
  const state = freshRead();
  const index = state.meetings.findIndex(m => m.id === id);
  if (index === -1) return null;
  
  state.meetings[index] = {
    ...state.meetings[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  saveToFile();
  return state.meetings[index];
};

export const deleteMeeting = async (id: string): Promise<boolean> => {
  const state = freshRead();
  const index = state.meetings.findIndex(m => m.id === id);
  if (index === -1) return false;
  
  state.meetings.splice(index, 1);
  saveToFile();
  return true;
};
