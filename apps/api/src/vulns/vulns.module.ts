import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';

import { VulnLibraryService } from './vuln-library.service.js';
import { VulnService } from './vuln.service.js';
import { VulnsController } from './vulns.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [VulnsController],
  providers: [VulnLibraryService, VulnService],
  exports: [VulnLibraryService, VulnService],
})
export class VulnsModule {}
