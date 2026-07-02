import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { SeverityBadge } from '@/components/SeverityBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { coverageClass, gateClass, scanStatusClass, type ScanRunPublic } from '@/lib/scanTypes';

// ---------------------------------------------------------------------------
// 5.4 diff 接口类型 —— 与 apps/api/src/scan/scan-diff.util.ts 一致
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

function severityBadgeVariant(s: 'C' | 'H' | 'M' | 'L'): 'critical' | 'high' | 'medium' | 'low' {
  switch (s) {
    case 'C':
      return 'critical';
    case 'H':
      return 'high';
    case 'M':
      return 'medium';
    case 'L':
      return 'low';
  }
}

/**
 * 5.4 /projects/:id/scans/diff?a=...&b=... —— 多 ScanRun 对比页
 *
 * 顶部:runA / runB 两个摘要卡
 * 三段:
 *   - Vulnerabilities diff(onlyInA / onlyInB / inBoth)
 *   - Vuln Library diff(newInB / fixedInB / worsened)
 *   - Coverage diff(delta + 颜色编码)
 */
export default function DiffPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const aId = searchParams.get('a') ?? '';
  const bId = searchParams.get('b') ?? '';
  const [diff, setDiff] = useState<ScanDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !aId || !bId) {
      setErr('missing a or b query param');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    setDiff(null);
    api
      .get<ScanDiff>(
        `/projects/${id}/scans/diff?a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`,
      )
      .then(setDiff)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id, aId, bId]);

  return (
    <main className="container py-8">
      <PageHeader
        title="Scan Diff"
        description="5.4 - A vs B - vulnerabilities - library - coverage"
        breadcrumbs={[{ label: 'Project', to: `/projects/${id ?? ''}` }]}
      />

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading diff...</p>
      ) : diff ? (
        <>
          {/* run 摘要 */}
          <section className="mb-6 grid gap-3 md:grid-cols-2">
            <RunSummaryCard label="A (baseline)" run={diff.runA} />
            <RunSummaryCard label="B (target)" run={diff.runB} />
          </section>

          {/* Vulnerabilities 三列 */}
          <section className="mb-6">
            <h2 className="mb-2 text-lg font-semibold">
              Vulnerabilities Diff
              <span className="ml-2 text-xs text-muted-foreground">
                only A: {diff.vulnerabilities.onlyInA.length} - only B:{' '}
                {diff.vulnerabilities.onlyInB.length} - in both:{' '}
                {diff.vulnerabilities.inBoth.length}
              </span>
            </h2>
            <div className="overflow-x-auto rounded-lg border bg-card text-sm">
              <table className="w-full" data-testid="vuln-diff-table">
                <thead>
                  <tr className="border-b bg-muted text-left">
                    <th className="p-2">Group</th>
                    <th className="p-2">Fingerprint</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Severity (A → B)</th>
                    <th className="p-2">Status (A → B)</th>
                    <th className="p-2">File</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.vulnerabilities.onlyInA.map((v) => (
                    <tr
                      key={'a-' + v.id}
                      className="border-b last:border-0"
                      data-testid="vuln-only-a"
                    >
                      <td className="p-2 text-xs text-muted-foreground">only A</td>
                      <td className="p-2 font-mono text-xs">{v.fingerprint.slice(0, 12)}...</td>
                      <td className="p-2 text-xs">{v.vulnType}</td>
                      <td className="p-2 text-xs">
                        <SeverityBadge severity={severityBadgeVariant(v.severity)} />
                      </td>
                      <td className="p-2 text-xs">
                        <StatusBadge label={v.status} variant="default" />
                      </td>
                      <td className="p-2 text-xs">
                        {v.filePath}:{v.lineStart}
                      </td>
                    </tr>
                  ))}
                  {diff.vulnerabilities.onlyInB.map((v) => (
                    <tr
                      key={'b-' + v.id}
                      className="border-b last:border-0"
                      data-testid="vuln-only-b"
                    >
                      <td className="p-2 text-xs text-muted-foreground">only B</td>
                      <td className="p-2 font-mono text-xs">{v.fingerprint.slice(0, 12)}...</td>
                      <td className="p-2 text-xs">{v.vulnType}</td>
                      <td className="p-2 text-xs">
                        <SeverityBadge severity={severityBadgeVariant(v.severity)} />
                      </td>
                      <td className="p-2 text-xs">
                        <StatusBadge label={v.status} variant="default" />
                      </td>
                      <td className="p-2 text-xs">
                        {v.filePath}:{v.lineStart}
                      </td>
                    </tr>
                  ))}
                  {diff.vulnerabilities.inBoth.map((vb) => (
                    <tr
                      key={'both-' + vb.fingerprint}
                      className="border-b last:border-0"
                      data-testid="vuln-both"
                    >
                      <td className="p-2 text-xs text-muted-foreground">in both</td>
                      <td className="p-2 font-mono text-xs">{vb.fingerprint.slice(0, 12)}...</td>
                      <td className="p-2 text-xs">{vb.vulnType}</td>
                      <td className="p-2 text-xs">
                        <span className="flex items-center gap-1">
                          <SeverityBadge severity={severityBadgeVariant(vb.inA.severity)} />
                          <span className="text-muted-foreground">-</span>
                          <SeverityBadge severity={severityBadgeVariant(vb.inB.severity)} />
                          {vb.severityChanged === 'upgraded' && (
                            <StatusBadge label="UP" variant="destructive" />
                          )}
                          {vb.severityChanged === 'downgraded' && (
                            <StatusBadge label="DOWN" variant="success" />
                          )}
                        </span>
                      </td>
                      <td className="p-2 text-xs">
                        <span className="flex items-center gap-1">
                          <StatusBadge label={vb.inA.status} variant="default" />
                          <span className="text-muted-foreground">-</span>
                          <StatusBadge label={vb.inB.status} variant="default" />
                          {vb.statusChanged && <StatusBadge label="CHANGED" variant="info" />}
                        </span>
                      </td>
                      <td className="p-2 text-xs">{vb.filePath}</td>
                    </tr>
                  ))}
                  {diff.vulnerabilities.onlyInA.length === 0 &&
                    diff.vulnerabilities.onlyInB.length === 0 &&
                    diff.vulnerabilities.inBoth.length === 0 && (
                      <tr>
                        <td className="p-2 text-xs text-muted-foreground" colSpan={6}>
                          No vulnerabilities in either run.
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Vuln Library 三类 */}
          <section className="mb-6">
            <h2 className="mb-2 text-lg font-semibold">
              Vuln Library Diff
              <span className="ml-2 text-xs text-muted-foreground">
                new: {diff.vulnLibrary.newInB.length} - fixed: {diff.vulnLibrary.fixedInB.length} -
                worsened: {diff.vulnLibrary.worsened.length}
              </span>
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              <LibCard
                title="New in B"
                testid="lib-new"
                entries={diff.vulnLibrary.newInB}
                empty="No new library entries"
                accent="warning"
                label="NEW"
              />
              <LibCard
                title="Fixed in B"
                testid="lib-fixed"
                entries={diff.vulnLibrary.fixedInB}
                empty="Nothing fixed yet"
                accent="success"
                label="FIXED"
              />
              <LibCard
                title="Worsened"
                testid="lib-worsened"
                entries={diff.vulnLibrary.worsened}
                empty="No severity upgrades"
                accent="destructive"
                label="WORSENED"
              />
            </div>
          </section>

          {/* Coverage delta */}
          <section>
            <h2 className="mb-2 text-lg font-semibold">Coverage Diff</h2>
            <Card className="p-4 text-sm" data-testid="coverage-diff">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">A</div>
                  <div className="text-2xl font-semibold">
                    {diff.coverage.aPercent === null ? 'N/A' : `${diff.coverage.aPercent}%`}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">B</div>
                  <div className="text-2xl font-semibold">
                    {diff.coverage.bPercent === null ? 'N/A' : `${diff.coverage.bPercent}%`}
                  </div>
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
                    data-testid="coverage-delta"
                  >
                    {diff.coverage.delta === null
                      ? 'N/A'
                      : `${diff.coverage.delta > 0 ? '+' : ''}${diff.coverage.delta}%`}
                  </div>
                </div>
              </div>
            </Card>
          </section>
        </>
      ) : null}
    </main>
  );
}

function RunSummaryCard({
  label,
  run,
}: {
  label: string;
  run: ScanDiffRunSummary;
}): React.ReactElement {
  return (
    <Card className="p-4 text-sm" data-testid="run-summary">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-xs">{run.id}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`rounded px-2 py-0.5 text-xs ${scanStatusClass(run.status)}`}>
          {run.status}
        </span>
        <span className={`rounded px-2 py-0.5 text-xs ${coverageClass(run.apiCoverageStatus)}`}>
          {run.apiCoverageStatus}
        </span>
        <span className={`rounded px-2 py-0.5 text-xs ${gateClass(run.gateDecision)}`}>
          {run.gateDecision}
        </span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Started: {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
        <br />
        Vulns: <strong>{run.vulnCount}</strong>
      </div>
    </Card>
  );
}

function LibCard({
  title,
  testid,
  entries,
  empty,
  accent,
  label,
}: {
  title: string;
  testid: string;
  entries: VulnLibrarySummary[];
  empty: string;
  accent: 'warning' | 'success' | 'destructive';
  label: string;
}): React.ReactElement {
  return (
    <Card className="p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <StatusBadge label={label} variant={accent} />
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1" data-testid={testid}>
          {entries.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between rounded border bg-background px-2 py-1 text-xs"
            >
              <span className="truncate">
                {l.title ?? l.vulnType}{' '}
                <span className="font-mono text-[10px] text-muted-foreground">
                  ({l.fingerprint.slice(0, 8)}...)
                </span>
              </span>
              <span className="ml-2 shrink-0">
                <SeverityBadge severity={severityBadgeVariant(l.severityMax)} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
