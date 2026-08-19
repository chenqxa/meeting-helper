/**
 * 通用输入验证schemas
 * 使用Zod进行类型安全的输入验证
 */
import { z } from 'zod';

// ==========================================
// 基础验证规则
// ==========================================

export const idSchema = z.string().min(1).max(64);
export const nameSchema = z.string().min(1).max(100);
export const descriptionSchema = z.string().max(5000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const datetimeSchema = z.string().datetime();

// ==========================================
// 会议相关
// ==========================================

export const createMeetingSchema = z.object({
  title: z.string()
    .min(1, '标题不能为空')
    .max(500, '标题不能超过500字')
    .refine(s => !/[<>\"'`]/.test(s), '标题包含非法字符'),
  type: z.enum(['weekly', 'monthly', 'project', 'general', 'review', 'retrospective']),
  meetingDate: datetimeSchema,
  participants: z.array(nameSchema).optional(),
  organizer: nameSchema.optional(),
  department: nameSchema.optional(),
  content: z.string().max(100000).optional(),
  projectId: idSchema.optional(),
});

export const updateMeetingSchema = createMeetingSchema.partial();

// ==========================================
// 行动项相关
// ==========================================

export const createActionItemSchema = z.object({
  description: z.string().min(1, '描述不能为空').max(1000),
  owner: nameSchema.optional(),
  ownerLoginId: z.string().max(64).optional(),
  ownerOaId: z.string().max(64).optional(),
  dept: nameSchema.optional(),
  dueDate: dateSchema.optional(),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  status: z.enum(['candidate', 'pending', 'confirmed', 'in_progress', 'done', 'blocked', 'cancelled']).default('pending'),
  projectId: idSchema.optional(),
  meetingId: idSchema.optional(),
});

export const updateActionItemSchema = createActionItemSchema.partial();

// ==========================================
// 用户认证相关
// ==========================================

export const loginSchema = z.object({
  loginid: z.string()
    .min(1, '请输入OA登录账号')
    .max(64, '登录账号过长')
    .regex(/^[a-zA-Z0-9_-]+$/, '登录账号只能包含字母、数字、下划线和连字符'),
});

// ==========================================
// 文件上传相关
// ==========================================

export const fileTypeSchema = z.enum(['recording', 'upload', 'image']);

// ==========================================
// 项目相关
// ==========================================

export const createProjectSchema = z.object({
  name: z.string().min(1, '项目名称不能为空').max(200),
  description: descriptionSchema.optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'archived']).default('planning'),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  owner: nameSchema.optional(),
  members: z.array(nameSchema).optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

// ==========================================
// 验证辅助函数
// ==========================================

/**
 * 验证并解析输入数据
 * @param schema Zod schema
 * @param data 待验证数据
 * @returns 解析后的数据或错误信息
 */
export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string; details?: any } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // 格式化错误信息
  const errors = result.error.flatten();
  const fieldErrorValues = Object.values(errors.fieldErrors);
  const firstError = (fieldErrorValues[0] as string[] | undefined)?.[0] || '输入数据格式不正确';

  return {
    success: false,
    error: firstError,
    details: errors,
  };
}

/**
 * 清理XSS危险字符
 */
export function sanitizeString(str: string): string {
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
