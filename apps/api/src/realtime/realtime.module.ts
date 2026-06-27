import { Module } from '@nestjs/common';

import { ScanGateway } from './scan.gateway.js';

@Module({
  providers: [ScanGateway],
})
export class RealtimeModule {}
