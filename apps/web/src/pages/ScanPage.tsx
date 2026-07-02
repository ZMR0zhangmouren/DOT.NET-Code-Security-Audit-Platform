import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useScanSocket } from '@/hooks/useScanSocket';
import { api, ApiError, getToken } from '@/lib/api';
import { coverageClass, gateClass, type ScanRunPublic } from '@/lib/scanTypes';

function statusVariant(status: string): 'info' | 'success' | 'destructive' | 'warning' | 'default' {
  switch (status) {
    case 'running':
      return 'info';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'destructive';
    case 'queued':
      return 'warning';
    default:
      return 'default';
  }
}

/**
 * §5.3 /projects/:id/scans/:runId —— 实时扫描详情
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

  useEffect(() => {
    if (!run) return;
    if (run.status !== 'queued' && run.status !== 'running') return;
    const t = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status, runId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  async function onCancel(): Promise<void> {
    if (!runId || !confirm('Cancel this scan?')) return;
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
      navigate(`/projects/${projectId ?? fresh.projectId}/scans/${fresh.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
      setActing(null);
    }
  }

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

  const [fileLogs, setFileLogs] = useState<string | null>(null);
  const isTerminal =
    run?.status === 'succeeded' || run?.status === 'failed' || run?.status === 'canceled';

  useEffect(() => {
    if (isTerminal && runId && run?.logPath) {
      fetch(`/api/scan-runs/${runId}/logs`, {
        headers: { authorization: `Bearer ${getToken() ?? ''}` },
      })
        .then((r) => (r.ok ? r.text() : ''))
        .then((t) => setFileLogs(t))
        .catch(() => {});
    }
  }, [isTerminal, runId, run?.logPath]);

  const percent = lastProgress && lastProgress.scanRunId === runId ? lastProgress.percent : null;
  const stage = lastProgress && lastProgress.scanRunId === runId ? lastProgress.currentStage : null;

  if (loading) {
    return (
      <main className="container py-6">
        <div className="space-y-4">
          <div className="h-8 w-48 rounded bg-muted animate-pulse" />
          <div className="h-4 w-64 rounded bg-muted animate-pulse" />
        </div>
      </main>
    );
  }

  return (
    <main className="container py-6">
      {err && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      <PageHeader
        title={run ? `扫描 #${run.id.slice(0, 8)}` : '扫描详情'}
        breadcrumbs={[
          { label: '项目列表', to: '/projects' },
          { label: '项目详情', to: `/projects/${projectId ?? ''}` },
        ]}
        badge={run && <StatusBadge label={run.status} variant={statusVariant(run.status)} />}
        actions={
          run
            ? [
                ...(run.status === 'running' || run.status === 'queued'
                  ? [
                      {
                        label: '取消扫描',
                        variant: 'destructive' as const,
                        onClick: () => void onCancel(),
                        disabled: acting === 'cancel',
                      },
                    ]
                  : []),
                ...(isTerminal
                  ? [
                      {
                        label: '重新扫描',
                        variant: 'outline' as const,
                        onClick: () => void onReplay(),
                        disabled: acting === 'replay',
                      },
                      {
                        label: '最新 Skill 重扫',
                        variant: 'outline' as const,
                        onClick: () => void onReplayWithLatest(),
                        disabled: acting === 'replay-with-latest',
                      },
                    ]
                  : []),
                { label: '刷新', variant: 'outline' as const, onClick: () => void refresh() },
              ]
            : []
        }
      />

      {run && (
        <div className="space-y-4">
          {/* 元信息 */}
          <Card className="glass-card">
            <CardContent className="flex flex-wrap gap-4 p-4 text-xs">
              <span className="text-muted-foreground">
                Version: <span className="font-mono">{run.codeVersionId.slice(0, 8)}...</span>
              </span>
              <span className="text-muted-foreground">
                Skill: <span className="font-mono">{run.skillBundleId.slice(0, 8)}...</span>
              </span>
              <span className="text-muted-foreground">
                Coverage:{' '}
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${coverageClass(run.apiCoverageStatus)}`}
                >
                  {run.coverageMode}
                </span>
              </span>
              <span className="text-muted-foreground">
                Gate:{' '}
                <span className={`rounded px-1.5 py-0.5 text-xs ${gateClass(run.gateDecision)}`}>
                  {run.gateDecision}
                </span>
              </span>
              <span className="text-muted-foreground">
                {new Date(run.queuedAt).toLocaleString()}
                {run.startedAt && ` · started ${new Date(run.startedAt).toLocaleTimeString()}`}
                {run.durationSec !== null && ` · ${run.durationSec}s`}
              </span>
            </CardContent>
          </Card>

          {/* 进度条 */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground" data-testid="scan-progress-text">
                  {percent !== null ? `${percent}% · ${stage ?? ''}` : 'waiting for runner...'}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all duration-500"
                  style={{ width: percent !== null ? `${percent}%` : '0%' }}
                  data-testid="scan-progress-bar"
                />
              </div>
              {run.errorMessage && (
                <p
                  className="mt-3 rounded bg-destructive/10 p-2 text-xs text-destructive"
                  data-testid="scan-error"
                >
                  {run.errorMessage}
                </p>
              )}
            </CardContent>
          </Card>

          {/* 实时日志 */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">实时日志 (最近 100 条)</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${wsStatus === 'connected' ? 'bg-success' : 'bg-destructive'}`}
                    />
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
              </div>
            </CardHeader>
            <CardContent>
              <pre
                className="h-64 overflow-auto rounded bg-[#0d1117] p-3 font-mono text-xs text-green-400"
                data-testid="scan-log"
              >
                {fileLogs && logs.length === 0
                  ? fileLogs
                  : logs.length === 0
                    ? `[INFO] waiting for scan:log events...\n[INFO] ws status: ${wsStatus}\n`
                    : logs
                        .map(
                          (l) =>
                            `[${l.level.toUpperCase()}] ${new Date(l.ts).toISOString()} ${l.message}`,
                        )
                        .join('\n')}
                <div ref={logEndRef} />
              </pre>
            </CardContent>
          </Card>

          {/* Quality Gates */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Quality Gates (§2.8)</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[160px_1fr] gap-2 text-xs">
                <dt className="text-muted-foreground">audit surface</dt>
                <dd>{run.auditSurfaceStatus}</dd>
                <dt className="text-muted-foreground">api coverage</dt>
                <dd>{run.apiCoverageStatus}</dd>
                <dt className="text-muted-foreground">pipeline execution</dt>
                <dd>{run.pipelineExecution}</dd>
                <dt className="text-muted-foreground">controller coverage</dt>
                <dd>
                  {run.controllerCoveragePercent !== null
                    ? `${(run.controllerCoveragePercent / 100).toFixed(2)}%`
                    : '-'}
                </dd>
                <dt className="text-muted-foreground">auth coverage</dt>
                <dd>
                  {run.authCoveragePercent !== null
                    ? `${(run.authCoveragePercent / 100).toFixed(2)}%`
                    : '-'}
                </dd>
              </dl>
            </CardContent>
          </Card>

          {/* 快捷链接 */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/scans/${runId}/report`)}
              data-testid="view-report"
            >
              View Report →
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/scans/${runId}/trace`)}
              data-testid="scan-view-trace"
            >
              View Agent Trace →
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
