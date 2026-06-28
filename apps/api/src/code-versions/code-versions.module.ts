import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../db/database.module.js';
import { StorageModule } from '../storage/storage.module.js';

import { CodeVersionsController } from './code-versions.controller.js';
import { CodeVersionsService } from './code-versions.service.js';

@Module({
  imports: [DatabaseModule, StorageModule, AuthModule],
  controllers: [CodeVersionsController],
  providers: [CodeVersionsService],
  exports: [CodeVersionsService],
})
export class CodeVersionsModule {}
