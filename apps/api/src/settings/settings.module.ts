import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../db/database.module.js';

import { GitCredentialsController } from './git-credentials.controller.js';
import { GitCredentialsService } from './git-credentials.service.js';
import { ProxyConfigController } from './proxy-config.controller.js';
import { ProxyConfigService } from './proxy-config.service.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [SettingsController, GitCredentialsController, ProxyConfigController],
  providers: [SettingsService, GitCredentialsService, ProxyConfigService],
  exports: [SettingsService, GitCredentialsService, ProxyConfigService],
})
export class SettingsModule {}
