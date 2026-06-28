import { describe, it, expect, vi } from 'vitest';

// Mock 整个 drizzle-orm/better-sqlite3 模块以绕过 ESM 循环依赖
// (drizzle-orm/sqlite-core 内部存在 ESM 循环,vitest 直接 import 会爆栈;
// 测试 HealthController 不需要真 DB,只需 mock 一个 fakeDb)
vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),

  Db: class {} as any,
}));

// Mock scan-queue 以避开 ESM 循环(ScanQueueService → ScanRunnerService → drizzle/storage)
// BullMQ 升级后 getQueueDepth / getRunningCount 返回 Promise。
vi.mock('../scan/scan-queue.service.js', () => ({
  ScanQueueService: class {
    getQueueDepth = async () => 0;
    getRunningCount = async () => 0;
    getMaxConcurrent = () => 2;
  },
}));

describe('HealthController (mocked DB)', () => {
  it('check() 返回 ok 状态与 db 表数', async () => {
    const mod = await import('./health.controller.js');
    const fakeDb = {
      all: () => [{ name: 'projects' }, { name: 'users' }, { name: 'scan_runs' }],
    };
    const fakeQueue = {
      getQueueDepth: async () => 5,
      getRunningCount: async () => 2,
      getMaxConcurrent: () => 2,
    };
    const controller = new mod.HealthController(fakeDb as never, fakeQueue as never);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.dbTables).toBe(3);
    expect(result.coverageModeDefault).toBe('FULL');
    expect(result.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    expect(result.queueDepth).toBe(5);
    expect(result.queueRunning).toBe(2);
    expect(result.queueMaxConcurrent).toBe(2);
  });
});
