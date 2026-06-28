import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { StorageModule } from '../storage/storage.module.js';

import { ScanRunnerService } from './scan-runner.service.js';
import { ScanController } from './scan.controller.js';
import { ScanService } from './scan.service.js';

@Module({
  imports: [DatabaseModule, StorageModule, RealtimeModule],
  controllers: [ScanController],
  providers: [ScanService, ScanRunnerService],
  exports: [ScanService, ScanRunnerService],
})
export class ScanModule {}
