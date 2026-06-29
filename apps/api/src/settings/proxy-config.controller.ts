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
  async test(
    @Body() body?: Partial<UpsertDto>,
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    // 允许前端传临时配置(不保存到 DB),用于"没保存时也能测"
    if (body && body.protocol && body.host && body.port) {
      const start = Date.now();
      try {
        const ok = await this.proxy.testWithConfig({
          protocol: body.protocol,
          host: body.host,
          port: body.port,
          username: body.username ?? undefined,
          password: body.password ?? undefined,
        });
        return {
          ok,
          message: ok ? 'proxy reachable' : 'proxy unreachable',
          latencyMs: Date.now() - start,
        };
      } catch (e) {
        return { ok: false, message: (e as Error).message, latencyMs: Date.now() - start };
      }
    }
    return this.proxy.testConnection();
  }
}
