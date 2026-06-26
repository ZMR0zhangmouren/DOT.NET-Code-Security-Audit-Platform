import { Controller, Get } from '@nestjs/common';
import { COVERAGE_MODE } from '@platform/shared';

/**
 * 健康检查端点 —— MVP 起步验证 nest 启动正常。
 * 后续将扩展为 readiness / liveness / 子仓库绑定状态等更细粒度的诊断。
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): {
    status: 'ok';
    uptimeSec: number;
    coverageModeDefault: (typeof COVERAGE_MODE)[number];
    nodeVersion: string;
  } {
    return {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      coverageModeDefault: COVERAGE_MODE[0],
      nodeVersion: process.version,
    };
  }
}
