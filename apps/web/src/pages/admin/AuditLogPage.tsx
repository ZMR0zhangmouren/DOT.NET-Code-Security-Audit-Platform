import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { type ScanRunPublic } from '@/lib/scanTypes';

interface AuditEntry {
  id: string;
  type: string;
  summary: string;
  timestamp: number;
  status?: string;
  detail?: string;
}

/**
 * /admin/audit-log
 *
 * Phase 1: Read-only placeholder + preview via recent scan runs.
 * Full audit_log implementation (login/logout, project CRUD, config changes)
 * will ship in a later version.
 */
export default function AuditLogPage(): React.ReactElement {
  const [scans, setScans] = useState<ScanRunPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    api
      .get<ScanRunPublic[]>('/scan-runs?limit=20')
      .then(setScans)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Map scan runs to audit-like entries
  const auditEntries: AuditEntry[] = scans.map((s) => ({
    id: s.id,
    type: 'scan_run',
    summary: `Scan ${s.id.slice(0, 8)}... — ${s.status}`,
    timestamp: s.queuedAt,
    status: s.status,
    detail: `Project ${s.projectId.slice(0, 8)}... · Gate: ${s.gateDecision} · Coverage: ${s.apiCoverageStatus}`,
  }));

  function statusVariant(
    status: string,
  ): 'info' | 'success' | 'destructive' | 'warning' | 'default' {
    switch (status) {
      case 'succeeded':
        return 'success';
      case 'failed':
        return 'destructive';
      case 'running':
        return 'info';
      case 'queued':
        return 'warning';
      default:
        return 'default';
    }
  }

  return (
    <main className="container py-8">
      <PageHeader title="Audit Log" description="System event log — Phase 1 preview" />

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {/* 审计日志说明 —— 占位 + 未来规划 */}
      <Card className="mb-6 p-6" data-testid="audit-placeholder">
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
          <div className="rounded-full bg-primary/10 p-3">
            <svg
              className="h-6 w-6 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold">Audit Log — Coming Soon</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Audit logging will record all critical operations: user login/logout, project
              create/delete, scan triggers, configuration changes, and more. This feature will be
              fully implemented in a later release.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary">Phase 1 — Read-only</Badge>
              <Badge variant="outline">Preview: Recent Scan Runs</Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* Preview: recent scan runs as audit entries */}
      <Card data-testid="audit-preview">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Recent Activity Preview
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (last {auditEntries.length} scan runs)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2" data-testid="audit-loading">
              <Skeleton className="h-6 w-full rounded" />
              <Skeleton className="h-6 w-full rounded" />
              <Skeleton className="h-6 w-full rounded" />
              <Skeleton className="h-6 w-3/4 rounded" />
            </div>
          ) : auditEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scan activity recorded yet.</p>
          ) : (
            <div className="space-y-1" data-testid="audit-list">
              {auditEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded border bg-background px-3 py-2 text-xs"
                  data-testid="audit-row"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleString()}
                    </span>
                    <span className="truncate">{entry.summary}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {entry.status && (
                      <StatusBadge label={entry.status} variant={statusVariant(entry.status)} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
