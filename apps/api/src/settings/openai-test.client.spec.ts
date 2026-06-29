import { describe, it, expect, vi, beforeEach } from 'vitest';

// §5.7 OpenAI 测活客户端单测 —— mock openai 包,验证 createOpenAIClient / listModelsVia 链路

const modelsListMock = vi.fn();

vi.mock('openai', () => {
  const OpenAI = vi.fn(function (this: unknown, _opts: unknown) {
    return {
      models: { list: modelsListMock },
    };
  });
  return { default: OpenAI };
});

describe('openai-test.client (§5.7)', () => {
  beforeEach(() => {
    modelsListMock.mockReset();
  });

  it('createOpenAIClient 透传 apiKey / baseURL / timeout', async () => {
    const OpenAIMock = (await import('openai')).default as unknown as ReturnType<typeof vi.fn>;
    const { createOpenAIClient } = await import('./openai-test.client.js');
    OpenAIMock.mockClear();
    createOpenAIClient('sk-abc', 'https://example.com/v1');
    expect(OpenAIMock).toHaveBeenCalledWith({
      apiKey: 'sk-abc',
      baseURL: 'https://example.com/v1',
      timeout: 30_000,
    });
  });

  it('listModelsVia 返回 models.list().data[].id 列表', async () => {
    modelsListMock.mockResolvedValue({ data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] });
    const { listModelsVia } = await import('./openai-test.client.js');
    const r = await listModelsVia('sk-abc', 'https://example.com/v1');
    expect(r).toEqual(['gpt-x', 'gpt-y']);
  });

  it('listModelsVia 空响应 → 返回 []', async () => {
    modelsListMock.mockResolvedValue({ data: [] });
    const { listModelsVia } = await import('./openai-test.client.js');
    const r = await listModelsVia('sk-abc', 'https://example.com/v1');
    expect(r).toEqual([]);
  });
});
