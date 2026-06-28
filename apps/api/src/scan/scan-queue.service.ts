import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanRunnerService } from './scan-runner.service.js'; // runtime ref (NestJS DI)

export const SCAN_MAX_CONCURRENT_DEFAULT = 2;
export const SCAN_MAX_CONCURRENT_MIN = 1;
export const SCAN_MAX_CONCURRENT_MAX = 10;

/**
 * §11 Q6 —— 真正并发扫描(MVP in-memory queue + worker pool)
 *
 * 设计决策(参见任务说明):
 * - 选 (B) in-memory queue + worker pool,不引入 Redis
 * - BullMQ 5.x 的 peerDependency 强制要求 redis,无 in-memory transport
 * - 进程内调度:producer + worker 同进程;Phase 2 切 BullMQ + 分布式 worker
 *
 * 并发控制:固定大小 worker pool(SCAN_MAX_CONCURRENT 个并发槽位);
 * 超过并发的入队请求留在 pending,FIFO 调度。
 */
@Injectable()
export class ScanQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ScanQueueService');

  /** pending 任务(等待 worker 取走) */
  private readonly pending: string[] = [];
  /** 当前正在执行的 scanRunId */
  private readonly running = new Set<string>();

  private maxConcurrent = SCAN_MAX_CONCURRENT_DEFAULT;
  private workerCount = 0;
  private shuttingDown = false;

  constructor(private readonly runner: ScanRunnerService) {}

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
      `ScanQueueService initialized; maxConcurrent=${this.maxConcurrent}` +
        ` (env SCAN_MAX_CONCURRENT, range [${SCAN_MAX_CONCURRENT_MIN}, ${SCAN_MAX_CONCURRENT_MAX}])`,
    );
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
  }

  /** 当前 worker 槽位数(可配) */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /** 当前 pending 队列长度 */
  getQueueDepth(): number {
    return this.pending.length;
  }

  /** 当前正在执行的 scan 数 */
  getRunningCount(): number {
    return this.running.size;
  }

  /**
   * 入队一个 scanRunId。
   * - 如果有空 worker 槽,立即启动
   * - 否则追加到 pending 队列尾部(FIFO),worker 完成后从头部取下一个
   */
  enqueue(scanRunId: string): { position: number; running: number; maxConcurrent: number } {
    if (this.shuttingDown) {
      throw new Error('ScanQueueService is shutting down; cannot enqueue new scans');
    }

    if (this.running.has(scanRunId) || this.pending.includes(scanRunId)) {
      // 重复入队:幂等,返回当前位置
      const pos = this.pending.indexOf(scanRunId);
      if (pos >= 0) {
        return {
          position: pos + 1,
          running: this.running.size,
          maxConcurrent: this.maxConcurrent,
        };
      }
      return {
        position: 0,
        running: this.running.size,
        maxConcurrent: this.maxConcurrent,
      };
    }

    if (this.running.size < this.maxConcurrent) {
      this.startWorker(scanRunId);
      return { position: 0, running: this.running.size, maxConcurrent: this.maxConcurrent };
    }

    this.pending.push(scanRunId);
    this.logger.log(
      `scan ${scanRunId} queued; pending depth=${this.pending.length}, running=${this.running.size}/${this.maxConcurrent}`,
    );
    return {
      position: this.pending.length,
      running: this.running.size,
      maxConcurrent: this.maxConcurrent,
    };
  }

  private startWorker(scanRunId: string): void {
    this.running.add(scanRunId);
    this.workerCount++;
    const workerId = this.workerCount;
    this.logger.log(
      `worker[${workerId}] starting scan ${scanRunId} (running=${this.running.size}/${this.maxConcurrent})`,
    );

    // 不阻塞:把执行交给 runner,完成后从 running 中移除并调度下一个
    void this.runner
      .kickoff(scanRunId)
      .then(() => {
        this.logger.log(`worker[${workerId}] finished scan ${scanRunId}`);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`worker[${workerId}] crashed on scan ${scanRunId}: ${msg}`);
      })
      .finally(() => {
        this.running.delete(scanRunId);
        this.dispatchNext();
      });
  }

  private dispatchNext(): void {
    if (this.shuttingDown) return;
    while (this.running.size < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift();
      if (next) this.startWorker(next);
    }
  }
}
