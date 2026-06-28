import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * §11 Q6 ScanQueueService 单元测试
 *
 * 策略:
 *   - ScanQueueService 构造时只接 ScanRunnerService 这一个 dep;
 *     通过传一个轻量 inline stub runner,绕开 ESM 循环依赖与真 DB。
 *   - stub runner 的 kickoff 返回 Promise;测试通过 deferred 控制 resolve 时机。
 *
 * 关注:enqueue 行为 / FIFO 调度 / 并发上限 / 越界 env / 幂等性 / 失败不卡队列
 */

import {
  SCAN_MAX_CONCURRENT_DEFAULT,
  SCAN_MAX_CONCURRENT_MAX,
  SCAN_MAX_CONCURRENT_MIN,
  ScanQueueService,
} from './scan-queue.service.js';

interface Deferred {
  resolve: () => void;
  reject: (e: unknown) => void;
}

interface StubRunner {
  kickoff: (id: string) => Promise<void>;
}

function makeMockRunner(): StubRunner {
  return {
    kickoff: (id: string) => {
      const d = deferreds.get(id);
      if (!d) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        d.resolve = resolve;
        d.reject = reject;
      });
    },
  };
}

const deferreds: Map<string, Deferred> = new Map();

function makeDeferred(id: string): Deferred {
  const d: Deferred = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  deferreds.set(id, d);
  return d;
}

function clearDeferreds(): void {
  // 把残留的 pending 全部 resolve,避免 finally 链报错
  for (const [, d] of deferreds) {
    try {
      d.resolve();
    } catch {
      /* ignore */
    }
  }
  deferreds.clear();
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('§11 Q6 ScanQueueService', () => {
  beforeEach(() => {
    clearDeferreds();
    delete process.env['SCAN_MAX_CONCURRENT'];
  });

  afterEach(() => {
    clearDeferreds();
    delete process.env['SCAN_MAX_CONCURRENT'];
  });

  it('常量边界 = [1, 10],默认 2', () => {
    expect(SCAN_MAX_CONCURRENT_MIN).toBe(1);
    expect(SCAN_MAX_CONCURRENT_MAX).toBe(10);
    expect(SCAN_MAX_CONCURRENT_DEFAULT).toBe(2);
  });

  it('默认 maxConcurrent=2(没设 SCAN_MAX_CONCURRENT)', () => {
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    expect(q.getMaxConcurrent()).toBe(2);
  });

  it('SCAN_MAX_CONCURRENT 合法值生效', () => {
    process.env['SCAN_MAX_CONCURRENT'] = '4';
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    expect(q.getMaxConcurrent()).toBe(4);
  });

  it('SCAN_MAX_CONCURRENT 越界(>10)抛错', () => {
    process.env['SCAN_MAX_CONCURRENT'] = '11';
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    expect(() => q.onModuleInit()).toThrow(/SCAN_MAX_CONCURRENT/);
  });

  it('SCAN_MAX_CONCURRENT 越界(<1)抛错', () => {
    process.env['SCAN_MAX_CONCURRENT'] = '0';
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    expect(() => q.onModuleInit()).toThrow(/SCAN_MAX_CONCURRENT/);
  });

  it('SCAN_MAX_CONCURRENT 非整数抛错', () => {
    process.env['SCAN_MAX_CONCURRENT'] = 'abc';
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    expect(() => q.onModuleInit()).toThrow(/SCAN_MAX_CONCURRENT/);
  });

  it('enqueue 第一个 scan 立即启动,position=0,running=1', () => {
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    makeDeferred('s1');
    const r = q.enqueue('s1');
    expect(r.position).toBe(0);
    expect(r.running).toBe(1);
    expect(r.maxConcurrent).toBe(2);
    expect(q.getQueueDepth()).toBe(0);
    expect(q.getRunningCount()).toBe(1);
  });

  it('maxConcurrent=2 时,第 3 个 scan 入队等待,depth=1', () => {
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    makeDeferred('s1');
    makeDeferred('s2');
    makeDeferred('s3');
    q.enqueue('s1');
    q.enqueue('s2');
    const r = q.enqueue('s3');
    expect(r.position).toBe(1);
    expect(q.getQueueDepth()).toBe(1);
    expect(q.getRunningCount()).toBe(2);
  });

  it('worker resolve 后 pending 头部被取走,新 worker 启动', async () => {
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    const d1 = makeDeferred('s1');
    const d2 = makeDeferred('s2');
    makeDeferred('s3');
    q.enqueue('s1');
    q.enqueue('s2');
    q.enqueue('s3');
    expect(q.getRunningCount()).toBe(2);
    expect(q.getQueueDepth()).toBe(1);

    d1.resolve();
    await flushMicrotasks();
    expect(q.getRunningCount()).toBe(2);
    expect(q.getQueueDepth()).toBe(0);

    d2.resolve();
    await flushMicrotasks();
    expect(q.getRunningCount()).toBe(1);
    expect(q.getQueueDepth()).toBe(0);
  });

  it('重复 enqueue 同一个 id 是幂等的(已在 running)', () => {
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    makeDeferred('s1');
    q.enqueue('s1');
    const r = q.enqueue('s1');
    expect(r.position).toBe(0);
    expect(q.getRunningCount()).toBe(1);
    expect(q.getQueueDepth()).toBe(0);
  });

  it('重复 enqueue 同一个 id(在 pending)返回当前位置', () => {
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    makeDeferred('s1');
    makeDeferred('s2');
    makeDeferred('s3');
    q.enqueue('s1');
    q.enqueue('s2');
    q.enqueue('s3');
    expect(q.getQueueDepth()).toBe(1);
    const r = q.enqueue('s3');
    expect(r.position).toBe(1);
    expect(q.getQueueDepth()).toBe(1);
  });

  it('worker reject 后仍然 dispatchNext(失败不卡队列)', async () => {
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    const d1 = makeDeferred('s1');
    makeDeferred('s2');
    makeDeferred('s3');
    q.enqueue('s1');
    q.enqueue('s2');
    q.enqueue('s3');
    expect(q.getRunningCount()).toBe(2);

    d1.reject(new Error('boom'));
    await flushMicrotasks();
    expect(q.getRunningCount()).toBe(2);
    expect(q.getQueueDepth()).toBe(0);
  });

  it('maxConcurrent=1 严格串行', async () => {
    process.env['SCAN_MAX_CONCURRENT'] = '1';
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    const d1 = makeDeferred('s1');
    makeDeferred('s2');
    makeDeferred('s3');
    q.enqueue('s1');
    q.enqueue('s2');
    q.enqueue('s3');
    expect(q.getRunningCount()).toBe(1);
    expect(q.getQueueDepth()).toBe(2);

    d1.resolve();
    await flushMicrotasks();
    expect(q.getRunningCount()).toBe(1);
    expect(q.getQueueDepth()).toBe(1);
  });

  it('onModuleDestroy 后不再接受 enqueue', () => {
    const runner = makeMockRunner();
    const q = new ScanQueueService(runner);
    q.onModuleInit();
    q.onModuleDestroy();
    expect(() => q.enqueue('s1')).toThrow(/shutting down/);
  });
});
