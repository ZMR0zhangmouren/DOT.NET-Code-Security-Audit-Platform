import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { CoverageMode } from '@platform/shared';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MetricsService } from '../metrics/metrics.service.js'; // 运行时引用
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SkillBundlesService } from '../skill-bundles/skill-bundles.service.js'; // 运行时引用

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanService, type ScanRunPublic } from './scan.service.js'; // 运行时引用

interface CreateScanDto {
  projectId: string;
  codeVersionId: string;
  skillBundleId: string;
  aiKeyId?: string;
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
  constructor(
    private readonly scan: ScanService,
    private readonly skillBundles: SkillBundlesService,
    private readonly metrics: MetricsService,
  ) {}

  @Post('scan-runs')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateScanDto,
  ): Promise<ScanRunPublic> {
    const triggeredBy = user?.sub ?? 'unknown';
    const triggerType = body.triggerType ?? 'manual';
    const result = await this.scan.create({
      projectId: body.projectId,
      codeVersionId: body.codeVersionId,
      skillBundleId: body.skillBundleId,
      triggerType,
      triggeredBy,
      coverageMode: body.coverageMode,
      aiKeyId: body.aiKeyId,
    });
    // §10.3 —— scan_total 记录"创建"事件,status=queued
    // (finalize / cancel / failed 在 ScanRunnerService 中分别 inc)
    this.metrics.incScanTotal(body.projectId, 'queued', triggerType);
    return result;
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

  /**
   * §11 Q7 双轨 C —— "用最新 Skill 重扫" 显式按钮
   * 不复用原 run 的 skill_bundle_id,而是拿 SkillBundlesService.getDefault() 的当前默认
   */
  @Post('scan-runs/:id/replay-with-latest')
  async replayWithLatest(@Param('id') id: string): Promise<ScanRunPublic> {
    return this.scan.replayWithLatest(id, () => {
      const def = this.skillBundles.getDefault();
      return def ? { id: def.id } : null;
    });
  }

  @Post('scan-runs/:id/recompute-coverage')
  recomputeCoverage(@Param('id') id: string): ScanRunPublic {
    return this.scan.recomputeCoverage(id);
  }
}
