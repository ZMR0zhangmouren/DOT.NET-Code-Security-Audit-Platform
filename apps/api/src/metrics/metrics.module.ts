import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

import { MetricsService } from './metrics.service.js';

/**
 * §10.3 Prometheus 监控(MVP 落地)
 *
 * 提供:
 *   - /api/metrics scrape endpoint(由 PrometheusModule 内置 controller 暴露,
 *     路径通过 path 配置与全局 /api 前缀拼接 → /api/metrics)
 *   - 默认 metrics(CPU / memory / event loop lag / GC / ... 由 prom-client 内置)
 *   - 业务 metrics:
 *     - scan_total{project, status, triggerType}       counter
 *     - scan_duration_seconds{triggerType}              histogram (30/60/120/300s buckets)
 *     - vuln_found_total{severity, vulnType}            counter
 *     - agent_call_total{model, tool}                   counter
 *     - agent_token_used_total{model, type}             counter (type=prompt|completion)
 *
 * 端点鉴权:NestJS JwtAuthGuard 是 per-controller 而不是 global(见 src/auth/jwt-auth.guard.ts),
 * Prometheus 内置 controller 不挂任何 guard,所以 /api/metrics 默认开放。
 * §6.5 已锁定 API 仅监听 127.0.0.1,不暴露公网 —— Prometheus scraper 在内网直连即可。
 *
 * 不接真 Prometheus server / Grafana —— 只暴露 metrics endpoint,
 * 集成由运维在 Phase 4 自行接 Prometheus server + Grafana dashboard。
 */
@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics', // setGlobalPrefix('api') 在 main.ts → 最终 /api/metrics
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
