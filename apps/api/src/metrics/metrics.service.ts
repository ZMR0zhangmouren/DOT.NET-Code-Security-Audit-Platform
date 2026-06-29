import { Injectable } from '@nestjs/common';
import type { ScanRunStatus, Severity } from '@platform/shared';
import { Counter, Histogram, register } from 'prom-client';

/**
 * §10.3 Prometheus 业务 metric 集中管理(MVP)
 *
 * 设计取舍(详见 CLAUDE.md / 决策记录):
 *   - 不用 @InjectMetric + decorator 模式 —— 集中一个 Service 里更易 mock + 单测
 *   - 4 类 metric 类型都在一个 service 暴露 —— Counter/Histogram/Gauge
 *   - 复用 prom-client 默认 `register`(全局单例)
 *
 * 边界:不接真 Prometheus server / Grafana / PromQL
 */
@Injectable()
export class MetricsService {
  private readonly scanTotal: Counter<'project' | 'status' | 'triggerType'>;
  private readonly scanDurationSeconds: Histogram<'triggerType'>;
  private readonly vulnFoundTotal: Counter<'severity' | 'vulnType'>;
  private readonly agentCallTotal: Counter<'model' | 'tool'>;
  private readonly agentTokenUsedTotal: Counter<'model' | 'type'>;

  constructor() {
    this.scanTotal = new Counter({
      name: 'scan_total',
      help: 'Total number of scan runs by final status',
      labelNames: ['project', 'status', 'triggerType'] as const,
      registers: [register],
    });

    // 桶选择:30s/60s/120s/300s —— 适配 §5.3 实测 115s 平均扫描耗时
    // (§2.8 覆盖门禁 + §5.3 Agent 完整跑通 ~115s),P95 落在 120-300s 桶
    this.scanDurationSeconds = new Histogram({
      name: 'scan_duration_seconds',
      help: 'Scan run duration in seconds (from kickoff starting → finalize)',
      labelNames: ['triggerType'] as const,
      buckets: [30, 60, 120, 300],
      registers: [register],
    });

    this.vulnFoundTotal = new Counter({
      name: 'vuln_found_total',
      help: 'Total number of vulnerabilities recorded by agent (counted at recordVulnerability success)',
      labelNames: ['severity', 'vulnType'] as const,
      registers: [register],
    });

    this.agentCallTotal = new Counter({
      name: 'agent_call_total',
      help: 'Total number of OpenAI tool calls invoked by scan agent',
      labelNames: ['model', 'tool'] as const,
      registers: [register],
    });

    this.agentTokenUsedTotal = new Counter({
      name: 'agent_token_used_total',
      help: 'Total OpenAI tokens used by scan agent (prompt + completion separately labeled)',
      labelNames: ['model', 'type'] as const,
      registers: [register],
    });
  }

  /** scan_total.inc —— scan create / finalize / cancel / failed */
  incScanTotal(project: string, status: ScanRunStatus, triggerType: string): void {
    this.scanTotal.inc({ project, status, triggerType });
  }

  /** scan_duration_seconds —— 在 runScan 入口 startTimer, finalize/cancel/fail 时 observe */
  startScanDurationTimer(triggerType: string): () => number {
    const end = this.scanDurationSeconds.startTimer({ triggerType });
    return () => {
      const seconds = end();
      return seconds;
    };
  }

  /** vuln_found_total —— CodeFileSystem.recordVulnerability 成功时 inc */
  incVulnFound(severity: Severity, vulnType: string): void {
    this.vulnFoundTotal.inc({ severity, vulnType });
  }

  /** agent_call_total —— scan-runner 主循环每次 tool call 时 inc */
  incAgentCall(model: string, tool: string): void {
    this.agentCallTotal.inc({ model, tool });
  }

  /** agent_token_used_total —— scan-runner OpenAI response.usage.prompt_tokens / completion_tokens */
  addAgentTokens(model: string, type: 'prompt' | 'completion', count: number): void {
    if (count > 0) this.agentTokenUsedTotal.inc({ model, type }, count);
  }
}
