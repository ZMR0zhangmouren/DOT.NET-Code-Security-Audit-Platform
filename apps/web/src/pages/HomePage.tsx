import { COVERAGE_MODE, type CoverageMode } from '@platform/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

interface HealthPayload {
  status: 'ok';
  uptimeSec: number;
  coverageModeDefault: CoverageMode;
  nodeVersion: string;
  dbTables: number;
}

interface AgentsPayload {
  sdkInstalled: boolean;
}

/**
 * 首页 —— 替代之前的 App.tsx,作为 Router 出口;
 * 保留后端连通性卡片 + SDK 健康检查 + 路由入口。
 */
export default function HomePage(): React.ReactElement {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [agents, setAgents] = useState<AgentsPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setHealth(d as HealthPayload))
      .catch((e: Error) => setErr(e.message));

    fetch('/api/agents/poc/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setAgents(d as AgentsPayload))
      .catch(() => setAgents({ sdkInstalled: false }));
  }, []);

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-12">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">.NET 代码安全审计平台</h1>
        <p className="mt-2 text-muted-foreground">
          基于 <code className="font-mono">@openai/agents</code> + NestJS + React
        </p>
      </header>

      <section className="grid w-full max-w-2xl gap-4 md:grid-cols-2">
        <article className="rounded-lg border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">后端连通性</h2>
          {err && <p className="text-xs text-destructive">{err}</p>}
          {health && (
            <dl className="grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">状态</dt>
              <dd className="font-mono">{health.status}</dd>
              <dt className="text-muted-foreground">运行时长</dt>
              <dd className="font-mono">{health.uptimeSec}s</dd>
              <dt className="text-muted-foreground">DB 表数</dt>
              <dd className="font-mono">{health.dbTables}</dd>
              <dt className="text-muted-foreground">coverage_mode</dt>
              <dd className="font-mono">{health.coverageModeDefault}</dd>
            </dl>
          )}
        </article>
        <article className="rounded-lg border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">@openai/agents SDK</h2>
          {agents && (
            <dl className="grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">SDK 已安装</dt>
              <dd className="font-mono">{agents.sdkInstalled ? '✅' : '❌'}</dd>
              <dt className="text-muted-foreground">主 Agent</dt>
              <dd className="font-mono">dotnet代码审计</dd>
              <dt className="text-muted-foreground">总编排</dt>
              <dd className="font-mono">dotnet-audit-pipeline</dd>
            </dl>
          )}
        </article>
      </section>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link to="/projects">
          <Button variant="outline">项目列表</Button>
        </Link>
        <Link to="/login">
          <Button variant="ghost">登录</Button>
        </Link>
      </nav>

      <p className="text-xs text-muted-foreground">
        可用 coverage_mode:<code className="font-mono">{COVERAGE_MODE.join(' / ')}</code>
      </p>
    </main>
  );
}
