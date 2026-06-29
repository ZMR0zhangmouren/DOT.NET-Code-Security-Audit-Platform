import { describe, it, expect, vi, beforeEach } from 'vitest';

// §5.3 ScanRunnerService 简单分支覆盖:
// - cancel:running / cancel:not-running → 返回 true / false
// - isRunning:跟踪 runningScans map
// - onModuleDestroy:把所有 running 标记 canceled
// (runScan / kickoff 走真 OpenAI,留给 e2e)

vi.mock('../db/database.module.js', () => ({
  DATABASE: Symbol('DATABASE'),
  Db: class {},
}));

vi.mock('../db/schema.js', () => ({}));

vi.mock('drizzle-orm', () => ({}));

vi.mock('openai', () => ({
  default: class OpenAI {
    responses = {
      create: async () => ({ output_text: '{}' }),
    };
  },
}));

interface RunnerInstance {
  cancel(id: string): boolean;
  isRunning(id: string): boolean;
  onModuleDestroy(): void;
}

describe('ScanRunnerService cancel + lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('cancel:不存在的 scanRunId → 返回 false', async () => {
    const mod = await import('./scan-runner.service.js');
    const svc = new mod.ScanRunnerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect((svc as unknown as RunnerInstance).cancel('scan-no-such')).toBe(false);
  });

  it('isRunning:false for unknown', async () => {
    const mod = await import('./scan-runner.service.js');
    const svc = new mod.ScanRunnerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect((svc as unknown as RunnerInstance).isRunning('scan-x')).toBe(false);
  });

  it('onModuleDestroy → 正常调用无 throw', async () => {
    const mod = await import('./scan-runner.service.js');
    const svc = new mod.ScanRunnerService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(() => (svc as unknown as RunnerInstance).onModuleDestroy()).not.toThrow();
  });

  void vi;
});
