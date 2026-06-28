import { Controller, Get, Inject } from '@nestjs/common';
import { COVERAGE_MODE } from '@platform/shared';

import { DATABASE, type Db } from '../db/database.module.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanQueueService } from '../scan/scan-queue.service.js'; // runtime ref (NestJS DI)

/**
 * 健康检查端点 —— 验证 nest 启动 + SQLite 可用。
 * 后续将扩展为 readiness / liveness / 子仓库绑定状态等更细粒度的诊断。
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly scanQueue: ScanQueueService,
  ) {}

  @Get()
  async check(): Promise<{
    status: 'ok';
    uptimeSec: number;
    coverageModeDefault: (typeof COVERAGE_MODE)[number];
    nodeVersion: string;
    dbTables: number;
    queueDepth: number;
    queueRunning: number;
    queueMaxConcurrent: number;
  }> {
    const rows = this.db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    return {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      coverageModeDefault: COVERAGE_MODE[0],
      nodeVersion: process.version,
      dbTables: rows.length,
      queueDepth: await this.scanQueue.getQueueDepth(),
      queueRunning: await this.scanQueue.getRunningCount(),
      queueMaxConcurrent: this.scanQueue.getMaxConcurrent(),
    };
  }
}
