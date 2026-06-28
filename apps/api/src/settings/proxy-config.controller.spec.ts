import { describe, it, expect, vi } from 'vitest';

import type { ProxyConfigController } from './proxy-config.controller.js';

// §5.7 ProxyConfigController 端点覆盖:
// get / upsert / test

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: ProxyConfigController;
  proxy: {
    getCurrent: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    testConnection: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./proxy-config.controller.js');
  const proxy = {
    getCurrent: vi.fn(() => ({ protocol: 'http' })),
    upsert: vi.fn(() => ({ protocol: 'http', port: 7890 })),
    testConnection: vi.fn(async () => ({ ok: true, message: 'connected', latencyMs: 5 })),
  };
  const controller = new mod.ProxyConfigController(proxy as never);
  return { controller, proxy };
}

describe('ProxyConfigController (§5.7)', () => {
  it('get → proxy.getCurrent()', async () => {
    const { controller, proxy } = await makeController();
    expect(controller.get()).toEqual({ protocol: 'http' });
    expect(proxy.getCurrent).toHaveBeenCalledTimes(1);
  });

  it('upsert → updatedBy 取 user.sub', async () => {
    const { controller, proxy } = await makeController();
    controller.upsert({ sub: 'usr-1' } as never, {
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: 'u',
      password: 'p',
      applyTo: 'all_outbound',
      isActive: true,
    });
    expect(proxy.upsert).toHaveBeenCalledWith({
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: 'u',
      password: 'p',
      applyTo: 'all_outbound',
      isActive: true,
      updatedBy: 'usr-1',
    });
  });

  it('upsert 无 user → updatedBy = "unknown"', async () => {
    const { controller, proxy } = await makeController();
    controller.upsert(undefined as never, {
      protocol: null,
      host: null,
      port: null,
      applyTo: 'all_outbound',
      isActive: true,
    });
    expect(proxy.upsert).toHaveBeenCalledWith(expect.objectContaining({ updatedBy: 'unknown' }));
  });

  it('test → proxy.testConnection()', async () => {
    const { controller, proxy } = await makeController();
    const out = await controller.test();
    expect(out).toEqual({ ok: true, message: 'connected', latencyMs: 5 });
    expect(proxy.testConnection).toHaveBeenCalledTimes(1);
  });
});
