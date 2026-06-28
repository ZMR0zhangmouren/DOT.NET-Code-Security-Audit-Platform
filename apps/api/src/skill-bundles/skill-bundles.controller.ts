import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SkillBundlesService, type SkillBundleVersionPublic } from './skill-bundles.service.js'; // runtime ref (NestJS DI)

interface PublishDto {
  note?: string | null;
}

/**
 * §11 Q7 双轨 C —— SkillBundleVersion 端点
 *
 * - GET    /api/skill-bundle-versions[?active=true]     列表(老接口)
 * - GET    /api/skill-bundle-versions/_/default         拿当前默认 bundle
 * - GET    /api/skill-bundle-versions/:id               查单个
 * - POST   /api/skill-bundle-versions/:id/set-default   切默认
 * - POST   /api/skill-bundle-versions/:id/publish        发布(标 is_active + published_at)
 *
 * set-default / publish 是 Phase 2 §5.6 前期落地,后续接 UI。
 */
@Controller('skill-bundle-versions')
@UseGuards(JwtAuthGuard)
export class SkillBundlesController {
  constructor(private readonly bundles: SkillBundlesService) {}

  @Get()
  list(@Query('active') active?: string): SkillBundleVersionPublic[] {
    return this.bundles.list({ activeOnly: active === 'true' });
  }

  @Get('_/default')
  default(): { id: string | null; bundle: SkillBundleVersionPublic | null } {
    const bundle = this.bundles.getDefault();
    return { id: bundle?.id ?? null, bundle };
  }

  @Get(':id')
  get(@Param('id') id: string): SkillBundleVersionPublic {
    const found = this.bundles.getById(id);
    if (!found) throw new NotFoundException(`skillBundle ${id} not found`);
    return found;
  }

  @Post(':id/set-default')
  setDefault(@Param('id') id: string): SkillBundleVersionPublic {
    return this.bundles.setDefault(id);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Body() body: PublishDto = {}): SkillBundleVersionPublic {
    return this.bundles.publish(id, body.note ?? null);
  }
}
