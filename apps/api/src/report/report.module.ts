import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';

import { ReportController } from './report.controller.js';
import { ReportService } from './report.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
