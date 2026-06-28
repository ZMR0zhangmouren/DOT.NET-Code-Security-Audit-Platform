import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import type { VulnerabilityStatus, VulnLibraryStatus } from '@platform/shared';

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
 *  - GET  /api/projects/:id/vuln-library             → VulnLibraryPublic[]
 *  - GET  /api/vuln-library/:id                      → VulnLibraryWithTimeline (含 timeline)
 *  - PATCH /api/vuln-library/:id/status              → 改 library 状态
 *  - GET  /api/vulnerabilities/:id                   → VulnerabilityPublic
 *  - PATCH /api/vulnerabilities/:id/status           → 改 vulnerability 状态(联动 library)
 */
@Controller()
export class VulnsController {
  constructor(
    private readonly library: VulnLibraryService,
    private readonly vuln: VulnService,
  ) {}

  @Get('projects/:id/vuln-library')
  listForProject(@Param('id') projectId: string): VulnLibraryPublic[] {
    return this.library.list(projectId);
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

// suppress unused
void Query;
