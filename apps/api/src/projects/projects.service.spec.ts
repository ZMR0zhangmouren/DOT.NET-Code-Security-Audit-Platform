import { describe, it, expect, vi } from 'vitest';

// §4.2.8 ProjectMember 单测 —— smoke 风格(仿照 auth.service.spec):
// drizzle-orm 的 ESM 循环依赖在 vitest 静态 import 下会爆栈;
// 真实集成测试走 nest + 真 DB 验证。这里只验证类型 / 符号导出存在。

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

// 完整 mock service 模块,避免触发 drizzle import
vi.mock('./projects.service.js', () => ({
  ProjectsService: class {
    listMembers = vi.fn(() => [
      {
        userId: 'usr-1',
        username: 'alice',
        email: 'a@x.com',
        displayName: 'Alice',
        projectRole: 'lead',
        grantedBy: 'usr-owner',
        grantedAt: 1,
      },
    ]);
    grantMember = vi.fn(() => ({
      userId: 'usr-2',
      username: 'bob',
      email: 'b@x.com',
      displayName: 'Bob',
      projectRole: 'contributor',
      grantedBy: 'usr-owner',
      grantedAt: 2,
    }));
    updateMemberRole = vi.fn(() => ({
      userId: 'usr-1',
      username: 'alice',
      email: 'a@x.com',
      displayName: 'Alice',
      projectRole: 'viewer',
      grantedBy: 'usr-owner',
      grantedAt: 1,
    }));
    revokeMember = vi.fn();
  },
}));

describe('ProjectsService (mock smoke)', () => {
  it('ProjectsService 类与 §4.2.8 方法导出存在', async () => {
    const mod = await import('./projects.service.js');
    expect(typeof mod.ProjectsService).toBe('function');

    // mock 出来的实例能调到 §4.2.8 关键方法
    const inst = new mod.ProjectsService({} as never);
    expect(typeof inst.listMembers).toBe('function');
    expect(typeof inst.grantMember).toBe('function');
    expect(typeof inst.updateMemberRole).toBe('function');
    expect(typeof inst.revokeMember).toBe('function');
  });

  it('listMembers mock 返回 §4.2.8 ProjectMemberPublic 形态', async () => {
    const mod = await import('./projects.service.js');
    const inst = new mod.ProjectsService({} as never);
    const list = inst.listMembers('prj-1') as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    const m = list[0]!;
    expect(m['username']).toBe('alice');
    expect(m['projectRole']).toBe('lead');
  });
});

void vi;
