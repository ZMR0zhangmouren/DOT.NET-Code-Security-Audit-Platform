import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { CoverageMode } from '@platform/shared';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanService, type ScanRunPublic } from './scan.service.js'; // 运行时引用

interface CreateScanDto {
  projectId: string;
  codeVersionId: string;
  skillBundleId: string;
  triggerType?: 'manual' | 'scheduled' | 'replay';
  coverageMode?: CoverageMode;
}

/**
 * §5.3 Scan 主流程端点。
 *
 * 鉴权(JwtAuthGuard 已在 controller 级开启):
 * - 全部端点要求登录
 * - triggeredBy 从 JWT 解出(req.user.sub),不再读 x-user-id
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  @Post('scan-runs')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateScanDto,
  ): Promise<ScanRunPublic> {
    const triggeredBy = user?.sub ?? 'unknown';
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
  async replay(@Param('id') id: string): Promise<ScanRunPublic> {
    return this.scan.replay(id);
  }

  @Post('scan-runs/:id/recompute-coverage')
  recomputeCoverage(@Param('id') id: string): ScanRunPublic {
    return this.scan.recomputeCoverage(id);
  }
}
