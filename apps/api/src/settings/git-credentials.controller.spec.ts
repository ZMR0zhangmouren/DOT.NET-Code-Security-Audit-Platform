import { describe, it, expect, vi } from 'vitest';

import type { GitCredentialsController } from './git-credentials.controller.js';

// §5.7 GitCredentialsController 端点覆盖:
// list / get / create / update / remove

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: GitCredentialsController;
  git: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./git-credentials.controller.js');
  const git = {
    list: vi.fn(() => [{ id: 'gc-1' }]),
    get: vi.fn(() => ({ id: 'gc-1' })),
    create: vi.fn(() => ({ id: 'gc-new' })),
    update: vi.fn(() => ({ id: 'gc-1' })),
    revoke: vi.fn(),
  };
  const controller = new mod.GitCredentialsController(git as never);
  return { controller, git };
}

describe('GitCredentialsController (§5.7)', () => {
  it('list(scope, projectId) → git.list(scope, projectId)', async () => {
    const { controller, git } = await makeController();
    expect(controller.list('project', 'p1')).toEqual([{ id: 'gc-1' }]);
    expect(git.list).toHaveBeenCalledWith('project', 'p1');
  });

  it('list 不带参数 → git.list(undefined, undefined)', async () => {
    const { controller, git } = await makeController();
    controller.list();
    expect(git.list).toHaveBeenCalledWith(undefined, undefined);
  });

  it('get → git.get(id)', async () => {
    const { controller, git } = await makeController();
    expect(controller.get('gc-1')).toEqual({ id: 'gc-1' });
    expect(git.get).toHaveBeenCalledWith('gc-1');
  });

  it('create → createdBy 取 user.sub', async () => {
    const { controller, git } = await makeController();
    controller.create({ sub: 'usr-1' } as never, {
      scope: 'system',
      label: 'L',
      kind: 'ssh_key',
      hostPattern: 'github.com',
      secret: 'k',
    });
    expect(git.create).toHaveBeenCalledWith({
      scope: 'system',
      projectId: undefined,
      label: 'L',
      kind: 'ssh_key',
      hostPattern: 'github.com',
      username: undefined,
      secret: 'k',
      isActive: undefined,
      createdBy: 'usr-1',
    });
  });

  it('update → git.update(id, body)', async () => {
    const { controller, git } = await makeController();
    controller.update('gc-1', { label: 'New' });
    expect(git.update).toHaveBeenCalledWith('gc-1', { label: 'New' });
  });

  it('remove → git.revoke(id)', async () => {
    const { controller, git } = await makeController();
    expect(controller.remove('gc-1')).toEqual({ ok: true });
    expect(git.revoke).toHaveBeenCalledWith('gc-1');
  });
});
