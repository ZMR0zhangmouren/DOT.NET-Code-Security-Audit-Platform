import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

export const SCAN_QUEUE_NAME = 'scan';
export const SCAN_JOB_NAME = 'run';

export const SCAN_MAX_CONCURRENT_DEFAULT = 2;
export const SCAN_MAX_CONCURRENT_MIN = 1;
export const SCAN_MAX_CONCURRENT_MAX = 10;

export interface ScanJobData {
  scanRunId: string;
}

/**
 * §11 Q6 —— BullMQ + Redis 真队列(MVP → Phase 2 升级落地,2026-06-28)
 *
 * 历史演进(参见 需求文档.md §11 Q6):
 *   - MVP(commit e3bbe96):in-memory FIFO + worker pool,无进程崩溃恢复能力
 *   - Phase 2(本次升级):BullMQ + Redis,带来:
 *       * 进程崩溃可恢复 —— job 持久化在 Redis,worker 重启自动接管
 *       * 分布式 worker —— 多个 API 实例共享同一队列,水平扩展
 *       * 可视化 —— Phase 2.5 接 Bull-Board(`@bull-board/api` + `@bull-board/express`)
 *
 * §11 Q11 备注:
 *   §11 Q11 要求"本地部署 / 无 Docker"。本次升级部分打破该约束 —— Redis 是 BullMQ 4/5 的硬依赖,
 *   无 in-memory transport。但 Redis 本身极轻量,推荐两种部署:
 *     (1) `docker run -d --name redis -p 6379:6379 redis:7-alpine`(推荐,零配置)
 *     (2) 本机直接装 Redis 服务(Win 上可用 Memurai 或 WSL apt 装)
 *   若用户在隔离环境完全无法装 Redis,Phase 3 可回退到 `better-queue` in-process 实现,
 *   public API(enqueue / getQueueDepth / getRunningCount)保持兼容。
 *
 * 公开 API(向后兼容 ScanService 调用):
 *   - enqueue(scanRunId)
 *   - getMaxConcurrent() / getQueueDepth() / getRunningCount()
 *
 * BullMQ 角色分工:
 *   - ScanQueueService(本类)= Producer —— `Queue.add('run', {scanRunId})`
 *   - ScanProcessor = Worker —— `@Processor('scan')` + `@Process('run')` 调 `runner.kickoff`
 *   - 并发上限由 Worker `concurrency: SCAN_MAX_CONCURRENT` 控制,跟 in-memory 实现保持一致语义
 */
@Injectable()
export class ScanQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ScanQueueService');

  private maxConcurrent = SCAN_MAX_CONCURRENT_DEFAULT;

  constructor(@InjectQueue(SCAN_QUEUE_NAME) private readonly queue: Queue<ScanJobData>) {}

  /**
   * 暴露底层 BullMQ Queue 引用(§11 Q6 Phase 2.5 给 Bull-Board 观察用)。
   * main.ts 在 bootstrap 时调 attachQueue() 把这个 Queue 包成 BullMQAdapter 挂上 dashboard。
   * 不暴露 add/close 之类写操作 —— Bull-Board 是只读观察面。
   */
  getQueue(): Queue<ScanJobData> {
    return this.queue;
  }

  /**
   * 在 module init 时由外部 caller 显式调一次(扫到不依赖 process.env 副作用)。
   * 兼容老的 in-memory 调用:`q.onModuleInit()`。
   */
  onModuleInit(): void {
    const envVal = process.env['SCAN_MAX_CONCURRENT'];
    if (envVal !== undefined && envVal !== '') {
      const parsed = Number(envVal);
      if (
        !Number.isInteger(parsed) ||
        parsed < SCAN_MAX_CONCURRENT_MIN ||
        parsed > SCAN_MAX_CONCURRENT_MAX
      ) {
        throw new Error(
          `SCAN_MAX_CONCURRENT must be integer in [${SCAN_MAX_CONCURRENT_MIN}, ${SCAN_MAX_CONCURRENT_MAX}], got: ${envVal}`,
        );
      }
      this.maxConcurrent = parsed;
    }
    this.logger.log(
      `ScanQueueService initialized (BullMQ + Redis); maxConcurrent=${this.maxConcurrent}` +
        ` (env SCAN_MAX_CONCURRENT, range [${SCAN_MAX_CONCURRENT_MIN}, ${SCAN_MAX_CONCURRENT_MAX}])`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // BullMQ Queue 持有 Redis 连接,NestJS 容器销毁时关闭
    try {
      await this.queue.close();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ScanQueue close on shutdown failed: ${msg}`);
    }
  }

  /** 当前 worker 并发上限(从 SCAN_MAX_CONCURRENT 解析) */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /** 当前 active 数(=正在跑的 worker) */
  async getRunningCount(): Promise<number> {
    const active = await this.queue.getActiveCount();
    return active;
  }

  /** 当前 waiting + delayed 数(还没被 worker 拉走的 job) */
  async getQueueDepth(): Promise<number> {
    const waiting = await this.queue.getWaitingCount();
    const delayed = await this.queue.getDelayedCount();
    return waiting + delayed;
  }

  /**
   * 入队一个 scanRunId。
   *   - 幂等:同一 id 已存在 waiting/active/delayed 时不重复加,返回已存在 job 的状态
   *   - jobOpts:去掉 `attempts` 与 `backoff`(scan runner 内部已处理失败,
   *     且 BullMQ 自动 retry 会导致同一个 scanRunId 跑多次,违反 §5.3 幂等约束)
   *   - removeOnComplete=true:完成即清掉,避免 Redis 堆积
   */
  async enqueue(
    scanRunId: string,
  ): Promise<{ position: number; running: number; maxConcurrent: number }> {
    const existing = await this.findExistingJob(scanRunId);
    if (existing) {
      const pos = await this.computePosition(existing);
      return {
        position: pos,
        running: await this.getRunningCount(),
        maxConcurrent: this.maxConcurrent,
      };
    }

    await this.queue.add(
      SCAN_JOB_NAME,
      { scanRunId },
      {
        jobId: scanRunId, // 幂等 —— 同一 scanRunId 重复 add 会去重
        removeOnComplete: true,
        removeOnFail: 50, // 失败保留最近 50 条便于排查
      },
    );

    const after = await this.findExistingJob(scanRunId);
    const pos = after ? await this.computePosition(after) : 1;
    this.logger.log(
      `scan ${scanRunId} enqueued; depth=${await this.getQueueDepth()}, running=${await this.getRunningCount()}/${this.maxConcurrent}`,
    );
    return {
      position: pos,
      running: await this.getRunningCount(),
      maxConcurrent: this.maxConcurrent,
    };
  }

  /** 在 waiting / active / delayed 中找同 id 的 job */
  private async findExistingJob(scanRunId: string): Promise<Job<ScanJobData> | undefined> {
    const statuses: Array<'waiting' | 'active' | 'delayed'> = ['waiting', 'active', 'delayed'];
    for (const status of statuses) {
      const job = await this.queue.getJob(scanRunId);
      if (job) {
        const state = await job.getState();
        if (state === status) return job;
      }
    }
    return (await this.queue.getJob(scanRunId)) ?? undefined;
  }

  /** 计算 position:active=0,waiting 里 idx+1,delayed=depth+1 */
  private async computePosition(job: Job<ScanJobData>): Promise<number> {
    const state = await job.getState();
    if (state === 'active') return 0;
    if (state === 'waiting') {
      const waiting = await this.queue.getWaiting();
      const idx = waiting.findIndex((j) => j.id === job.id);
      return idx >= 0 ? idx + 1 : 1;
    }
    if (state === 'delayed') return (await this.queue.getWaitingCount()) + 1;
    return 0;
  }
}
