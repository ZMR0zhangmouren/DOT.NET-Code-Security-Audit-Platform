import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ProxyConfigService, type ProxyConfigPublic } from './proxy-config.service.js'; // ProxyConfigService 需运行时引用(NestJS DI)

interface UpsertDto {
  protocol: 'http' | 'https' | 'socks5' | null;
  host: string | null;
  port: number | null;
  username?: string | null;
  password?: string | null;
  applyTo: 'all' | 'http_only' | 'all_outbound';
  isActive: boolean;
}

/**
 * §5.7 Proxy Config 端点 —— 单条全局配置 + 测试连通性。
 *
 * 端点:
 * - GET    /api/admin/proxy       读当前配置(无则 200 + 直连占位)
 * - PATCH  /api/admin/proxy       upsert(总是覆盖唯一行)
 * - POST   /api/admin/proxy/test  测连通性,失败时 testStatus=failed + testMessage
 */
@Controller('admin/proxy')
export class ProxyConfigController {
  constructor(private readonly proxy: ProxyConfigService) {}

  @Get()
  get(): ProxyConfigPublic | null {
    return this.proxy.getCurrent();
  }

  @Patch()
  upsert(@Req() req: Request, @Body() body: UpsertDto): ProxyConfigPublic {
    const headerUser = req.headers['x-user-id'] as string | undefined;
    const userId =
      (req as Request & { user?: { sub?: string } }).user?.sub ?? headerUser ?? 'unknown';
    return this.proxy.upsert({ ...body, updatedBy: userId });
  }

  @Post('test')
  async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    return this.proxy.testConnection();
  }
}
