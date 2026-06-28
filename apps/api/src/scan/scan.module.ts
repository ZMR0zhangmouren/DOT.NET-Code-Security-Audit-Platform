import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { VulnsModule } from '../vulns/vulns.module.js';

import { ScanDiffController } from './scan-diff.controller.js';
import { ScanDiffService } from './scan-diff.service.js';
import { ScanQueueService } from './scan-queue.service.js';
import { ScanRunnerService } from './scan-runner.service.js';
import { ScanController } from './scan.controller.js';
import { ScanService } from './scan.service.js';

@Module({
  imports: [DatabaseModule, StorageModule, RealtimeModule, VulnsModule],
  controllers: [ScanController, ScanDiffController],
  providers: [ScanService, ScanRunnerService, ScanQueueService, ScanDiffService],
  exports: [ScanService, ScanRunnerService, ScanQueueService, ScanDiffService],
})
export class ScanModule {}
