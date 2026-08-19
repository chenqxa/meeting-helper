// ── 通用 AI 客户端（支持多 Provider 切换）──
// 通过 .env 中 AI_PROVIDER 切换：siliconflow / tencent / qwen
//
// 硅基流动:  SILICONFLOW_API_KEY, SILICONFLOW_BASE_URL, SILICONFLOW_MODEL
// 腾讯混元:  TENCENT_API_KEY, TENCENT_BASE_URL, TENCENT_MODEL
// 阿里千问:  QWEN_API_KEY, QWEN_BASE_URL, QWEN_MODEL

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxOutputTokens: number; // 该 provider 允许的最大输出 token 数
}

// ── Provider 配置表 ──
function resolveProvider(override?: string): ProviderConfig {
  const provider = (override || process.env.AI_PROVIDER || 'siliconflow').toLowerCase().trim();

  switch (provider) {
    case 'tencent':
    case 'hunyuan':
      return {
        name: 'Tencent Hunyuan',
        apiKey: process.env.TENCENT_API_KEY || '',
        baseUrl: process.env.TENCENT_BASE_URL || 'https://api.hunyuan.cloud.tencent.com/v1',
        model: process.env.TENCENT_MODEL || 'hunyuan-pro',
        maxOutputTokens: 8192,
      };
    case 'qwen':
    case 'dashscope':
      return {
        name: '阿里千问',
        apiKey: process.env.QWEN_API_KEY || '',
        baseUrl: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: process.env.QWEN_MODEL || 'qwen-max',
        maxOutputTokens: 8192,
      };
    case 'deepseek':
    case 'deepseek-v4':
      return {
        name: 'DeepSeek官方',
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        maxOutputTokens: 65536,
      };
    case 'deepseek-v4-pro':
      return {
        name: 'DeepSeek官方(Pro)',
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro',
        maxOutputTokens: 65536,
      };
    case 'siliconflow':
    default:
      return {
        name: 'SiliconFlow',
        apiKey: process.env.SILICONFLOW_API_KEY || '',
        baseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
        model: process.env.SILICONFLOW_MODEL || 'Pro/deepseek-ai/DeepSeek-V3',
        maxOutputTokens: 32768,
      };
  }
}

// ── 鲁棒 JSON 解析（处理 markdown 包裹、中文标点、截断等问题）──
function robustParseJson<T>(raw: string): T {
  // 0. 移除思考模型的 <think>...</think> 标签（hunyuan-t1, DeepSeek-R1 等）
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // 1. 移除 markdown 代码块标记
  cleaned = cleaned.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g, '$1').trim();

  // 2. 提取最外层 JSON 结构：谁在外面用谁（[ 先于 { 说明外层是数组）
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');

  const hasObj = objStart !== -1 && objEnd > objStart;
  const hasArr = arrStart !== -1 && arrEnd > arrStart;

  if (hasArr && (!hasObj || arrStart < objStart)) {
    // 外层是数组
    cleaned = cleaned.substring(arrStart, arrEnd + 1);
  } else if (hasObj) {
    // 外层是对象
    cleaned = cleaned.substring(objStart, objEnd + 1);
  }

  // 3. 尝试直接解析
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // 4. 修复中文标点（仅在 JSON key/value 分隔处替换，不动 value 内容）
  let fixed = cleaned
    .replace(/(?<=[\}\]"0-9])\s*，\s*(?=[\{\[""])/g, ',')   // 中文逗号 → 英文逗号（仅在值之间）
    .replace(/(?<=")\s*：\s*(?=[\{\["0-9tfn])/g, ':');        // 中文冒号 → 英文冒号（仅在 key: value 处）
  try { return JSON.parse(fixed); } catch { /* continue */ }

  // 5. 截断修复：尝试补全未闭合的括号
  let truncated = fixed;
  const opens = (truncated.match(/[\[{]/g) || []).length;
  const closes = (truncated.match(/[\]}]/g) || []).length;
  if (opens > closes) {
    // 移除最后一个不完整的元素（可能截断在中间）
    truncated = truncated.replace(/,\s*[^,\]\}]*$/, '');
    for (let i = 0; i < opens - closes; i++) {
      // 检查最后一个未闭合的是 [ 还是 {
      const lastOpen = Math.max(truncated.lastIndexOf('{'), truncated.lastIndexOf('['));
      truncated += (truncated[lastOpen] === '{') ? '}' : ']';
    }
    try { return JSON.parse(truncated); } catch { /* continue */ }
  }

  console.error('[robustParseJson] All attempts failed');
  console.error('[robustParseJson] Raw response (first 2000 chars):\n', raw.substring(0, 2000));
  console.error('[robustParseJson] Cleaned after markdown removal:\n', cleaned.substring(0, 1000));
  throw new Error('Failed to parse JSON response');
}

export class SiliconFlowClient {
  private provider: ProviderConfig;

  constructor(providerOverride?: string) {
    this.provider = resolveProvider(providerOverride);

    if (!this.provider.apiKey) {
      throw new Error(`[AI] ${this.provider.name} API Key 未配置`);
    }

    console.log(`[AI] Provider: ${this.provider.name} | Model: ${this.provider.model} | URL: ${this.provider.baseUrl}`);
  }

  get providerName() { return this.provider.name; }
  get modelName() { return this.provider.model; }

  private async makeRequest(messages: ChatMessage[], temperature = 0.3, maxTokens = 4096): Promise<string> {
    try {
      console.log(`[AI] ${this.provider.name} request:`, {
        model: this.provider.model,
        messages: messages.length,
      });

      const requestBody: any = {
        model: this.provider.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600_000); // 10min，思考模型需要更长时间

      const response = await fetch(`${this.provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      console.log(`[AI] ${this.provider.name} response: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AI] Error:', errorText);
        throw new Error(`AI API failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data: ChatCompletionResponse = await response.json();
      const content = data.choices[0]?.message?.content || '';

      if (data.usage) {
        console.log(`[AI] Tokens: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out`);
      }

      return content;
    } catch (error) {
      console.error(`[AI] ${this.provider.name} error:`, error);
      throw error;
    }
  }

  async generateText(prompt: string, systemPrompt?: string, temperature = 0.3, maxTokens = 4096): Promise<string> {
    const messages: ChatMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const raw = await this.makeRequest(messages, temperature, Math.min(maxTokens, this.provider.maxOutputTokens));
    // 移除思考模型的 <think>...</think> 标签
    return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  async generateJson<T>(prompt: string, systemPrompt?: string, temperature = 0.3, maxTokens = 4096): Promise<T> {
    maxTokens = Math.min(maxTokens, this.provider.maxOutputTokens);
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const content = await this.generateText(prompt, systemPrompt, temperature, maxTokens);
        return robustParseJson<T>(content);
      } catch (error) {
        lastError = error as Error;
        console.error(`[generateJson] Attempt ${attempt}/${maxRetries} failed:`, (error as Error).message);
        if (attempt < maxRetries) {
          console.log('[generateJson] Retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 指数退避
        }
      }
    }

    throw lastError || new Error('Failed to generate JSON after retries');
  }
}

// Singleton instance（懒加载，首次调用时才实例化，避免 build 阶段因 API Key 未配置报错）
let _client: SiliconFlowClient | null = null;
export function getSiliconFlowClient(): SiliconFlowClient {
  if (!_client) _client = new SiliconFlowClient();
  return _client;
}
/** @deprecated 使用 getSiliconFlowClient() 代替，避免 build 阶段报错 */
export const siliconFlowClient: SiliconFlowClient = new Proxy({} as SiliconFlowClient, {
  get(_target, prop) {
    return (getSiliconFlowClient() as any)[prop];
  },
});

// 按名称获取特定 provider 的客户端（用于混合模式）
export function createClient(provider: string): SiliconFlowClient {
  return new SiliconFlowClient(provider);
}
