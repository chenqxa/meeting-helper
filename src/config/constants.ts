import { MeetingTemplate, MeetingType } from '@/types/meeting';

// 会议模板配置
export const MEETING_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'weekly',
    name: '周会',
    type: MeetingType.WEEKLY,
    description: '定期团队/部门周会，关注进度、问题与计划',
    summarySections: [
      '上周完成情况',
      '本周工作计划',
      '遇到的问题与风险',
      '资源需求',
      '关键决策',
    ],
  },
  {
    id: 'project_review',
    name: '项目评审',
    type: MeetingType.PROJECT_REVIEW,
    description: '项目节点评审，关注质量、进度与风险',
    summarySections: [
      '项目背景与目标',
      '当前进展回顾',
      '关键成果展示',
      '风险与问题',
      '评审结论',
      '下一步行动计划',
    ],
  },
  {
    id: 'business_review',
    name: '经营复盘',
    type: MeetingType.BUSINESS_REVIEW,
    description: '经营数据分析与复盘会议，关注业绩与改进',
    summarySections: [
      '核心数据回顾',
      '亮点与不足',
      '问题根因分析',
      '改进措施',
      '目标调整建议',
    ],
  },
];

// 优先级配置
export const PRIORITY_CONFIG = {
  high: {
    label: '高',
    color: 'red',
    description: '紧急重要，需立即处理',
  },
  medium: {
    label: '中',
    color: 'yellow',
    description: '重要，需按计划完成',
  },
  low: {
    label: '低',
    color: 'gray',
    description: '普通，可灵活安排',
  },
} as const;

// 置信度配置
export const CONFIDENCE_CONFIG = {
  high: {
    label: '高',
    color: 'green',
    description: '识别准确，无需确认',
  },
  medium: {
    label: '中',
    color: 'yellow',
    description: '基本准确，建议确认',
  },
  low: {
    label: '低',
    color: 'red',
    description: '不确定性高，必须确认',
  },
} as const;

// 文件类型限制
export const FILE_UPLOAD_LIMITS = {
  maxSize: 50 * 1024 * 1024, // 50MB
  allowedTextTypes: ['.docx', '.txt', '.md'],
  allowedAudioTypes: ['.mp3', '.wav', '.m4a', '.aac'],
} as const;

// 处理状态
export const PROCESSING_STATUS = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  TRANSCRIBING: 'transcribing',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
