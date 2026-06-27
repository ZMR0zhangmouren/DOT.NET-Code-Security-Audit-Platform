import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useScanSocket } from '@/hooks/useScanSocket';

/**
 * §9 路由 /projects/:id/scans/:runId —— 实时扫描页
 * 接入 useScanSocket(WebSocket §5.3);Phase 1 主流程接 ScanModule 后填充真实数据。
 */
export default function ScanPage(): React.ReactElement {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { status, logs, lastProgress, poke } = useScanSocket(runId ?? null);

  return (
    <main className="container py-8">
      <header className="mb-6">
        <Link to={`/projects/${id ?? ''}`} className="text-sm text-muted-foreground underline">
          ← 项目详情
        </Link>
        <h1 className="mt-2 text-3xl font-bold">实时扫描 #{runId}</h1>
        <p className="text-sm text-muted-foreground">
          §5.3 AI 代码审计 · WebSocket 状态:
          <span className="ml-2 font-mono" data-testid="ws-status">
            {status}
          </span>
        </p>
      </header>

      <section className="space-y-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">进度</span>
            <span className="text-xs text-muted-foreground">
              {lastProgress
                ? `${lastProgress.percent}% · ${lastProgress.currentStage}`
                : '等待 ScanRunner 推送...'}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-[width]"
              style={{ width: lastProgress ? `${lastProgress.percent}%` : '0%' }}
            />
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">日志流(最近 100 条)</span>
            <Button
              size="sm"
              variant="outline"
              onClick={poke}
              disabled={status !== 'connected'}
              data-testid="poke-button"
            >
              测试连接
            </Button>
          </div>
          <pre className="h-64 overflow-auto rounded bg-muted p-3 text-xs" data-testid="scan-log">
            {logs.length === 0
              ? '[INFO] 等待 ScanModule 接入 scan:log 推送...\n[INFO] 当前 /scans 网关已 ready,demo:poke 可发测试消息\n'
              : logs
                  .map(
                    (l) =>
                      `[${l.level.toUpperCase()}] ${new Date(l.ts).toISOString()} ${l.message}`,
                  )
                  .join('\n')}
          </pre>
        </div>

        <Button variant="destructive" disabled>
          取消扫描(Phase 1)
        </Button>
      </section>
    </main>
  );
}
