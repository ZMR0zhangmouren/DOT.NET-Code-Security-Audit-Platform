import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { type Job } from 'bullmq'; // runtime ref(WorkerHost.process(job: Job) 需要 BullMQ Job class 在 emitDecoratorMetadata 时存在)

import {
  SCAN_MAX_CONCURRENT_DEFAULT,
  SCAN_MAX_CONCURRENT_MAX,
  SCAN_MAX_CONCURRENT_MIN,
  SCAN_QUEUE_NAME,
  type ScanJobData,
} from './scan-queue.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanRunnerService } from './scan-runner.service.js'; // runtime ref (NestJS DI)

/**
 * §11 Q6 —— ScanProcessor(BullMQ Worker)
 *
 * 与 ScanQueueService 配对:
 *   - ScanQueueService = Producer:`Queue.add('run', {scanRunId})`
 *   - ScanProcessor(本类)= Worker:继承 `WorkerHost`,override `process(job)` 后
 *     `@nestjs/bullmq` 把它包装成 BullMQ Worker,通过 Redis 拉 job 并发执行
 *
 * 并发上限由 `concurrency` 控制,值从 `SCAN_MAX_CONCURRENT` 环境变量解析(范围 1-10,默认 2),
 * 与之前 in-memory 实现的 `workerCount` 语义一致。
 *
 * 失败处理:
 *   - 故意**不**开 BullMQ 内建 `attempts` / `backoff`,否则同一个 scanRunId 会被自动 retry
 *     跑多次,违反 §5.3 幂等约束(replay 必须显式触发)。
 *   - runner.kickoff 内部已经 try/catch 写 DB status='failed' / emit log,这里只需
 *     把 error 重抛让 BullMQ 标记 job 为 failed,触发 'failed' 事件 + removeOnFail 落盘。
 */
@Processor(SCAN_QUEUE_NAME, {
  concurrency: readConcurrencyFromEnv(),
})
export class ScanProcessor extends WorkerHost {
  private readonly logger = new Logger('ScanProcessor');

  constructor(private readonly runner: ScanRunnerService) {
    super();
  }

  async process(job: Job<ScanJobData>): Promise<void> {
    const { scanRunId } = job.data;
    if (!scanRunId) {
      throw new Error(`scan job ${job.id} missing scanRunId`);
    }
    this.logger.log(`[job ${job.id}] starting scan ${scanRunId} (attempt=${job.attemptsMade + 1})`);
    try {
      await this.runner.kickoff(scanRunId);
      this.logger.log(`[job ${job.id}] scan ${scanRunId} finished`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`[job ${job.id}] scan ${scanRunId} crashed: ${msg}`);
      throw e; // 让 BullMQ 标记 failed
    }
  }
}

/** 从 env 解析 concurrency,worker 构造时一次性快照,env 改了需重启 */
function readConcurrencyFromEnv(): number {
  const envVal = process.env['SCAN_MAX_CONCURRENT'];
  if (envVal === undefined || envVal === '') return SCAN_MAX_CONCURRENT_DEFAULT;
  const parsed = Number(envVal);
  if (
    !Number.isInteger(parsed) ||
    parsed < SCAN_MAX_CONCURRENT_MIN ||
    parsed > SCAN_MAX_CONCURRENT_MAX
  ) {
    // 启动期让 NestJS 工厂抛错比让 worker 静默用错值更安全
    throw new Error(
      `SCAN_MAX_CONCURRENT must be integer in [${SCAN_MAX_CONCURRENT_MIN}, ${SCAN_MAX_CONCURRENT_MAX}], got: ${envVal}`,
    );
  }
  return parsed;
}
