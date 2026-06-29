import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';
import { StorageModule } from '../storage/storage.module.js';

import { SkillExecutorService } from './skill-executor.service.js';

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [SkillExecutorService],
  exports: [SkillExecutorService],
})
export class SkillsModule {}
