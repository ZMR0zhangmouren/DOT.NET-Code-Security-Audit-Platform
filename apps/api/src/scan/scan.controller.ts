import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { CoverageMode } from '@platform/shared';
import type { Request } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanService, type ScanRunPublic } from './scan.service.js'; // 运行时引用

interface CreateScanDto {
  projectId: string;
  codeVersionId: string;
  skillBundleId: string;
  triggerType?: 'manual' | 'scheduled' | 'replay';
  coverageMode?: CoverageMode;
}

@Controller()
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  @Post('scan-runs')
  create(@Req() req: Request, @Body() body: CreateScanDto): ScanRunPublic {
    const triggeredBy = (req.headers['x-user-id'] as string | undefined) ?? 'unknown';
    return this.scan.create({
      projectId: body.projectId,
      codeVersionId: body.codeVersionId,
      skillBundleId: body.skillBundleId,
      triggerType: body.triggerType ?? 'manual',
      triggeredBy,
      coverageMode: body.coverageMode,
    });
  }

  @Get('scan-runs/:id')
  get(@Param('id') id: string): ScanRunPublic {
    return this.scan.get(id);
  }

  @Get('projects/:id/scan-runs')
  list(@Param('id') projectId: string): ScanRunPublic[] {
    return this.scan.listByProject(projectId);
  }

  @Post('scan-runs/:id/cancel')
  cancel(@Param('id') id: string): { ok: boolean; canceled: boolean } {
    return this.scan.cancel(id);
  }

  @Post('scan-runs/:id/replay')
  replay(@Param('id') id: string): ScanRunPublic {
    return this.scan.replay(id);
  }
}
