// Silicon Flow API Client
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

export class SiliconFlowClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.SILICONFLOW_API_KEY || '';
    this.baseUrl = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1';
    this.model = process.env.SILICONFLOW_MODEL || 'qwen-plus';
    
    if (!this.apiKey) {
      throw new Error('SILICONFLOW_API_KEY is not configured');
    }
  }

  private async makeRequest(messages: ChatMessage[], temperature = 0.3, maxTokens = 4096): Promise<string> {
    try {
      console.log('SiliconFlow API Request:', {
        url: `${this.baseUrl}/chat/completions`,
        model: this.model,
        messageCount: messages.length,
        hasApiKey: !!this.apiKey
      });

      const requestBody = {
        model: this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      };

      console.log('Request body preview:', JSON.stringify(requestBody, null, 2).substring(0, 500) + '...');

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log('SiliconFlow API Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error Response:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data: ChatCompletionResponse = await response.json();
      console.log('API Response received, choices count:', data.choices?.length || 0);
      
      return data.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('SiliconFlow API error:', error);
      throw error;
    }
  }

  async generateText(prompt: string, systemPrompt?: string, temperature = 0.3): Promise<string> {
    const messages: ChatMessage[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    return await this.makeRequest(messages, temperature);
  }

  async generateJson<T>(prompt: string, systemPrompt?: string, temperature = 0.3): Promise<T> {
    const content = await this.generateText(prompt, systemPrompt, temperature);

    // 去掉 markdown 代码块包裹 (```json ... ``` 或 ``` ... ```)
    let cleaned = content.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g, '$1').trim();

    // 尝试直接解析
    try { return JSON.parse(cleaned); } catch { /* continue */ }

    // 尝试提取最外层 JSON 对象（用贪婪匹配最大的 {} ）
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch (e) {
        console.error('[generateJson] object parse error:', (e as Error).message);
      }
    }

    // 尝试提取 JSON 数组
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]); } catch (e) {
        console.error('[generateJson] array parse error:', (e as Error).message);
      }
    }

    console.error('[generateJson] Failed to parse, raw content:\n', content.substring(0, 800));
    throw new Error('Failed to parse JSON response');
  }
}

// Singleton instance
export const siliconFlowClient = new SiliconFlowClient();
