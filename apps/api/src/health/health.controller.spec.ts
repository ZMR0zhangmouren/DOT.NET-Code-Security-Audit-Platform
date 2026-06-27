import { describe, it, expect, vi } from 'vitest';

// Mock 整个 drizzle-orm/better-sqlite3 模块以绕过 ESM 循环依赖
// (drizzle-orm/sqlite-core 内部存在 ESM 循环,vitest 直接 import 会爆栈;
// 测试 HealthController 不需要真 DB,只需 mock 一个 fakeDb)
vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),

  Db: class {} as any,
}));

describe('HealthController (mocked DB)', () => {
  it('check() 返回 ok 状态与 db 表数', async () => {
    const mod = await import('./health.controller.js');
    const fakeDb = {
      all: () => [{ name: 'projects' }, { name: 'users' }, { name: 'scan_runs' }],
    };
    const controller = new mod.HealthController(fakeDb as never);
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.dbTables).toBe(3);
    expect(result.coverageModeDefault).toBe('FULL');
    expect(result.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
  });
});
