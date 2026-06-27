import { Module } from '@nestjs/common';

import { AgentsPocController } from './agents.controller.js';

@Module({
  controllers: [AgentsPocController],
})
export class AgentsModule {}
