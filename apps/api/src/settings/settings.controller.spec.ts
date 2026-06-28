import { describe, it, expect, vi } from 'vitest';

import type { SettingsController } from './settings.controller.js';

// §5.7 SettingsController (AI Key CRUD):
// list / get / create / update / remove / testConnection / listModels

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: SettingsController;
  settings: {
    listAiKeys: ReturnType<typeof vi.fn>;
    getAiKey: ReturnType<typeof vi.fn>;
    getAiKeyPlaintext: ReturnType<typeof vi.fn>;
    createAiKey: ReturnType<typeof vi.fn>;
    updateAiKey: ReturnType<typeof vi.fn>;
    deleteAiKey: ReturnType<typeof vi.fn>;
    recordTestResult: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./settings.controller.js');
  const settings = {
    listAiKeys: vi.fn(() => [{ id: 'aik-1' }]),
    getAiKey: vi.fn(() => ({ id: 'aik-1' })),
    getAiKeyPlaintext: vi.fn(() => 'plaintext-key'),
    createAiKey: vi.fn(() => ({ id: 'aik-new' })),
    updateAiKey: vi.fn(() => ({ id: 'aik-1' })),
    deleteAiKey: vi.fn(),
    recordTestResult: vi.fn(),
  };
  const controller = new mod.SettingsController(settings as never);
  return { controller, settings };
}

describe('SettingsController (§5.7 AI Key)', () => {
  it('list → 调 settings.listAiKeys()', async () => {
    const { controller, settings } = await makeController();
    expect(controller.list()).toEqual([{ id: 'aik-1' }]);
    expect(settings.listAiKeys).toHaveBeenCalledTimes(1);
  });

  it('get → 调 settings.getAiKey(id)', async () => {
    const { controller, settings } = await makeController();
    expect(controller.get('aik-1')).toEqual({ id: 'aik-1' });
    expect(settings.getAiKey).toHaveBeenCalledWith('aik-1');
  });

  it('create → createdBy 取 user.sub + availableModels 默认 []', async () => {
    const { controller, settings } = await makeController();
    controller.create({ sub: 'usr-1' } as never, {
      provider: 'openai',
      label: 'L',
      baseUrl: 'https://x',
      apiKey: 'sk-1',
      defaultModel: 'gpt-4o',
      availableModels: ['gpt-4o'],
    });
    expect(settings.createAiKey).toHaveBeenCalledWith({
      provider: 'openai',
      label: 'L',
      baseUrl: 'https://x',
      apiKey: 'sk-1',
      defaultModel: 'gpt-4o',
      availableModels: ['gpt-4o'],
      createdBy: 'usr-1',
    });
  });

  it('create → availableModels 缺省 → []', async () => {
    const { controller, settings } = await makeController();
    controller.create({ sub: 'u' } as never, {
      provider: 'openai',
      label: 'L',
      baseUrl: 'https://x',
      apiKey: 'sk-1',
      defaultModel: 'g',
      availableModels: undefined as never,
    });
    expect(settings.createAiKey).toHaveBeenCalledWith(
      expect.objectContaining({ availableModels: [] }),
    );
  });

  it('update → 调 settings.updateAiKey(id, body)', async () => {
    const { controller, settings } = await makeController();
    controller.update('aik-1', { label: 'New' });
    expect(settings.updateAiKey).toHaveBeenCalledWith('aik-1', { label: 'New' });
  });

  it('remove → 调 settings.deleteAiKey(id) + 返回 ok', async () => {
    const { controller, settings } = await makeController();
    expect(controller.remove('aik-1')).toEqual({ ok: true });
    expect(settings.deleteAiKey).toHaveBeenCalledWith('aik-1');
  });

  it('testConnection → success 路径', async () => {
    const { controller, settings } = await makeController();
    vi.mock('./openai-test.client.js', () => ({
      listModelsVia: async () => ['gpt-4o', 'gpt-4o-mini'],
    }));
    const out = await controller.testConnection('aik-1');
    expect(out.ok).toBe(true);
    expect(out.message).toContain('2 models');
    expect(settings.recordTestResult).toHaveBeenCalledWith(
      'aik-1',
      'success',
      '2 models available',
    );
  });

  it('testConnection → 异常路径', async () => {
    const { controller, settings } = await makeController();
    vi.doMock('./openai-test.client.js', () => ({
      listModelsVia: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    }));
    const out = await controller.testConnection('aik-1');
    expect(out.ok).toBe(false);
    expect(out.message).toContain('ECONNREFUSED');
    expect(settings.recordTestResult).toHaveBeenCalledWith(
      'aik-1',
      'failed',
      'connect ECONNREFUSED',
    );
    vi.doUnmock('./openai-test.client.js');
  });

  it('listModels → success 路径', async () => {
    vi.resetModules();
    // mock 后必须重新 import controller 才能拿到新 mock
    vi.doMock('./openai-test.client.js', () => ({
      listModelsVia: async () => ['m1', 'm2'],
    }));
    const mod = await import('./settings.controller.js');
    const settings2 = {
      listAiKeys: vi.fn(() => []),
      getAiKey: vi.fn(() => ({ id: 'aik-1', baseUrl: 'https://x' })),
      getAiKeyPlaintext: vi.fn(() => 'plain'),
      createAiKey: vi.fn(),
      updateAiKey: vi.fn(),
      deleteAiKey: vi.fn(),
      recordTestResult: vi.fn(),
    };
    const c2 = new mod.SettingsController(settings2 as never);
    const out = await c2.listModels('aik-1');
    expect(out.ok).toBe(true);
    expect(out.models).toEqual(['m1', 'm2']);
    vi.doUnmock('./openai-test.client.js');
  });
});
