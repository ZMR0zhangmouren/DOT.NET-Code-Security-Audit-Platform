import { Module } from '@nestjs/common';

import { ScanGateway } from './scan.gateway.js';

@Module({
  providers: [ScanGateway],
  exports: [ScanGateway],
})
export class RealtimeModule {}
