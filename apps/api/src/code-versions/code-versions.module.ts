import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';
import { StorageModule } from '../storage/storage.module.js';

import { CodeVersionsController } from './code-versions.controller.js';
import { CodeVersionsService } from './code-versions.service.js';

@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [CodeVersionsController],
  providers: [CodeVersionsService],
  exports: [CodeVersionsService],
})
export class CodeVersionsModule {}
