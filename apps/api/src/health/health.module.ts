import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';

import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule], // DATABASE token 来自这里
  controllers: [HealthController],
})
export class HealthModule {}
