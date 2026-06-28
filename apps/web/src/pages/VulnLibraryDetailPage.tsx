import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

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
      <Link
        to={`/projects/${id ?? ''}/vuln-library`}
        className="text-sm text-muted-foreground underline"
      >
        ← Vuln Library
      </Link>

      {loading && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}

      {err && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {entry && (
        <>
          <header className="mt-3 mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">
                {entry.title ?? `${entry.vulnType} vulnerability`}
              </h1>
              <p className="text-sm text-muted-foreground">
                {entry.vulnType} · ID <code className="font-mono">{entry.id}</code>
              </p>
              {entry.tags.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Tags: {entry.tags.join(', ')}</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${severityClass(entry.severityMax)}`}
                  data-testid="detail-severity"
                >
                  {entry.severityMax}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${statusClass(entry.status)}`}
                  data-testid="detail-status"
                >
                  {entry.status}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-muted-foreground">Change status:</label>
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
          </header>

          <section className="mb-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
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
            </div>

            {entry.description && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold">Description</h3>
                <p className="whitespace-pre-wrap text-xs">{entry.description}</p>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">
              Timeline ({entry.timeline.length} occurrence
              {entry.timeline.length === 1 ? '' : 's'})
            </h2>
            {entry.timeline.length === 0 ? (
              <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
                No vulnerability instances recorded.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="timeline">
                {entry.timeline.map((t) => (
                  <li
                    key={t.vulnerabilityId}
                    className="rounded-lg border bg-card p-3"
                    data-testid="timeline-row"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono">{t.filePath}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          :{t.lineStart}-{t.lineEnd}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${severityClass(t.severity)}`}
                        >
                          {t.severity}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${statusClass(t.status)}`}
                        >
                          {t.status}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Created {new Date(t.createdAt).toLocaleString()} · scan{' '}
                      <code className="font-mono">{t.scanRunId.slice(-12)}</code>
                    </p>
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

function severityClass(s: string): string {
  switch (s) {
    case 'C':
      return 'bg-destructive text-destructive-foreground';
    case 'H':
      return 'bg-orange-500 text-white';
    case 'M':
      return 'bg-yellow-500 text-white';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function statusClass(s: string): string {
  switch (s) {
    case 'open':
      return 'bg-destructive text-destructive-foreground';
    case 'fixing':
      return 'bg-yellow-500 text-white';
    case 'fixed':
      return 'bg-green-600 text-white';
    case 'wontfix':
    case 'ignored':
    case 'suppressed':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
}
