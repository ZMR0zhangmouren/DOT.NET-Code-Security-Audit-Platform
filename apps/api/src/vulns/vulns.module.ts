import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../db/database.module.js';

import { VulnLibraryService } from './vuln-library.service.js';
import { VulnService } from './vuln.service.js';
import { VulnsController } from './vulns.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [VulnsController],
  providers: [VulnLibraryService, VulnService],
  exports: [VulnLibraryService, VulnService],
})
export class VulnsModule {}
