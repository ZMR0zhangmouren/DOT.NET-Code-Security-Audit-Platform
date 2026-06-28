import { Module } from '@nestjs/common';

import { AgentsModule } from './agents/agents.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CodeVersionsModule } from './code-versions/code-versions.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { ReportModule } from './report/report.module.js';
import { ScanModule } from './scan/scan.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SkillBundlesModule } from './skill-bundles/skill-bundles.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

/**
 * 根模块。
 *
 * §5.2 + §5.3 Scan 主流程已接入:
 *   CodeVersionsModule + ScanModule + SkillBundlesModule + StorageModule
 * 后续:
 * - ReportModule        (§5.4)
 * - VulnerabilityModule (§5.5,漏洞库 + 实例双层)
 * - AuditLogModule      (§6.2 审计日志)
 */
@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    CodeVersionsModule,
    ScanModule,
    SkillBundlesModule,
    ReportModule,
    UsersModule,
    SettingsModule,
    AgentsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
