import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';
import { ScanModule } from '../scan/scan.module.js';

import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule, ScanModule], // ScanQueueService 来自 ScanModule
  controllers: [HealthController],
})
export class HealthModule {}
