import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { SeverityBadge } from '@/components/SeverityBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';

interface LibraryTimelineEntry {
  vulnerabilityId: string;
  scanRunId: string;
  codeVersionId: string;
  severity: 'C' | 'H' | 'M' | 'L';
  filePath: string;
  lineStart: number;
  lineEnd: number;
  status: 'open' | 'fixing' | 'fixed' | 'wontfix' | 'ignored';
  createdAt: number;
}

interface LibraryDetail {
  id: string;
  projectId: string;
  vulnType: string;
  severityMax: 'C' | 'H' | 'M' | 'L';
  status: 'open' | 'fixing' | 'fixed' | 'wontfix' | 'ignored' | 'suppressed';
  title: string | null;
  description: string | null;
  tags: string[];
  occurrenceCount: number;
  firstSeenAt: number;
  firstSeenVersionId: string;
  lastSeenAt: number;
  lastSeenVersionId: string;
  fixedInVersionId: string | null;
  fixedAt: number | null;
  assigneeId: string | null;
  createdAt: number;
  updatedAt: number;
  timeline: LibraryTimelineEntry[];
}

const LIBRARY_STATUSES = ['open', 'fixing', 'fixed', 'wontfix', 'ignored', 'suppressed'] as const;
type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

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
 * §5.5 /projects/:id/vuln-library/:libId —— 漏洞库详情
 *
 *  - 头部:根因信息(标题、type、severity、status、tags)+ 状态流转下拉
 *  - 元信息:first seen / last seen / 出现次数 / 分配人
 *  - 时间线:所有关联 vulnerabilities 按时间顺序
 */
export default function VulnLibraryDetailPage(): React.ReactElement {
  const { id, libId } = useParams<{ id: string; libId: string }>();
  const [entry, setEntry] = useState<LibraryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh(): Promise<void> {
    if (!libId) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get<LibraryDetail>(`/vuln-library/${libId}`);
      setEntry(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libId]);

  async function setStatus(newStatus: LibraryStatus): Promise<void> {
    if (!libId) return;
    setSaving(true);
    setErr(null);
    try {
      const updated = await api.patch<LibraryDetail>(`/vuln-library/${libId}/status`, {
        status: newStatus,
      });
      setEntry(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="container py-8">
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {err && (
        <p className="text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {entry && (
        <>
          <PageHeader
            title={entry.title ?? `${entry.vulnType} vulnerability`}
            description={`${entry.vulnType} · ID ${entry.id}`}
            breadcrumbs={[{ label: 'Vuln Library', to: `/projects/${id ?? ''}/vuln-library` }]}
            badge={
              entry.tags.length > 0 ? (
                <span className="text-xs text-muted-foreground">Tags: {entry.tags.join(', ')}</span>
              ) : undefined
            }
          />

          <section className="mb-6 grid gap-3 md:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">Metadata</h3>
              <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
                <dt className="text-muted-foreground">First seen</dt>
                <dd>{new Date(entry.firstSeenAt).toLocaleString()}</dd>
                <dt className="text-muted-foreground">Code version</dt>
                <dd className="font-mono">{entry.firstSeenVersionId}</dd>
                <dt className="text-muted-foreground">Last seen</dt>
                <dd>{new Date(entry.lastSeenAt).toLocaleString()}</dd>
                <dt className="text-muted-foreground">Code version</dt>
                <dd className="font-mono">{entry.lastSeenVersionId}</dd>
                <dt className="text-muted-foreground">Occurrences</dt>
                <dd>{entry.occurrenceCount}</dd>
                {entry.assigneeId && (
                  <>
                    <dt className="text-muted-foreground">Assignee</dt>
                    <dd className="font-mono">{entry.assigneeId}</dd>
                  </>
                )}
                {entry.fixedAt && (
                  <>
                    <dt className="text-muted-foreground">Fixed at</dt>
                    <dd>{new Date(entry.fixedAt).toLocaleString()}</dd>
                  </>
                )}
              </dl>
            </Card>

            {entry.description && (
              <Card className="p-4">
                <h3 className="mb-2 text-sm font-semibold">Description</h3>
                <p className="whitespace-pre-wrap text-xs">{entry.description}</p>
              </Card>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                Timeline ({entry.timeline.length} occurrence
                {entry.timeline.length === 1 ? '' : 's'})
              </h2>
              <div className="flex items-center gap-2">
                <SeverityBadge
                  severity={SEVERITY_MAP[entry.severityMax] ?? 'info'}
                  data-testid="detail-severity"
                />
                <StatusBadge
                  label={entry.status}
                  variant={STATUS_VARIANT_MAP[entry.status]}
                  data-testid="detail-status"
                />
                <label className="text-xs text-muted-foreground ml-2">Change status:</label>
                <select
                  value={entry.status}
                  disabled={saving}
                  onChange={(e) => {
                    void setStatus(e.target.value as LibraryStatus);
                  }}
                  className="rounded border border-input bg-background px-2 py-1 text-xs"
                  data-testid="detail-status-select"
                >
                  {LIBRARY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {entry.timeline.length === 0 ? (
              <Card className="p-6">
                <p className="text-sm text-muted-foreground">
                  No vulnerability instances recorded.
                </p>
              </Card>
            ) : (
              <ul className="space-y-2" data-testid="timeline">
                {entry.timeline.map((t) => (
                  <li key={t.vulnerabilityId} data-testid="timeline-row">
                    <Card className="p-3">
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <span className="font-mono">{t.filePath}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            :{t.lineStart}-{t.lineEnd}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={SEVERITY_MAP[t.severity] ?? 'info'} />
                          <StatusBadge label={t.status} variant={STATUS_VARIANT_MAP[t.status]} />
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Created {new Date(t.createdAt).toLocaleString()} · scan{' '}
                        <code className="font-mono">{t.scanRunId.slice(-12)}</code>
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
