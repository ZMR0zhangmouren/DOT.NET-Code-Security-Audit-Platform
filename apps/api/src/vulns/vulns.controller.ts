import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { VulnerabilityStatus, VulnLibraryStatus } from '@platform/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  VulnLibraryService,
  type VulnLibraryPublic,
  type VulnLibraryWithTimeline,
} from './vuln-library.service.js'; // runtime ref
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VulnService, type VulnerabilityPublic } from './vuln.service.js'; // runtime ref

/**
 * §5.5 漏洞库 + 漏洞 API
 *
 *  鉴权(JwtAuthGuard 已在 controller 级开启):
 *  - GET 任何已登录用户
 *  - PATCH /status:任何已登录用户(Phase 2 可收紧到 admin / project member)
 *
 *  - GET  /api/projects/:id/vuln-library             → VulnLibraryPublic[]
 *  - GET  /api/vuln-library/:id                      → VulnLibraryWithTimeline (含 timeline)
 *  - PATCH /api/vuln-library/:id/status              → 改 library 状态
 *  - GET  /api/vulnerabilities/:id                   → VulnerabilityPublic
 *  - PATCH /api/vulnerabilities/:id/status           → 改 vulnerability 状态(联动 library)
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class VulnsController {
  constructor(
    private readonly library: VulnLibraryService,
    private readonly vuln: VulnService,
  ) {}

  @Get('projects/:id/vuln-library')
  listForProject(@Param('id') projectId: string): VulnLibraryPublic[] {
    return this.library.list(projectId);
  }

  /**
   * Phase 3 — 漏洞趋势图
   * GET /api/projects/:id/vuln-trend?granularity=day&days=30
   */
  @Get('projects/:id/vuln-trend')
  trend(
    @Param('id') projectId: string,
    @Query('granularity') g: string,
    @Query('days') d: string,
  ): Array<{ period: string; total: number; bySeverity: Record<string, number> }> {
    const granularity = (g === 'week' || g === 'month' ? g : 'day') as 'day' | 'week' | 'month';
    const days = Math.min(Math.max(Number(d) || 30, 7), 365); // clamp 7-365
    return this.library.getTrend(projectId, granularity, days);
  }

  @Get('vuln-library/:id')
  getLibrary(@Param('id') id: string): VulnLibraryWithTimeline {
    return this.library.getWithTimeline(id);
  }

  @Patch('vuln-library/:id/status')
  setLibraryStatus(
    @Param('id') id: string,
    @Body() body: { status: VulnLibraryStatus },
  ): VulnLibraryWithTimeline {
    return this.library.setStatus(id, body.status);
  }

  @Get('scan-runs/:runId/vulnerabilities')
  listByRun(@Param('runId') runId: string): VulnerabilityPublic[] {
    return this.vuln.listByScanRun(runId);
  }

  @Get('vulnerabilities/:id')
  getVuln(@Param('id') id: string): VulnerabilityPublic {
    return this.vuln.get(id);
  }

  @Patch('vulnerabilities/:id/status')
  setVulnStatus(
    @Param('id') id: string,
    @Body() body: { status: VulnerabilityStatus },
  ): VulnerabilityPublic {
    return this.vuln.setStatus(id, body.status);
  }
}
