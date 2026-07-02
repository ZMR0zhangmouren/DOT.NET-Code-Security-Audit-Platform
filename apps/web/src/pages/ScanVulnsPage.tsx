import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { SeverityBadge } from '@/components/SeverityBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface VulnerabilityPublic {
  id: string;
  scanRunId: string;
  projectId: string;
  codeVersionId: string;
  libraryId: string | null;
  vulnType: string;
  severity: 'C' | 'H' | 'M' | 'L';
  cvssScore: number | null;
  fingerprint: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet: string;
  exploitPayload: string | null;
  fixSuggestion: string;
  evidenceRefs: string[];
  status: string;
  assigneeId: string | null;
  fixedInVersionId: string | null;
  createdAt: number;
  updatedAt: number;
}

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
};

/**
 * /projects/:id/scans/:runId/vulns
 *
 * Lists vulnerability instances for a specific scan run.
 */
export default function ScanVulnsPage(): React.ReactElement {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [vulns, setVulns] = useState<VulnerabilityPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setErr(null);
    api
      .get<VulnerabilityPublic[]>(`/scan-runs/${runId}/vulnerabilities`)
      .then(setVulns)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [runId]);

  return (
    <main className="container py-8">
      <PageHeader
        title="Vulnerabilities"
        description={`Scan run ${runId?.slice(0, 8) ?? ''} — vulnerability instances`}
        breadcrumbs={[
          { label: 'Project List', to: '/projects' },
          { label: 'Project', to: `/projects/${id ?? ''}` },
          { label: 'Scan', to: `/projects/${id ?? ''}/scans/${runId ?? ''}` },
        ]}
      />

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {loading ? (
        <div className="grid gap-3" data-testid="vulns-loading">
          {[1, 2, 3, 4].map((i) => (
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
              <Skeleton className="h-3 w-1/2 mt-1" />
            </Card>
          ))}
        </div>
      ) : vulns.length === 0 ? (
        <Card className="p-6" data-testid="vulns-empty">
          <p className="text-sm text-muted-foreground">No vulnerabilities found for this scan.</p>
        </Card>
      ) : (
        <ul className="grid gap-3" data-testid="vulns-list">
          {vulns.map((v) => (
            <li key={v.id} data-testid="vuln-row">
              <Link
                to={`/projects/${id ?? ''}/scans/${runId ?? ''}/vulns/${v.id}`}
                className="block"
              >
                <Card className="p-4 shadow-sm hover:bg-accent/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">
                        {v.vulnType}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {v.filePath}:{v.lineStart}-{v.lineEnd}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground font-mono truncate">
                        {v.fingerprint.slice(0, 24)}...
                      </p>
                      {v.cvssScore !== null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          CVSS: {v.cvssScore.toFixed(1)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                      <SeverityBadge
                        severity={SEVERITY_MAP[v.severity] ?? 'info'}
                        data-testid={`vuln-severity-${v.id}`}
                      />
                      <StatusBadge
                        label={v.status}
                        variant={STATUS_VARIANT_MAP[v.status] ?? 'default'}
                        data-testid={`vuln-status-${v.id}`}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Created {new Date(v.createdAt).toLocaleString()}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
