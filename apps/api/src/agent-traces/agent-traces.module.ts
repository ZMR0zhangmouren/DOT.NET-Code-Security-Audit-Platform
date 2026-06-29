import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../db/database.module.js';

import { AgentTracesController } from './agent-traces.controller.js';
import { AgentTracesService } from './agent-traces.service.js';

/**
 * Phase 3 §1.2/2.7 Agent Trace 模块
 *
 * 暴露:
 * - AgentTracesService —— 给 ScanRunnerService 注入,主循环里 recordTrace
 * - AgentTracesController —— 给前端 TracePage 暴露 GET /api/scan-runs/:id/trace
 */
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AgentTracesController],
  providers: [AgentTracesService],
  exports: [AgentTracesService],
})
export class AgentTracesModule {}
