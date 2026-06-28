import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';

import { SkillBundlesController } from './skill-bundles.controller.js';
import { SkillBundlesService } from './skill-bundles.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [SkillBundlesController],
  providers: [SkillBundlesService],
  exports: [SkillBundlesService],
})
export class SkillBundlesModule {}
