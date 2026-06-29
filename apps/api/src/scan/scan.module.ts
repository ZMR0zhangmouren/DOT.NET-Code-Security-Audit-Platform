import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { ConnectionOptions } from 'bullmq';

import { AgentTracesModule } from '../agent-traces/agent-traces.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../db/database.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { SkillBundlesModule } from '../skill-bundles/skill-bundles.module.js';
import { SkillsModule } from '../skills/skills.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { VulnsModule } from '../vulns/vulns.module.js';

import { ScanDiffController } from './scan-diff.controller.js';
import { ScanDiffService } from './scan-diff.service.js';
import { SCAN_QUEUE_NAME, ScanQueueService } from './scan-queue.service.js';
import { ScanRunnerService } from './scan-runner.service.js';
import { ScanController } from './scan.controller.js';
import { ScanProcessor } from './scan.processor.js';
import { ScanService } from './scan.service.js';

function readRedisConnection(): ConnectionOptions {
  const host = process.env['REDIS_HOST'] ?? '127.0.0.1';
  const portRaw = process.env['REDIS_PORT'];
  const port = portRaw ? Number(portRaw) : 6379;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`REDIS_PORT must be integer in [1, 65535], got: ${portRaw}`);
  }
  return { host, port };
}

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    RealtimeModule,
    VulnsModule,
    AuthModule,
    SkillBundlesModule,
    SkillsModule,
    AgentTracesModule,
    MetricsModule,
    BullModule.forRoot({
      connection: readRedisConnection(),
    }),
    BullModule.registerQueue({
      name: SCAN_QUEUE_NAME,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
        attempts: 1, // §5.3 幂等约束:不自动 retry,失败由用户显式触发 replay
      },
    }),
  ],
  controllers: [ScanController, ScanDiffController],
  providers: [ScanService, ScanRunnerService, ScanQueueService, ScanDiffService, ScanProcessor],
  exports: [ScanService, ScanRunnerService, ScanQueueService, ScanDiffService],
})
export class ScanModule {}
