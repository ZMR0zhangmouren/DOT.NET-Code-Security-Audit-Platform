import { Registry } from 'prom-client';
import { describe, it, expect, beforeEach } from 'vitest';

import { MetricsService } from './metrics.service.js';

// §10.3 —— MetricsService 单测:
//   - 不依赖真 Prometheus server / Grafana
//   - 用 prom-client Registry() 单例验证 metric 形态、inc/observe 后 register 输出
//   - 不污染全局 register(用独立 Registry 实例 + service ctor 注入)

describe('MetricsService (§10.3)', () => {
  let registry: Registry;
  let svc: MetricsService;

  beforeEach(() => {
    registry = new Registry();
    svc = new MetricsService(registry);
  });

  it('注册 metric 后 register 输出含 # HELP / # TYPE 段', async () => {
    svc.incScanTotal('p1', 'queued', 'manual');
    const out = await registry.metrics();
    expect(out).toMatch(/# HELP scan_total/);
    expect(out).toMatch(/# TYPE scan_total counter/);
    expect(out).toMatch(/# HELP scan_duration_seconds/);
    expect(out).toMatch(/# TYPE scan_duration_seconds histogram/);
    expect(out).toMatch(/# HELP vuln_found_total/);
    expect(out).toMatch(/# HELP agent_call_total/);
    expect(out).toMatch(/# HELP agent_token_used_total/);
  });

  it('scan_total inc 3 次 → register 输出含 scan_total{...} 3', async () => {
    svc.incScanTotal('p1', 'succeeded', 'manual');
    svc.incScanTotal('p1', 'succeeded', 'manual');
    svc.incScanTotal('p1', 'succeeded', 'manual');
    const out = await registry.metrics();
    // prom-client 输出格式:scan_total{project="p1",status="succeeded",triggerType="manual"} 3
    expect(out).toMatch(/scan_total\{project="p1",status="succeeded",triggerType="manual"\} 3/);
  });

  it('scan_total 不同 label 组合独立计数', async () => {
    svc.incScanTotal('p1', 'queued', 'manual');
    svc.incScanTotal('p1', 'queued', 'manual');
    svc.incScanTotal('p1', 'succeeded', 'manual');
    svc.incScanTotal('p2', 'failed', 'replay');
    const out = await registry.metrics();
    expect(out).toMatch(/scan_total\{project="p1",status="queued",triggerType="manual"\} 2/);
    expect(out).toMatch(/scan_total\{project="p1",status="succeeded",triggerType="manual"\} 1/);
    expect(out).toMatch(/scan_total\{project="p2",status="failed",triggerType="replay"\} 1/);
  });

  it('scan_duration_seconds histogram buckets 范围 30-300', async () => {
    const endTimer = svc.startScanDurationTimer('manual');
    endTimer();
    const out = await registry.metrics();
    // le="30" / le="60" / le="120" / le="300" / le="+Inf" 桶都应输出
    // (prom-client 输出顺序固定:le 在 triggerType 前面)
    expect(out).toMatch(/scan_duration_seconds_bucket\{le="30",triggerType="manual"\}/);
    expect(out).toMatch(/scan_duration_seconds_bucket\{le="60",triggerType="manual"\}/);
    expect(out).toMatch(/scan_duration_seconds_bucket\{le="120",triggerType="manual"\}/);
    expect(out).toMatch(/scan_duration_seconds_bucket\{le="300",triggerType="manual"\}/);
    expect(out).toMatch(/scan_duration_seconds_bucket\{le="\+Inf",triggerType="manual"\}/);
    // count / sum 也输出
    expect(out).toMatch(/scan_duration_seconds_count\{triggerType="manual"\}/);
    expect(out).toMatch(/scan_duration_seconds_sum\{triggerType="manual"\}/);
  });

  it('vuln_found_total 按 severity + vulnType 累加', async () => {
    svc.incVulnFound('H', 'sqli');
    svc.incVulnFound('H', 'sqli');
    svc.incVulnFound('C', 'xss');
    const out = await registry.metrics();
    expect(out).toMatch(/vuln_found_total\{severity="H",vulnType="sqli"\} 2/);
    expect(out).toMatch(/vuln_found_total\{severity="C",vulnType="xss"\} 1/);
  });

  it('agent_call_total 按 model + tool 累加', async () => {
    svc.incAgentCall('gpt-4o', 'readFile');
    svc.incAgentCall('gpt-4o', 'readFile');
    svc.incAgentCall('gpt-4o', 'searchCode');
    const out = await registry.metrics();
    expect(out).toMatch(/agent_call_total\{model="gpt-4o",tool="readFile"\} 2/);
    expect(out).toMatch(/agent_call_total\{model="gpt-4o",tool="searchCode"\} 1/);
  });

  it('agent_token_used_total 按 model + type 累加', async () => {
    svc.addAgentTokens('gpt-4o', 'prompt', 1234);
    svc.addAgentTokens('gpt-4o', 'prompt', 500);
    svc.addAgentTokens('gpt-4o', 'completion', 200);
    const out = await registry.metrics();
    expect(out).toMatch(/agent_token_used_total\{model="gpt-4o",type="prompt"\} 1734/);
    expect(out).toMatch(/agent_token_used_total\{model="gpt-4o",type="completion"\} 200/);
  });

  it('agent_token_used_total count <= 0 时不 inc(避免负值干扰 rate)', async () => {
    svc.addAgentTokens('gpt-4o', 'prompt', 0);
    svc.addAgentTokens('gpt-4o', 'completion', -5);
    const out = await registry.metrics();
    // 没 inc 任何 token,不应出现 agent_token_used_total{...} <n>
    expect(out).not.toMatch(/agent_token_used_total\{/);
  });
});
