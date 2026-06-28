import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt.strategy.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';

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
 * 鉴权:GET 任何已登录用户;PATCH / test 仅 admin
 */
@Controller('admin/proxy')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProxyConfigController {
  constructor(private readonly proxy: ProxyConfigService) {}

  @Get()
  get(): ProxyConfigPublic | null {
    return this.proxy.getCurrent();
  }

  @Patch()
  @Roles('admin')
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() body: UpsertDto): ProxyConfigPublic {
    const updatedBy = user?.sub ?? 'unknown';
    return this.proxy.upsert({ ...body, updatedBy });
  }

  @Post('test')
  @Roles('admin')
  async test(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    return this.proxy.testConnection();
  }
}
