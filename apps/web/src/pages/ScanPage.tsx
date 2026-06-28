import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useScanSocket } from '@/hooks/useScanSocket';
import { api, ApiError } from '@/lib/api';
import { coverageClass, gateClass, scanStatusClass, type ScanRunPublic } from '@/lib/scanTypes';

/**
 * §5.3 路由 /projects/:id/scans/:runId —— 实时扫描详情页
 *
 * 数据流:
 * - 初次进入:GET /api/scan-runs/:runId 拉取最新状态
 * - status ∈ {queued, running}:每 2s 轮询一次 + 走 useScanSocket WebSocket
 * - status 为终态:停止轮询,继续接收 WebSocket 收尾
 * - Cancel:POST /api/scan-runs/:id/cancel
 * - Replay(Phase 2):POST /api/scan-runs/:id/replay
 */
export default function ScanPage(): React.ReactElement {
  const { id: projectId, runId } = useParams<{ id: string; runId: string }>();
  const navigate = useNavigate();

  const [run, setRun] = useState<ScanRunPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [acting, setActing] = useState<'cancel' | 'replay' | 'replay-with-latest' | null>(null);

  const { status: wsStatus, logs, lastProgress, poke } = useScanSocket(runId ?? null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  async function refresh(): Promise<void> {
    if (!runId) return;
    try {
      const data = await api.get<ScanRunPublic>(`/scan-runs/${runId}`);
      setRun(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // status ∈ {queued, running} 时 2s 轮询
  useEffect(() => {
    if (!run) return;
    if (run.status !== 'queued' && run.status !== 'running') return;
    const t = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, runId]);

  // 日志自动滚到底
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  async function onCancel(): Promise<void> {
    if (!runId) return;
    if (!confirm('Cancel this scan?')) return;
    setActing('cancel');
    try {
      await api.post(`/scan-runs/${runId}/cancel`);
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setActing(null);
    }
  }

  async function onReplay(): Promise<void> {
    if (!runId) return;
    setActing('replay');
    try {
      const fresh = await api.post<ScanRunPublic>(`/scan-runs/${runId}/replay`);
      // 跳到新的 ScanRun
      navigate(`/projects/${projectId ?? fresh.projectId}/scans/${fresh.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
      setActing(null);
    }
  }

  // §11 Q7 双轨 C —— 用最新 Skill 重扫
  async function onReplayWithLatest(): Promise<void> {
    if (!runId) return;
    setActing('replay-with-latest');
    try {
      const fresh = await api.post<ScanRunPublic>(`/scan-runs/${runId}/replay-with-latest`);
      navigate(`/projects/${projectId ?? fresh.projectId}/scans/${fresh.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
      setActing(null);
    }
  }

  const isTerminal =
    run?.status === 'succeeded' || run?.status === 'failed' || run?.status === 'canceled';

  const percent = lastProgress?.scanRunId === runId && lastProgress ? lastProgress.percent : null;
  const stage =
    lastProgress?.scanRunId === runId && lastProgress ? lastProgress.currentStage : null;

  return (
    <main className="container py-8">
      <header className="mb-6">
        <Link
          to={`/projects/${projectId ?? ''}`}
          className="text-sm text-muted-foreground underline"
        >
          ← Project Detail
        </Link>

        {loading && <p className="mt-2 text-sm text-muted-foreground">Loading...</p>}
        {err && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {err}
          </p>
        )}

        {run && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">Scan #{run.id}</h1>
            <span
              className={`rounded px-2 py-0.5 text-xs ${scanStatusClass(run.status)}`}
              data-testid="scan-status"
            >
              {run.status}
            </span>
            <Link
              to={`/projects/${projectId}/scans/${runId}/report`}
              className="rounded border bg-card px-3 py-1 text-xs hover:underline"
              data-testid="view-report"
            >
              View Report (§5.4) →
            </Link>
            <span
              className={`rounded px-2 py-0.5 text-xs ${gateClass(run.gateDecision)}`}
              data-testid="scan-gate"
            >
              gate: {run.gateDecision}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs ${coverageClass(run.apiCoverageStatus)}`}
              data-testid="scan-api-coverage"
            >
              api: {run.apiCoverageStatus}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(run.queuedAt).toLocaleString()}
              {run.startedAt !== null &&
                ` · started ${new Date(run.startedAt).toLocaleTimeString()}`}
              {run.durationSec !== null && ` · ${run.durationSec}s`}
            </span>
          </div>
        )}

        {run && (
          <p className="mt-2 text-xs text-muted-foreground">
            codeVersion: <span className="font-mono">{run.codeVersionId}</span> · skillBundle:{' '}
            <span className="font-mono">{run.skillBundleId}</span> · coverage: {run.coverageMode} ·
            trigger: {run.triggerType} · by {run.triggeredBy}
          </p>
        )}
      </header>

      {run && (
        <section className="space-y-4">
          {/* 进度条 */}
          <div className="rounded-lg border bg-card p-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Progress</span>
              <span className="text-xs text-muted-foreground" data-testid="scan-progress-text">
                {percent !== null ? `${percent}% · ${stage ?? ''}` : 'waiting for runner...'}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary transition-[width]"
                style={{ width: percent !== null ? `${percent}%` : '0%' }}
                data-testid="scan-progress-bar"
              />
            </div>
            {run.errorMessage !== null && (
              <p
                className="mt-3 rounded bg-destructive/10 p-2 text-xs text-destructive"
                data-testid="scan-error"
              >
                {run.errorMessage}
              </p>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2">
            {run.status === 'running' || run.status === 'queued' ? (
              <Button
                variant="destructive"
                disabled={acting === 'cancel'}
                onClick={() => {
                  void onCancel();
                }}
                data-testid="scan-cancel"
              >
                {acting === 'cancel' ? 'Canceling...' : 'Cancel Scan'}
              </Button>
            ) : null}
            {isTerminal && (
              <Button
                variant="outline"
                disabled={acting === 'replay'}
                onClick={() => {
                  void onReplay();
                }}
                data-testid="scan-replay"
              >
                {acting === 'replay' ? 'Replaying...' : 'Re-run (Replay)'}
              </Button>
            )}
            {isTerminal && (
              <Button
                variant="outline"
                disabled={acting === 'replay-with-latest'}
                onClick={() => {
                  void onReplayWithLatest();
                }}
                data-testid="scan-replay-with-latest"
              >
                {acting === 'replay-with-latest' ? 'Replaying...' : 'Replay (Latest Skill)'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                void refresh();
              }}
              data-testid="scan-refresh"
            >
              Refresh
            </Button>
          </div>

          {/* 日志流 */}
          <div className="rounded-lg border bg-card p-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">Real-time Log (最近 100 条)</span>
              <span className="text-xs text-muted-foreground" data-testid="ws-status">
                ws: {wsStatus}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={poke}
                disabled={wsStatus !== 'connected'}
                data-testid="scan-poke"
              >
                测试连接
              </Button>
            </div>
            <pre className="h-64 overflow-auto rounded bg-muted p-3 text-xs" data-testid="scan-log">
              {logs.length === 0
                ? '[INFO] waiting for scan:log events...\n[INFO] ws status: ' + wsStatus + '\n'
                : logs
                    .map(
                      (l) =>
                        `[${l.level.toUpperCase()}] ${new Date(l.ts).toISOString()} ${l.message}`,
                    )
                    .join('\n')}
              <div ref={logEndRef} />
            </pre>
          </div>

          {/* Phase 2 占位 —— 报告 */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-2 text-sm font-medium">Report (Phase 2)</h2>
            <p className="text-xs text-muted-foreground">
              reportPath:{' '}
              <span className="font-mono">
                {run.reportPath !== null ? run.reportPath : '(pending)'}
              </span>{' '}
              · logPath:{' '}
              <span className="font-mono">{run.logPath !== null ? run.logPath : '(pending)'}</span>{' '}
              · outputRoot: <span className="font-mono">{run.outputRoot}</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              报告页占位;Phase 2 接 GET /api/scan-runs/:id/report 下载。
            </p>
          </div>

          {/* Quality Gates 概览(§2.8) */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="mb-2 text-sm font-medium">Quality Gates (§2.8)</h2>
            <dl className="grid grid-cols-[160px_1fr] gap-2 text-xs">
              <dt className="text-muted-foreground">audit surface</dt>
              <dd>{run.auditSurfaceStatus}</dd>
              <dt className="text-muted-foreground">api coverage</dt>
              <dd>{run.apiCoverageStatus}</dd>
              <dt className="text-muted-foreground">pipeline execution</dt>
              <dd>{run.pipelineExecution}</dd>
              <dt className="text-muted-foreground">gate decision</dt>
              <dd>{run.gateDecision}</dd>
              <dt className="text-muted-foreground">controller coverage</dt>
              <dd>
                {run.controllerCoveragePercent !== null ? `${run.controllerCoveragePercent}%` : '-'}
              </dd>
              <dt className="text-muted-foreground">auth coverage</dt>
              <dd>{run.authCoveragePercent !== null ? `${run.authCoveragePercent}%` : '-'}</dd>
            </dl>
          </div>
        </section>
      )}
    </main>
  );
}
