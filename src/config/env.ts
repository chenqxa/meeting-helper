/**
 * 环境变量验证和配置管理
 * 统一管理所有环境变量，提供类型安全的访问
 */

interface EnvConfig {
  // 数据库配置
  databaseUrl: string;
  oaLinkedServer: string;
  oaDatabaseName: string;

  // 会话安全
  sessionSecret: string;
  internalSyncSecret?: string;

  // 泛微OA配置
  weaverOaUrl?: string;
  weaverOaAppid?: string;
  weaverOaSpk?: string;
  weaverOaSecret?: string;

  // CORS配置
  allowedOrigins: string[];

  // 文件上传
  uploadDir: string;

  // AI服务
  aiProvider?: string;
  aiApiKey?: string;

  // 其他
  nodeEnv: string;
}

/**
 * 验证必需的环境变量
 */
function validateRequiredEnv(): void {
  const required = ['SESSION_SECRET', 'DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // 验证SESSION_SECRET强度
  const sessionSecret = process.env.SESSION_SECRET!;
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters long for security');
  }
}

/**
 * 加载并验证环境变量配置
 */
export function loadEnvConfig(): EnvConfig {
  // 仅在服务器端验证
  if (typeof window === 'undefined') {
    validateRequiredEnv();
  }

  return {
    // 数据库
    databaseUrl: process.env.DATABASE_URL || '',
    oaLinkedServer: process.env.OA_LINKED_SERVER || 'FWsv',
    oaDatabaseName: process.env.OA_DATABASE_NAME || 'ecology',

    // 安全
    sessionSecret: process.env.SESSION_SECRET || '',
    internalSyncSecret: process.env.INTERNAL_SYNC_SECRET,

    // OA
    weaverOaUrl: process.env.WEAVER_OA_URL,
    weaverOaAppid: process.env.WEAVER_OA_APPID,
    weaverOaSpk: process.env.WEAVER_OA_SPK,
    weaverOaSecret: process.env.WEAVER_OA_SECRET,

    // CORS
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),

    // 上传
    uploadDir: process.env.UPLOAD_DIR || '.uploads',

    // AI
    aiProvider: process.env.AI_PROVIDER,
    aiApiKey: process.env.AI_API_KEY,

    // 环境
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}

/**
 * 获取配置（带缓存）
 */
let cachedConfig: EnvConfig | null = null;
export function getEnvConfig(): EnvConfig {
  if (!cachedConfig) {
    cachedConfig = loadEnvConfig();
  }
  return cachedConfig;
}

/**
 * 泛微OA API路径常量
 */
export const WEAVER_API_PATHS = {
  REGISTER: '/api/ec/dev/auth/regist',
  APPLY_TOKEN: '/api/ec/dev/auth/applytoken',
  GET_USER_INFO: '/api/hrm/resful/getHrmUserInfoByLoginId',
  GET_DEPT_INFO: '/api/hrm/resful/getDepartmentInfoByDepartmentId',
} as const;

/**
 * HTTP超时配置（毫秒）
 */
export const HTTP_TIMEOUTS = {
  OA_REQUEST: parseInt(process.env.OA_HTTP_TIMEOUT_MS || '1500', 10),
  LLM_REQUEST: parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || '30000', 10),
  DEFAULT: 5000,
} as const;

/**
 * 文件上传限制
 */
export const UPLOAD_LIMITS = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MIN_FILE_SIZE: 10, // 10 bytes
} as const;
