import { Controller, Get, Query } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SkillBundlesService, type SkillBundleVersionPublic } from './skill-bundles.service.js'; // runtime ref (NestJS DI)

/**
 * SkillBundleVersion 只读端点 —— 让前端"新建扫描"对话框能选 active bundle。
 * 实际修改/发布接口在 Phase 2(§5.6 SkillBundle 发布 UI)。
 */
@Controller('skill-bundle-versions')
export class SkillBundlesController {
  constructor(private readonly bundles: SkillBundlesService) {}

  @Get()
  list(@Query('active') active?: string): SkillBundleVersionPublic[] {
    return this.bundles.list({ activeOnly: active === 'true' });
  }
}
