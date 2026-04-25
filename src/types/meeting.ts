// 会议类型枚举
export enum MeetingType {
  WEEKLY = 'weekly',           // 周会
  PROJECT_REVIEW = 'project_review',  // 项目评审
  BUSINESS_REVIEW = 'business_review', // 经营复盘
}

// 会议模板定义
export interface MeetingTemplate {
  id: string;
  name: string;
  type: MeetingType;
  description: string;
  summarySections: string[];   // 摘要包含的章节
  customFields?: string[];     // 自定义字段
  metadata?: Record<string, unknown>;
}

// 会议记录
export interface MeetingRecord {
  id: string;
  title: string;
  type: MeetingType;
  date: string;
  participants: string[];
  organizer: string;
  status: 'draft' | 'review' | 'locked' | 'exported';
  createdAt: string;
  updatedAt: string;
  version: number;
}

// 输入类型
export enum InputType {
  TEXT = 'text',           // 文本输入
  RECORDING = 'recording', // 录音文件
  UPLOAD = 'upload',       // 文件上传
}

// 输入内容
export interface MeetingInput {
  type: InputType;
  content?: string;        // 文本内容
  fileUrl?: string;        // 文件URL
  fileName?: string;       // 文件名
}

// 摘要内容
export interface MeetingSummary {
  topics: string[];        // 议题
  keyDecisions: string[];  // 关键决策
  risks: string[];         // 风险提醒
  nextSteps: string[];     // 下一步建议
  rawText?: string;        // 原始文本片段
}

// 置信度
export type Confidence = 'high' | 'medium' | 'low';

// 行动项
export interface ActionItem {
  id: string;
  description: string;
  assignee?: string;
  dueDate?: string;
  priority: 'high' | 'medium' | 'low';
  confidence: Confidence;
  sourceText?: string;      // 原文依据
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

// 纪要草稿
export interface MeetingDraft {
  meetingId: string;
  summary: MeetingSummary;
  actionItems: ActionItem[];
  rawTranscript: string;    // 原始转写文本
  processingLog: string[];  // 处理日志
}

// 导出记录
export interface ExportRecord {
  id: string;
  meetingId: string;
  version: number;
  format: 'word' | 'pdf';
  exportedBy: string;
  exportedAt: string;
  fileUrl?: string;
}

// 操作日志
export interface AuditLog {
  id: string;
  meetingId: string;
  action: string;
  actor: string;
  timestamp: string;
  details?: string;
}

// 响应类型
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 分页参数
export interface PaginationParams {
  page: number;
  pageSize: number;
}

// 分页响应
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
