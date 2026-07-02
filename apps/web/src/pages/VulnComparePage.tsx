import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { SeverityBadge } from '@/components/SeverityBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { type ScanRunPublic } from '@/lib/scanTypes';

// ---------------------------------------------------------------------------
// 5.4 diff 接口类型 —— 与 DiffPage.tsx / apps/api/src/scan/scan-diff.util.ts 一致
// ---------------------------------------------------------------------------

interface VulnSummary {
  id: string;
  fingerprint: string;
  vulnType: string;
  severity: 'C' | 'H' | 'M' | 'L';
  filePath: string;
  lineStart: number;
  status: 'open' | 'fixing' | 'fixed' | 'wontfix' | 'ignored';
}

interface VulnInBoth {
  fingerprint: string;
  vulnType: string;
  filePath: string;
  inA: VulnSummary;
  inB: VulnSummary;
  severityChanged: 'upgraded' | 'downgraded' | 'unchanged';
  statusChanged: boolean;
}

interface VulnLibrarySummary {
  id: string;
  fingerprint: string;
  vulnType: string;
  severityMax: 'C' | 'H' | 'M' | 'L';
  status: string;
  title: string | null;
}

interface ScanDiffRunSummary {
  id: string;
  status: ScanRunPublic['status'];
  startedAt: number | null;
  apiCoverageStatus: 'NOT_RUN' | 'PARTIAL' | 'COMPLETE';
  gateDecision: 'PASS' | 'BLOCKED' | 'PENDING';
  vulnCount: number;
}

interface ScanDiff {
  projectId: string;
  runA: ScanDiffRunSummary;
  runB: ScanDiffRunSummary;
  vulnerabilities: {
    onlyInA: VulnSummary[];
    onlyInB: VulnSummary[];
    inBoth: VulnInBoth[];
  };
  vulnLibrary: {
    newInB: VulnLibrarySummary[];
    fixedInB: VulnLibrarySummary[];
    worsened: VulnLibrarySummary[];
  };
  coverage: {
    aPercent: number | null;
    bPercent: number | null;
    delta: number | null;
  };
}

const SEVERITY_MAP: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  C: 'critical',
  H: 'high',
  M: 'medium',
  L: 'low',
};

type LibKey = 'newInB' | 'fixedInB' | 'worsened';
const LIB_ACCENT: Record<LibKey, 'warning' | 'success' | 'destructive'> = {
  newInB: 'warning',
  fixedInB: 'success',
  worsened: 'destructive',
};

const LIB_LABEL: Record<LibKey, string> = {
  newInB: 'NEW',
  fixedInB: 'FIXED',
  worsened: 'WORSENED',
};

const LIB_EMPTY: Record<LibKey, string> = {
  newInB: 'No new library entries',
  fixedInB: 'Nothing fixed yet',
  worsened: 'No severity upgrades',
};

/**
 * /projects/:id/vuln-library/compare?from=&to=
 *
 * Cross-version vulnerability library comparison. Reuses the ScanDiff API.
 */
export default function VulnComparePage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const fromId = searchParams.get('from') ?? '';
  const toId = searchParams.get('to') ?? '';

  const [runs, setRuns] = useState<ScanRunPublic[]>([]);
  const [diff, setDiff] = useState<ScanDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Fetch scan runs for the version dropdowns
  useEffect(() => {
    if (!id) return;
    api
      .get<ScanRunPublic[]>(`/projects/${id}/scans?limit=50`)
      .then(setRuns)
      .catch(() => {});
  }, [id]);

  // Fetch diff when both versions are selected
  useEffect(() => {
    if (!id || !fromId || !toId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    setDiff(null);
    api
      .get<ScanDiff>(
        `/projects/${id}/scans/diff?a=${encodeURIComponent(fromId)}&b=${encodeURIComponent(toId)}`,
      )
      .then(setDiff)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id, fromId, toId]);

  function updateParam(key: 'from' | 'to', value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <main className="container py-8">
      <PageHeader
        title="Vuln Library Compare"
        description="Cross-version vulnerability library comparison"
        breadcrumbs={[
          { label: 'Project', to: `/projects/${id ?? ''}` },
          { label: 'Vuln Library', to: `/projects/${id ?? ''}/vuln-library` },
        ]}
      />

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {/* Version Selectors */}
      <Card className="mb-6 p-4" data-testid="version-selectors">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">From (baseline)</label>
            <select
              value={fromId}
              onChange={(e) => updateParam('from', e.target.value)}
              className="rounded border border-input bg-background px-3 py-1.5 text-sm min-w-[200px]"
              data-testid="from-select"
            >
              <option value="">-- Select version --</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id.slice(0, 8)}... — {new Date(r.queuedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">To (target)</label>
            <select
              value={toId}
              onChange={(e) => updateParam('to', e.target.value)}
              className="rounded border border-input bg-background px-3 py-1.5 text-sm min-w-[200px]"
              data-testid="to-select"
            >
              <option value="">-- Select version --</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id.slice(0, 8)}... — {new Date(r.queuedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="grid gap-4 md:grid-cols-3" data-testid="compare-loading">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-24" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Diff Results */}
      {diff && !loading && (
        <>
          {/* Run Summary */}
          <section className="mb-6 grid gap-3 md:grid-cols-2">
            <Card className="p-3 text-sm" data-testid="run-summary-a">
              <div className="text-xs text-muted-foreground">From (baseline)</div>
              <div className="font-mono text-xs">{diff.runA.id}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Status: {diff.runA.status} · Vulns: {diff.runA.vulnCount} · Coverage:{' '}
                {diff.runA.apiCoverageStatus} · Gate: {diff.runA.gateDecision}
              </div>
            </Card>
            <Card className="p-3 text-sm" data-testid="run-summary-b">
              <div className="text-xs text-muted-foreground">To (target)</div>
              <div className="font-mono text-xs">{diff.runB.id}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Status: {diff.runB.status} · Vulns: {diff.runB.vulnCount} · Coverage:{' '}
                {diff.runB.apiCoverageStatus} · Gate: {diff.runB.gateDecision}
              </div>
            </Card>
          </section>

          {/* Vuln Library Diff — main content */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">
              Library Diff
              <span className="ml-2 text-xs text-muted-foreground">
                new: {diff.vulnLibrary.newInB.length} · fixed: {diff.vulnLibrary.fixedInB.length} ·
                worsened: {diff.vulnLibrary.worsened.length}
              </span>
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {(['newInB', 'fixedInB', 'worsened'] as const).map((key) => (
                <Card key={key} data-testid={`lib-${key}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm capitalize">
                        {key === 'newInB'
                          ? 'New in B'
                          : key === 'fixedInB'
                            ? 'Fixed in B'
                            : 'Worsened'}
                      </CardTitle>
                      <StatusBadge label={LIB_LABEL[key]} variant={LIB_ACCENT[key]} />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {diff.vulnLibrary[key].length === 0 ? (
                      <p className="text-xs text-muted-foreground">{LIB_EMPTY[key]}</p>
                    ) : (
                      <ul className="space-y-1.5" data-testid={`lib-${key}-list`}>
                        {diff.vulnLibrary[key].map((entry) => (
                          <li
                            key={entry.id}
                            className="flex items-center justify-between rounded border bg-background px-2.5 py-1.5 text-xs"
                          >
                            <span className="truncate">
                              {entry.title ?? entry.vulnType}
                              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                                ({entry.fingerprint.slice(0, 8)}...)
                              </span>
                            </span>
                            <SeverityBadge severity={SEVERITY_MAP[entry.severityMax] ?? 'info'} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Coverage Delta */}
          {diff.coverage.aPercent !== null && diff.coverage.bPercent !== null && (
            <section className="mt-6">
              <h2 className="mb-2 text-lg font-semibold">Coverage Delta</h2>
              <Card className="p-4" data-testid="coverage-delta">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground">A (baseline)</div>
                    <div className="text-2xl font-semibold">{diff.coverage.aPercent}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">B (target)</div>
                    <div className="text-2xl font-semibold">{diff.coverage.bPercent}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Delta (B - A)</div>
                    <div
                      className={`text-2xl font-semibold ${
                        diff.coverage.delta === null
                          ? ''
                          : diff.coverage.delta > 0
                            ? 'text-green-700'
                            : diff.coverage.delta < 0
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                      }`}
                    >
                      {diff.coverage.delta === null
                        ? 'N/A'
                        : `${diff.coverage.delta > 0 ? '+' : ''}${diff.coverage.delta}%`}
                    </div>
                  </div>
                </div>
              </Card>
            </section>
          )}
        </>
      )}

      {/* No versions selected */}
      {!fromId && !toId && !loading && !diff && (
        <Card className="p-6" data-testid="compare-empty">
          <p className="text-sm text-muted-foreground">
            Select "From" and "To" versions above to compare vulnerability library entries across
            scan runs.
          </p>
        </Card>
      )}
    </main>
  );
}
