import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { SeverityBadge } from '@/components/SeverityBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface VulnLibraryEntry {
  id: string;
  projectId: string;
  vulnType: string;
  severityMax: 'C' | 'H' | 'M' | 'L';
  status: 'open' | 'fixing' | 'fixed' | 'wontfix' | 'ignored' | 'suppressed';
  title: string | null;
  tags: string[];
  occurrenceCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  fixedAt: number | null;
}

interface TrendBucket {
  period: string;
  total: number;
  bySeverity: Record<string, number>;
}

const SEV_LABELS: Record<string, string> = { C: 'Critical', H: 'High', M: 'Medium', L: 'Low' };
const SEV_COLORS: Record<string, string> = {
  C: 'bg-red-600',
  H: 'bg-orange-500',
  M: 'bg-yellow-500',
  L: 'bg-muted-foreground/40',
};

const SEVERITY_MAP: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  C: 'critical',
  H: 'high',
  M: 'medium',
  L: 'low',
};

const STATUS_VARIANT_MAP: Record<string, 'destructive' | 'warning' | 'success' | 'default'> = {
  open: 'destructive',
  fixing: 'warning',
  fixed: 'success',
  wontfix: 'default',
  ignored: 'default',
  suppressed: 'default',
};

/**
 * §5.5 /projects/:id/vuln-library —— 漏洞库列表(根因级)
 *
 * Phase 3 新增漏洞趋势图(§5.5 时间聚合)。
 * 接 /api/projects/:id/vuln-trend,按 day/week/month 展示 C/H/M/L 分层柱状图。
 */
export default function VulnLibraryPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [entries, setEntries] = useState<VulnLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Phase 3 trend
  const [trend, setTrend] = useState<TrendBucket[]>([]);
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');

  async function refresh(): Promise<void> {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const [data, t] = await Promise.all([
        api.get<VulnLibraryEntry[]>(`/projects/${id}/vuln-library`),
        api.get<TrendBucket[]>(`/projects/${id}/vuln-trend?granularity=${granularity}&days=30`),
      ]);
      setEntries(data);
      setTrend(t);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, granularity]);

  const maxTotal = trend.reduce((m, b) => Math.max(m, b.total), 0);

  return (
    <main className="container py-8">
      <PageHeader
        title="Vulnerability Library"
        description="Section 5.5 - root-cause vulnerabilities (fingerprint-grouped)"
        breadcrumbs={[{ label: 'Project', to: `/projects/${id ?? ''}` }]}
        actions={[{ label: 'Refresh', variant: 'outline', onClick: () => void refresh() }]}
      />

      {/* Phase 3 — 漏洞趋势图 */}
      {trend.length > 0 && (
        <Card className="mb-8 p-6" data-testid="trend-section">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Vulnerability Trend</h2>
            <div className="flex gap-1 rounded-md bg-muted p-0.5">
              {(['day', 'week'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1 text-xs font-medium rounded ${
                    granularity === g ? 'bg-background shadow-sm' : 'text-muted-foreground'
                  }`}
                >
                  {g === 'day' ? 'Daily' : 'Weekly'}
                </button>
              ))}
            </div>
          </div>

          {/* 柱状图 */}
          <div className="flex items-end gap-1 h-48" data-testid="trend-chart">
            {trend.map((b) => (
              <div
                key={b.period}
                className="flex-1 flex flex-col items-center justify-end min-w-0"
                title={`${b.period}: ${b.total} vulns${Object.entries(b.bySeverity)
                  .map(([s, n]) => ` ${SEV_LABELS[s] ?? s}×${n}`)
                  .join(',')}`}
              >
                <div className="w-full flex flex-col-reverse">
                  {maxTotal > 0 && (
                    <div
                      className="w-full rounded-t-sm"
                      style={{ height: `${Math.max((b.total / maxTotal) * 100, 1)}%` }}
                    >
                      {/* 堆叠色块 */}
                      {(['C', 'H', 'M', 'L'] as const).map((sev) => {
                        const n = b.bySeverity[sev] ?? 0;
                        if (n === 0) return null;
                        return (
                          <div
                            key={sev}
                            className={`w-full ${SEV_COLORS[sev]}`}
                            style={{ height: `${Math.max((n / b.total) * 100, 5)}%` }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
                {granularity === 'day' ? (
                  <span className="text-[10px] text-muted-foreground mt-1 truncate w-full text-center">
                    {b.period.slice(5)}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground mt-1 truncate w-full text-center">
                    {b.period.slice(5)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* 图例 */}
          <div className="flex gap-3 mt-3 text-xs text-muted-foreground">
            {(['C', 'H', 'M', 'L'] as const).map((sev) => (
              <span key={sev} className="flex items-center gap-1">
                <span className={`inline-block w-3 h-3 rounded ${SEV_COLORS[sev]}`} />
                {SEV_LABELS[sev]}
              </span>
            ))}
          </div>
        </Card>
      )}

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {loading ? (
        <div className="grid gap-3" data-testid="lib-list-loading">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Skeleton className="h-5 w-12" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
              <Skeleton className="h-3 w-4/5 mt-2" />
            </Card>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card className="p-6" data-testid="lib-empty">
          <p className="text-sm text-muted-foreground">
            No library entries. Run a scan to populate the library.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-3" data-testid="lib-list">
          {entries.map((e) => (
            <li key={e.id} data-testid="lib-row">
              <Card className="p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <Link
                      to={`/projects/${id}/vuln-library/${e.id}`}
                      className="text-lg font-semibold hover:underline"
                      data-testid="lib-title"
                    >
                      {e.title ?? `${e.vulnType} vulnerability`}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {e.vulnType} · ID <code className="font-mono">{e.id.slice(0, 16)}…</code>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs">
                    <SeverityBadge
                      severity={SEVERITY_MAP[e.severityMax] ?? 'info'}
                      data-testid="lib-severity"
                    />
                    <StatusBadge
                      label={e.status}
                      variant={STATUS_VARIANT_MAP[e.status]}
                      data-testid="lib-status"
                    />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  First seen {new Date(e.firstSeenAt).toLocaleDateString()} · Last seen{' '}
                  {new Date(e.lastSeenAt).toLocaleDateString()} · Occurrences: {e.occurrenceCount}
                  {e.tags.length > 0 && <> · Tags: {e.tags.join(', ')}</>}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
