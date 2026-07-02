import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { SeverityBadge } from '@/components/SeverityBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const STATUS_OPTIONS = ['open', 'fixing', 'fixed', 'wontfix', 'ignored'] as const;
type VulnStatus = (typeof STATUS_OPTIONS)[number];

const STATUS_VARIANT_MAP: Record<string, 'destructive' | 'warning' | 'success' | 'default'> = {
  open: 'destructive',
  fixing: 'warning',
  fixed: 'success',
  wontfix: 'default',
  ignored: 'default',
};

/**
 * /projects/:id/scans/:runId/vulns/:vulnId
 *
 * Detail view of a single vulnerability instance.
 */
export default function ScanVulnDetailPage(): React.ReactElement {
  const { id, runId, vulnId } = useParams<{ id: string; runId: string; vulnId: string }>();
  const [vuln, setVuln] = useState<VulnerabilityPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exploitOpen, setExploitOpen] = useState(false);

  async function refresh(): Promise<void> {
    if (!vulnId) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get<VulnerabilityPublic>(`/vulnerabilities/${vulnId}`);
      setVuln(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vulnId]);

  async function setStatus(newStatus: VulnStatus): Promise<void> {
    if (!vulnId) return;
    setSaving(true);
    setErr(null);
    try {
      const updated = await api.patch<VulnerabilityPublic>(`/vulnerabilities/${vulnId}/status`, {
        status: newStatus,
      });
      setVuln(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container py-8">
      {loading && (
        <div className="space-y-4" data-testid="detail-loading">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      )}

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {vuln && (
        <>
          <PageHeader
            title={`${vuln.vulnType} — ${vuln.filePath.split('/').pop() ?? vuln.filePath}`}
            description={`ID ${vuln.id.slice(0, 16)}... · ${vuln.filePath}:${vuln.lineStart}-${vuln.lineEnd}`}
            breadcrumbs={[
              { label: 'Project', to: `/projects/${id ?? ''}` },
              { label: 'Scan', to: `/projects/${id ?? ''}/scans/${runId ?? ''}` },
              { label: 'Vulnerabilities', to: `/projects/${id ?? ''}/scans/${runId ?? ''}/vulns` },
            ]}
          />

          {/* Metadata Card */}
          <Card className="mb-4" data-testid="metadata-card">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Metadata</CardTitle>
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={SEVERITY_MAP[vuln.severity] ?? 'info'} />
                  <StatusBadge
                    label={vuln.status}
                    variant={STATUS_VARIANT_MAP[vuln.status] ?? 'default'}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Fingerprint</dt>
                <dd className="font-mono break-all">{vuln.fingerprint}</dd>
                <dt className="text-muted-foreground">Vuln Type</dt>
                <dd>{vuln.vulnType}</dd>
                <dt className="text-muted-foreground">File</dt>
                <dd className="font-mono">
                  {vuln.filePath}:{vuln.lineStart}-{vuln.lineEnd}
                </dd>
                <dt className="text-muted-foreground">CVSS Score</dt>
                <dd>{vuln.cvssScore !== null ? vuln.cvssScore.toFixed(1) : 'N/A'}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd className="flex items-center gap-2">
                  <select
                    value={vuln.status}
                    disabled={saving}
                    onChange={(e) => void setStatus(e.target.value as VulnStatus)}
                    className="rounded border border-input bg-background px-2 py-1 text-xs"
                    data-testid="status-select"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {saving && <span className="text-muted-foreground">Saving...</span>}
                </dd>
                {vuln.assigneeId && (
                  <>
                    <dt className="text-muted-foreground">Assignee</dt>
                    <dd className="font-mono">{vuln.assigneeId}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(vuln.createdAt).toLocaleString()}</dd>
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{new Date(vuln.updatedAt).toLocaleString()}</dd>
              </dl>
            </CardContent>
          </Card>

          {/* Code Snippet Card */}
          <Card className="mb-4" data-testid="code-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Code Snippet — {vuln.filePath}:{vuln.lineStart}-{vuln.lineEnd}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre
                className="overflow-x-auto rounded bg-[#0d1117] p-4 font-mono text-xs text-green-400 leading-relaxed"
                data-testid="code-snippet"
              >
                {vuln.codeSnippet || '(empty)'}
              </pre>
            </CardContent>
          </Card>

          {/* Exploit Payload Card */}
          {vuln.exploitPayload && (
            <Card className="mb-4" data-testid="exploit-card">
              <CardHeader className="pb-2">
                <button
                  onClick={() => setExploitOpen((o) => !o)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <CardTitle className="text-sm">Exploit Payload</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {exploitOpen ? 'Collapse' : 'Expand'}
                  </span>
                </button>
              </CardHeader>
              {exploitOpen && (
                <CardContent>
                  <pre className="overflow-x-auto rounded bg-destructive/5 border border-destructive/20 p-4 font-mono text-xs text-destructive leading-relaxed">
                    {vuln.exploitPayload}
                  </pre>
                </CardContent>
              )}
            </Card>
          )}

          {/* Fix Suggestion Card */}
          <Card className="mb-4" data-testid="fix-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Fix Suggestion</CardTitle>
            </CardHeader>
            <CardContent>
              <pre
                className="whitespace-pre-wrap rounded bg-accent/30 p-4 font-mono text-xs leading-relaxed"
                data-testid="fix-suggestion"
              >
                {vuln.fixSuggestion || '(no suggestion provided)'}
              </pre>
            </CardContent>
          </Card>

          {/* Evidence Refs Card */}
          <Card data-testid="evidence-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Evidence References ({vuln.evidenceRefs.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vuln.evidenceRefs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No evidence references.</p>
              ) : (
                <ul className="space-y-1" data-testid="evidence-list">
                  {vuln.evidenceRefs.map((ref, i) => (
                    <li
                      key={i}
                      className="rounded border bg-background px-3 py-1.5 font-mono text-xs"
                    >
                      {ref}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
