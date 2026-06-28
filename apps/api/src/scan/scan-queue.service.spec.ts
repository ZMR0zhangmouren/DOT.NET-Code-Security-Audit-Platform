import type { JobsOptions, Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * §11 Q6 ScanQueueService 单元测试(BullMQ 升级版)
 *
 * 策略:
 *   - 不连真 Redis。用一个 in-memory fake Queue 替代 BullMQ Queue,
 *     只实现 ScanQueueService 用到的最小 API 表面:`add` / `getJob` / `getJobs`
 *     / `getActiveCount` / `getWaitingCount` / `getDelayedCount` / `getWaiting` / `close`。
 *   - job 状态机由 fake 维护:'waiting' / 'active' / 'delayed' / 'completed' / 'failed'。
 *   - 测试关注:SCAN_MAX_CONCURRENT 边界 / 幂等 / position 算对 / error pass-through。
 *
 * 跟老 in-memory 实现的语义差异:
 *   - enqueue 现在 async(因为 Queue.add 返回 Promise)
 *   - getQueueDepth / getRunningCount async
 *   - 没有 in-memory 版的 "dispatchNext"(BullMQ Worker 由 ScanProcessor 拉,不在这里管)
 */

import {
  SCAN_MAX_CONCURRENT_DEFAULT,
  SCAN_MAX_CONCURRENT_MAX,
  SCAN_MAX_CONCURRENT_MIN,
  SCAN_QUEUE_NAME,
  ScanQueueService,
} from './scan-queue.service.js';

type JobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';

interface FakeJob {
  id: string;
  name: string;
  data: { scanRunId: string };
  state: JobState;
  getState: () => Promise<JobState>;
}

class FakeQueue implements Pick<Queue, 'add' | 'getJob' | 'getJobs' | 'close'> {
  readonly jobs = new Map<string, FakeJob>();

  constructor(public readonly name: string) {}

  async add(jobName: string, data: { scanRunId: string }, opts?: JobsOptions): Promise<FakeJob> {
    const id = (opts?.jobId as string | undefined) ?? data.scanRunId;
    const existing = this.jobs.get(id);
    if (existing) {
      // BullMQ jobId 重复:旧 job 仍存在,add 返回旧 job(我们的 fake 也这样模拟)
      return existing;
    }
    const job: FakeJob = {
      id,
      name: jobName,
      data,
      state: 'waiting',
      getState: function (this: FakeJob) {
        return Promise.resolve(this.state);
      },
    };
    this.jobs.set(id, job);
    return job;
  }

  async getJob(jobId: string): Promise<FakeJob | undefined> {
    return this.jobs.get(jobId);
  }

  async getJobs(states: JobState[]): Promise<FakeJob[]> {
    return [...this.jobs.values()].filter((j) => states.includes(j.state));
  }

  async getActiveCount(): Promise<number> {
    let n = 0;
    for (const j of this.jobs.values()) if (j.state === 'active') n++;
    return n;
  }

  async getWaitingCount(): Promise<number> {
    let n = 0;
    for (const j of this.jobs.values()) if (j.state === 'waiting') n++;
    return n;
  }

  async getDelayedCount(): Promise<number> {
    let n = 0;
    for (const j of this.jobs.values()) if (j.state === 'delayed') n++;
    return n;
  }

  async getWaiting(): Promise<FakeJob[]> {
    return [...this.jobs.values()].filter((j) => j.state === 'waiting');
  }

  async close(): Promise<void> {
    /* noop */
  }

  // Test helper: 模拟 ScanProcessor 拉走 job(状态 waiting → active)
  activate(scanRunId: string): void {
    const j = this.jobs.get(scanRunId);
    if (j) j.state = 'active';
  }

  // Test helper: 模拟 worker 完成(状态 active → completed)
  complete(scanRunId: string): void {
    const j = this.jobs.get(scanRunId);
    if (j) j.state = 'completed';
  }
}

/** 把我们的 FakeJob 适配成 BullMQ Job 的最小形状,给 ScanQueueService 消费 */
function makeService(q: FakeQueue): ScanQueueService {
  // BullMQ 的 Queue 类型是 class,我们的 fake 在结构上满足 Pick<Queue,...>,
  // 但完整 Queue 仍有大量字段。ScanQueueService 只用那 8 个方法,这里强制断言 cast。
  return new ScanQueueService(q as unknown as Queue);
}

describe('§11 Q6 ScanQueueService (BullMQ 升级版)', () => {
  beforeEach(() => {
    delete process.env['SCAN_MAX_CONCURRENT'];
  });

  afterEach(() => {
    delete process.env['SCAN_MAX_CONCURRENT'];
  });

  it('常量边界 = [1, 10],默认 2', () => {
    expect(SCAN_MAX_CONCURRENT_MIN).toBe(1);
    expect(SCAN_MAX_CONCURRENT_MAX).toBe(10);
    expect(SCAN_MAX_CONCURRENT_DEFAULT).toBe(2);
  });

  it('队列常量 SCAN_QUEUE_NAME = "scan"', () => {
    expect(SCAN_QUEUE_NAME).toBe('scan');
  });

  it('默认 maxConcurrent=2(没设 SCAN_MAX_CONCURRENT)', () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    expect(svc.getMaxConcurrent()).toBe(2);
  });

  it('SCAN_MAX_CONCURRENT 合法值生效', () => {
    process.env['SCAN_MAX_CONCURRENT'] = '4';
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    expect(svc.getMaxConcurrent()).toBe(4);
  });

  it('SCAN_MAX_CONCURRENT 越界(>10)抛错', () => {
    process.env['SCAN_MAX_CONCURRENT'] = '11';
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    expect(() => svc.onModuleInit()).toThrow(/SCAN_MAX_CONCURRENT/);
  });

  it('SCAN_MAX_CONCURRENT 越界(<1)抛错', () => {
    process.env['SCAN_MAX_CONCURRENT'] = '0';
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    expect(() => svc.onModuleInit()).toThrow(/SCAN_MAX_CONCURRENT/);
  });

  it('SCAN_MAX_CONCURRENT 非整数抛错', () => {
    process.env['SCAN_MAX_CONCURRENT'] = 'abc';
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    expect(() => svc.onModuleInit()).toThrow(/SCAN_MAX_CONCURRENT/);
  });

  it('enqueue 第一个 scan:job 进 waiting,running=0(worker 还没拉)', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    const r = await svc.enqueue('s1');
    expect(r.position).toBe(1); // waiting 第一个 → position=1
    expect(r.running).toBe(0);
    expect(r.maxConcurrent).toBe(2);
    expect(await svc.getRunningCount()).toBe(0);
    expect(await svc.getQueueDepth()).toBe(1);
    expect(q.jobs.get('s1')?.state).toBe('waiting');
  });

  it('worker 拉走后 state=active,position=0,running=1', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    await svc.enqueue('s1');
    q.activate('s1'); // 模拟 ScanProcessor 拉走
    const r = await svc.enqueue('s1'); // 幂等
    expect(r.position).toBe(0);
    expect(r.running).toBe(1);
    expect(await svc.getRunningCount()).toBe(1);
  });

  it('maxConcurrent=2 时,第 3 个 scan 在 waiting,depth=1', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    await svc.enqueue('s1');
    await svc.enqueue('s2');
    await svc.enqueue('s3');
    expect(await svc.getQueueDepth()).toBe(3); // 全 waiting
    // 模拟 worker 拉走 s1 和 s2
    q.activate('s1');
    q.activate('s2');
    expect(await svc.getRunningCount()).toBe(2);
    expect(await svc.getQueueDepth()).toBe(1); // 只剩 s3
    const r = await svc.enqueue('s3'); // 幂等
    expect(r.position).toBe(1); // waiting 唯一 → position=1
  });

  it('重复 enqueue 同一个 id 是幂等的(已在 waiting)', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    const r1 = await svc.enqueue('s1');
    expect(r1.position).toBe(1);
    const r2 = await svc.enqueue('s1'); // 幂等
    expect(r2.position).toBe(1); // 还是 waiting 第一个
    expect(q.jobs.size).toBe(1);
  });

  it('重复 enqueue 同一个 id(在 active)返回 position=0', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    await svc.enqueue('s1');
    q.activate('s1');
    const r = await svc.enqueue('s1');
    expect(r.position).toBe(0);
    expect(r.running).toBe(1);
  });

  it('worker 完成后,completed job 还在 fake 里(getRunningCount 不再算它)', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    await svc.enqueue('s1');
    q.activate('s1');
    expect(await svc.getRunningCount()).toBe(1);
    q.complete('s1');
    expect(await svc.getRunningCount()).toBe(0);
    // 真实 BullMQ removeOnComplete=true 后 job 从 queue 消失;fake 这里保留用于 inspection
  });

  it('enqueue 多个 job 时 position 按 waiting 顺序递增', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    const r1 = await svc.enqueue('s1');
    const r2 = await svc.enqueue('s2');
    const r3 = await svc.enqueue('s3');
    expect(r1.position).toBe(1);
    expect(r2.position).toBe(2);
    expect(r3.position).toBe(3);
  });

  it('jobId 复用同一 scanRunId 时 fake.add 返回旧 job,不入新条目', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    await svc.enqueue('s1');
    await svc.enqueue('s1');
    await svc.enqueue('s1');
    expect(q.jobs.size).toBe(1);
  });

  it('getQueueDepth 包含 waiting + delayed', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    await svc.enqueue('s1');
    await svc.enqueue('s2');
    // 强制 s2 进 delayed
    const j2 = q.jobs.get('s2');
    if (j2) j2.state = 'delayed';
    expect(await svc.getQueueDepth()).toBe(2);
  });

  it('SCAN_MAX_CONCURRENT=1 严格串行(语义:worker 只跑 1 个,无队列侧并发控制)', async () => {
    process.env['SCAN_MAX_CONCURRENT'] = '1';
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    expect(svc.getMaxConcurrent()).toBe(1);
    // 注意:并发限制由 ScanProcessor.concurrency 控制,ScanQueueService 只暴露上限。
    // 这里只验证 getMaxConcurrent 返回 1。
    await svc.enqueue('s1');
    await svc.enqueue('s2');
    await svc.enqueue('s3');
    expect(await svc.getQueueDepth()).toBe(3);
  });

  it('onModuleDestroy 关闭 queue 连接', async () => {
    const q = new FakeQueue('scan');
    const svc = makeService(q);
    svc.onModuleInit();
    let closed = false;
    q.close = async () => {
      closed = true;
    };
    await svc.onModuleDestroy();
    expect(closed).toBe(true);
  });

  it('FakeJob 暴露 getState() 满足 BullMQ Job 契约', async () => {
    const q = new FakeQueue('scan');
    const j = await q.add('run', { scanRunId: 'x' }, { jobId: 'x' });
    expect(await j.getState()).toBe('waiting');
  });
});
