import { COVERAGE_MODE, type CoverageMode } from '@platform/shared';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * 根组件 —— MVP 起步。
 *
 * 后续按 需求文档.md §9 路由表逐步替换为:
 * - /login 登录
 * - /projects 项目列表
 * - /projects/:id 项目详情
 * - /projects/:id/scans/:runId 实时扫描
 * - /projects/:id/scans/:runId/report 报告
 * - /projects/:id/vuln-library 漏洞库列表
 * - /admin/* 系统配置
 *
 * 当前仅展示一个健康检查 UI,验证 nest + vite + shadcn 全链路通。
 */
interface HealthPayload {
  status: 'ok';
  uptimeSec: number;
  coverageModeDefault: CoverageMode;
  nodeVersion: string;
}

export default function App(): React.ReactElement {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setHealth(d as HealthPayload))
      .catch((e: Error) => setErr(e.message));
  }, []);

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-12">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">.NET 代码安全审计平台</h1>
        <p className="mt-2 text-muted-foreground">
          基于 <code className="font-mono">@openai/agents</code> + NestJS + React
        </p>
      </header>

      <section className="w-full max-w-md rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">后端连通性</h2>
        {err && (
          <p className="text-sm text-destructive">
            后端不可达:<code className="font-mono">{err}</code>
          </p>
        )}
        {health && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">状态</dt>
            <dd className="font-mono">{health.status}</dd>
            <dt className="text-muted-foreground">运行时长</dt>
            <dd className="font-mono">{health.uptimeSec}s</dd>
            <dt className="text-muted-foreground">coverage_mode 默认</dt>
            <dd className="font-mono">{health.coverageModeDefault}</dd>
            <dt className="text-muted-foreground">Node 版本</dt>
            <dd className="font-mono">{health.nodeVersion}</dd>
          </dl>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          本地枚举对齐需求文档 §11 决策:Q14 (@openai/agents) / Q15 (漏洞库 + 实例) / Q16
          (fingerprint) / Q17 (编排不在平台侧)
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          可用 coverage_mode:<code className="font-mono">{COVERAGE_MODE.join(' / ')}</code>
        </p>
      </section>

      <Button
        onClick={() => window.location.reload()}
        variant="outline"
        data-testid="reload-button"
      >
        重新探测
      </Button>
    </main>
  );
}
