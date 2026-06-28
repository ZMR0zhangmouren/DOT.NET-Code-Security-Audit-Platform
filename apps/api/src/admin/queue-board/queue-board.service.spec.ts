import type { Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * §11 Q6 + §11 Q13 —— QueueBoardService 单元测试
 *
 * 关注点:
 *   - QUEUE_BOARD_BASE_PATH = '/admin/queue'
 *   - service 构造后能给出 router + mountPath
 *   - BullMQAdapter 接收 fake Queue 不抛
 *   - 不连真 Redis:用 Pick<Queue, 'name'> 的最小 fake
 */

// Mock @bull-board/api + @bull-board/express,确认它们被以正确参数调用
vi.mock('@bull-board/api', () => ({
  createBullBoard: vi.fn(({ queues }) => ({
    setQueues: vi.fn(),
    replaceQueues: vi.fn(),
    addQueue: vi.fn(),
    removeQueue: vi.fn(),
    __queues: queues,
  })),
}));

vi.mock('@bull-board/api/bullMQAdapter', () => ({
  BullMQAdapter: vi.fn().mockImplementation((q: { name: string }) => ({
    __queueName: q.name,
    getName: () => q.name,
  })),
}));

vi.mock('@bull-board/express', () => {
  const setBasePath = vi.fn().mockReturnThis();
  const getRouter = vi.fn(() => ({ __router: true }));
  const ExpressAdapter = vi.fn().mockImplementation(() => ({
    setBasePath,
    getRouter,
  }));
  return { ExpressAdapter };
});

// Mock scan-queue.service 的常量(避免引入 BullMQ 真实类型链)
vi.mock('../../scan/scan-queue.service.js', () => ({
  SCAN_QUEUE_NAME: 'scan',
}));

import { QueueBoardService, QUEUE_BOARD_BASE_PATH } from './queue-board.service.js';

describe('§11 Q6 + Q13 QueueBoardService', () => {
  let fakeQueue: { name: string };

  beforeEach(() => {
    fakeQueue = { name: 'scan' };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('QUEUE_BOARD_BASE_PATH = "/admin/queue"', () => {
    expect(QUEUE_BOARD_BASE_PATH).toBe('/admin/queue');
  });

  it('构造时:ExpressAdapter 实例化并 setBasePath("/admin/queue")', async () => {
    const mod = await import('@bull-board/express');
    const svc = new QueueBoardService();
    expect(mod.ExpressAdapter).toHaveBeenCalledTimes(1);
    const adapterInstance = (mod.ExpressAdapter as unknown as ReturnType<typeof vi.fn>).mock
      .results[0]!.value;
    expect(adapterInstance.setBasePath).toHaveBeenCalledWith('/admin/queue');
    void svc;
  });

  it('attachQueue: BullMQAdapter 接收注入的 scan Queue + createBullBoard 收到 [scanAdapter]', async () => {
    const bullMod = await import('@bull-board/api');
    const adapterMod = await import('@bull-board/api/bullMQAdapter');
    const svc = new QueueBoardService();
    svc.attachQueue(fakeQueue as unknown as Queue, 'scan');
    expect(adapterMod.BullMQAdapter).toHaveBeenCalledTimes(1);
    expect(adapterMod.BullMQAdapter).toHaveBeenCalledWith(fakeQueue);
    expect(bullMod.createBullBoard).toHaveBeenCalledTimes(1);
    const arg = (bullMod.createBullBoard as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.queues).toHaveLength(1);
    expect(arg.queues[0].__queueName).toBe('scan');
    expect(arg.serverAdapter).toBeDefined();
  });

  it('getMountPath() 返回 /admin/queue', () => {
    const svc = new QueueBoardService();
    expect(svc.getMountPath()).toBe('/admin/queue');
  });

  it('getRouter() 在 attachQueue 之前抛 No queues attached', () => {
    const svc = new QueueBoardService();
    expect(() => svc.getRouter()).toThrow(/No queues attached/);
  });

  it('getRouter() 在 attachQueue 后返回 ExpressAdapter.getRouter() 的产物', () => {
    const svc = new QueueBoardService();
    svc.attachQueue(fakeQueue as unknown as Queue, 'scan');
    expect(svc.getRouter()).toEqual({ __router: true });
  });

  it('onModuleInit 不抛(纯日志)', () => {
    const svc = new QueueBoardService();
    expect(() => svc.onModuleInit()).not.toThrow();
  });

  it('getAttachedQueues 返回已注册队列名列表', () => {
    const svc = new QueueBoardService();
    expect(svc.getAttachedQueues()).toEqual([]);
    svc.attachQueue(fakeQueue as unknown as Queue, 'scan');
    expect(svc.getAttachedQueues()).toEqual(['scan']);
  });
});
