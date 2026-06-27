import OpenAI from 'openai';

/**
 * 通用 OpenAI-compatible 客户端工厂 —— 用于测活
 *
 * §5.7 系统配置:点 "Test Connection" 时调 /v1/models 验证 key + base_url。
 * 用 openai 包的 OpenAI 实例,baseURL 可指向任意 OpenAI 兼容端点(MiniMax / DeepSeek / 自建 LLM)。
 */
export function createOpenAIClient(apiKey: string, baseURL: string): OpenAI {
  return new OpenAI({ apiKey, baseURL, timeout: 30_000 });
}

export async function listModelsVia(apiKey: string, baseURL: string): Promise<string[]> {
  const client = createOpenAIClient(apiKey, baseURL);
  const list = await client.models.list();
  return list.data.map((m) => m.id);
}
