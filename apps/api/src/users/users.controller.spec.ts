import { describe, it, expect, vi } from 'vitest';

import type { UsersController } from './users.controller.js';

// §4.2.7 / §5.7 UsersController 端点覆盖:
// list / get / create / update / resetPassword
// Controller 是 wiring,核心逻辑已被 users.service.spec.ts 覆盖;
// 这里用 mock service 验证 controller 的 user 取值、传参。

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: UsersController;
  svc: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updatePassword: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./users.controller.js');
  const svc = {
    list: vi.fn(() => [{ id: 'u1' }]),
    get: vi.fn(() => ({ id: 'u1' })),
    create: vi.fn(async () => ({ id: 'u-new' })),
    update: vi.fn(() => ({ id: 'u1' })),
    updatePassword: vi.fn(async () => undefined),
  };
  const controller = new mod.UsersController(svc as never);
  return { controller, svc };
}

describe('UsersController', () => {
  it('list → 调 svc.list', async () => {
    const { controller, svc } = await makeController();
    expect(controller.list()).toEqual([{ id: 'u1' }]);
    expect(svc.list).toHaveBeenCalledTimes(1);
  });

  it('get → 调 svc.get(id)', async () => {
    const { controller, svc } = await makeController();
    expect(controller.get('u1')).toEqual({ id: 'u1' });
    expect(svc.get).toHaveBeenCalledWith('u1');
  });

  it('create → 调 svc.create(body)', async () => {
    const { controller, svc } = await makeController();
    const body = {
      username: 'alice',
      email: 'a@x.com',
      password: 'NewPass1',
      displayName: 'Alice',
      role: 'auditor' as const,
    };
    const out = await controller.create(body);
    expect(out).toEqual({ id: 'u-new' });
    expect(svc.create).toHaveBeenCalledWith(body);
  });

  it('update → 调 svc.update(id, body)', async () => {
    const { controller, svc } = await makeController();
    const out = controller.update('u1', { role: 'admin' });
    expect(out).toEqual({ id: 'u1' });
    expect(svc.update).toHaveBeenCalledWith('u1', { role: 'admin' });
  });

  it('resetPassword → 调 svc.updatePassword(id, password)', async () => {
    const { controller, svc } = await makeController();
    const out = await controller.resetPassword('u1', { password: 'NewPass1' });
    expect(out).toEqual({ ok: true });
    expect(svc.updatePassword).toHaveBeenCalledWith('u1', 'NewPass1');
  });
});
