import { describe, it, expect, vi } from 'vitest';

import type { ProjectsController } from './projects.controller.js';

// §5.1 ProjectsController 端点覆盖:
// list / get / create / update / remove / listMembers / grantMember / updateMember / revokeMember

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));
vi.mock('../db/schema.js', () => ({}));
vi.mock('drizzle-orm', () => ({}));

async function makeController(): Promise<{
  controller: ProjectsController;
  projects: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    listMembers: ReturnType<typeof vi.fn>;
    grantMember: ReturnType<typeof vi.fn>;
    updateMemberRole: ReturnType<typeof vi.fn>;
    revokeMember: ReturnType<typeof vi.fn>;
  };
}> {
  const mod = await import('./projects.controller.js');
  const projects = {
    list: vi.fn(() => [{ id: 'p1' }]),
    get: vi.fn(() => ({ id: 'p1' })),
    create: vi.fn(() => ({ id: 'p-new' })),
    update: vi.fn(() => ({ id: 'p1' })),
    remove: vi.fn(),
    listMembers: vi.fn(() => [{ userId: 'u1' }]),
    grantMember: vi.fn(() => ({ userId: 'u1', projectRole: 'lead' })),
    updateMemberRole: vi.fn(() => ({ userId: 'u1', projectRole: 'contributor' })),
    revokeMember: vi.fn(),
  };
  const controller = new mod.ProjectsController(projects as never);
  return { controller, projects };
}

describe('ProjectsController (§5.1 / §4.2.8)', () => {
  it('list → 调 projects.list({ q, status })', async () => {
    const { controller, projects } = await makeController();
    expect(controller.list('audit', 'active')).toEqual([{ id: 'p1' }]);
    expect(projects.list).toHaveBeenCalledWith({ q: 'audit', status: 'active' });
  });

  it('list → 不带参数', async () => {
    const { controller, projects } = await makeController();
    controller.list();
    expect(projects.list).toHaveBeenCalledWith({ q: undefined, status: undefined });
  });

  it('get → 调 projects.get(id)', async () => {
    const { controller, projects } = await makeController();
    expect(controller.get('p1')).toEqual({ id: 'p1' });
    expect(projects.get).toHaveBeenCalledWith('p1');
  });

  it('create → ownerId 取 user.sub', async () => {
    const { controller, projects } = await makeController();
    controller.create({ sub: 'usr-1' } as never, {
      name: 'New',
      description: 'd',
      visibility: 'public',
    });
    expect(projects.create).toHaveBeenCalledWith({
      name: 'New',
      description: 'd',
      ownerId: 'usr-1',
      visibility: 'public',
    });
  });

  it('create → 无 user → ownerId = "unknown"', async () => {
    const { controller, projects } = await makeController();
    controller.create(undefined as never, { name: 'New' });
    expect(projects.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'unknown' }));
  });

  it('update → 调 projects.update(id, body)', async () => {
    const { controller, projects } = await makeController();
    controller.update('p1', { name: 'B', status: 'archived' });
    expect(projects.update).toHaveBeenCalledWith('p1', { name: 'B', status: 'archived' });
  });

  it('remove → 调 projects.remove(id)', async () => {
    const { controller, projects } = await makeController();
    const out = controller.remove('p1');
    expect(out).toEqual({ ok: true });
    expect(projects.remove).toHaveBeenCalledWith('p1');
  });

  it('listMembers → 调 projects.listMembers(id)', async () => {
    const { controller, projects } = await makeController();
    expect(controller.listMembers('p1')).toEqual([{ userId: 'u1' }]);
    expect(projects.listMembers).toHaveBeenCalledWith('p1');
  });

  it('grantMember → grantedBy 取 user.sub', async () => {
    const { controller, projects } = await makeController();
    controller.grantMember('p1', { sub: 'usr-1' } as never, {
      username: 'alice',
      projectRole: 'lead',
    });
    expect(projects.grantMember).toHaveBeenCalledWith('p1', 'alice', 'lead', 'usr-1');
  });

  it('updateMember → actingUserId 取 user.sub', async () => {
    const { controller, projects } = await makeController();
    controller.updateMember('p1', 'u2', { sub: 'usr-1' } as never, {
      projectRole: 'contributor',
    });
    expect(projects.updateMemberRole).toHaveBeenCalledWith('p1', 'u2', 'contributor', 'usr-1');
  });

  it('revokeMember → actingUserId 取 user.sub', async () => {
    const { controller, projects } = await makeController();
    controller.revokeMember('p1', 'u2', { sub: 'usr-1' } as never);
    expect(projects.revokeMember).toHaveBeenCalledWith('p1', 'u2', 'usr-1');
  });
});
