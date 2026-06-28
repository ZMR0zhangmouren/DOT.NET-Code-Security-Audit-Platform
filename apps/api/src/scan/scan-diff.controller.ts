import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ScanDiffService } from './scan-diff.service.js'; // runtime ref (NestJS DI)
import type { ScanDiff } from './scan-diff.util.js';

/**
 * §5.4 多 ScanRun 报告对比 API
 *
 *  - GET /api/projects/:id/scans/diff?a=<runAId>&b=<runBId>
 *
 *    返回 ScanDiff(JSON),详见 scan-diff.util.ts 的 ScanDiff 接口。
 *
 * 校验:
 *   - a / b 必须非空、互不相等
 *   - a / b 都属于 :id 项目(在 service 里校验)
 */
@Controller('projects/:id/scans')
export class ScanDiffController {
  constructor(private readonly svc: ScanDiffService) {}

  @Get('diff')
  diff(
    @Param('id') projectId: string,
    @Query('a') aId: string | undefined,
    @Query('b') bId: string | undefined,
  ): ScanDiff {
    if (!aId || !bId) {
      throw new BadRequestException('both query params a and b are required');
    }
    return this.svc.diff(projectId, aId, bId);
  }
}
