import { Controller, Get } from '@nestjs/common';

/**
 * §11 Q6 + §11 Q13 —— Queue Board 的 NestJS 端点
 *
 * 注意:Bull-Board UI/API 实际由 ExpressAdapter(在 main.ts 挂到 /admin/queue 上)
 * 直接服务,不走 NestJS 路由。本 controller 仅提供一个轻量 JSON 健康端点,
 * 让集成测试和 NestJS 路由表能验证 module 已被加载,以及供运维查队列摘要。
 *
 * 路径:`/api/admin/queue/health`(因为 app.setGlobalPrefix('api'))。
 *
 * 鉴权(Phase 2 启用):
 *   - Bull-Board UI(/admin/queue)由 main.ts 的 QueueBoardAuthMiddleware 守护
 *     (JWT admin OR Basic admin/admin → 401)
 *   - 本 controller(/api/admin/queue/health)暂不加 @UseGuards,留 Phase 2 接
 *     全局 JWT 鉴权时一起挂(避免在 QueueBoardModule 单独挂触发 Reflector 解析时序问题)
 *   - 实际生产环境:此 controller 是 admin-only 工具端点,Phase 2 用 APP_GUARD 全局挂载
 */
@Controller('admin/queue')
export class QueueBoardController {
  @Get('health')
  health(): { ok: true; path: string } {
    return { ok: true, path: '/admin/queue' };
  }
}
