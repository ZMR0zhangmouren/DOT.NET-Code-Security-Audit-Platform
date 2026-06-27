import { Module } from '@nestjs/common';

import { AgentsModule } from './agents/agents.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';

/**
 * 根模块。
 *
 * 后续将按 需求文档.md §5.x 陆续加入:
 * - ProjectModule       (§5.1)
 * - CodeVersionModule   (§5.2)
 * - ScanModule          (§5.3,接入 ScanGateway + @openai/agents Runner)
 * - ReportModule        (§5.4)
 * - VulnerabilityModule (§5.5,漏洞库 + 实例双层)
 * - ConfigModule        (§5.7 系统配置:AI Key / git / 代理)
 * - AuditLogModule      (§6.2 审计日志)
 */
@Module({
  imports: [DatabaseModule, HealthModule, AuthModule, AgentsModule, RealtimeModule],
})
export class AppModule {}
