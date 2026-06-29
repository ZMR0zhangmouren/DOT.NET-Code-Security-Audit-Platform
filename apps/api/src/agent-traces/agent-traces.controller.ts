import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  AgentTracesService,
  type AgentTracePublic,
  type AgentTraceSummary,
} from './agent-traces.service.js'; // 运行时引用 (NestJS DI)

/**
 * Phase 3 §1.2/2.7 Agent Trace API
 *
 * 鉴权(JwtAuthGuard 已在 controller 级开启):
 * - 任何已登录用户都能读自己项目下的 trace (Phase 2 可收紧到 project member)
 *
 * 端点:
 * - GET /api/scan-runs/:id/trace          → AgentTracePublic[]   + summary header 注入
 * - GET /api/agent-traces/:id            → 单条 AgentTracePublic
 * - GET /api/scan-runs/:id/trace/summary → AgentTraceSummary (给前端顶部卡片)
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class AgentTracesController {
  constructor(private readonly svc: AgentTracesService) {}

  @Get('scan-runs/:id/trace')
  listByScanRun(@Param('id') scanRunId: string): AgentTracePublic[] {
    return this.svc.listByScanRun(scanRunId);
  }

  @Get('scan-runs/:id/trace/summary')
  summarize(@Param('id') scanRunId: string): AgentTraceSummary {
    return this.svc.summarize(scanRunId);
  }

  @Get('agent-traces/:id')
  getById(@Param('id') id: string): AgentTracePublic {
    return this.svc.getById(id);
  }
}
