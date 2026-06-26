import { Module } from '@nestjs/common';

import { HealthModule } from './health/health.module.js';

/**
 * 根模块。
 *
 * 后续将按 需求文档.md §5.x 陆续加入:
 * - ProjectModule       (§5.1)
 * - CodeVersionModule   (§5.2)
 * - ScanModule          (§5.3,含 WebSocket)
 * - ReportModule        (§5.4)
 * - VulnerabilityModule (§5.5,漏洞库 + 实例双层)
 * - AuthModule          (§5.7 用户管理)
 * - ConfigModule        (§5.7 系统配置:AI Key / git / 代理)
 * - AuditLogModule      (§6.2 审计日志)
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
