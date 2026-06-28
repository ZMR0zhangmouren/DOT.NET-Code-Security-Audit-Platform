import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
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

/**
 * §5.5 /projects/:id/vuln-library —— 漏洞库列表(根因级)
 *
 * 接 /api/projects/:id/vuln-library,展示根因级漏洞(按 fingerprint 聚合)。
 * 点行进详情页 /vuln-library/:id 看时间线 + 状态流转。
 */
export default function VulnLibraryPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const [entries, setEntries] = useState<VulnLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get<VulnLibraryEntry[]>(`/projects/${id}/vuln-library`);
      setEntries(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <main className="container py-8">
      <Link to={`/projects/${id ?? ''}`} className="text-sm text-muted-foreground underline">
        ← Project
      </Link>

      <header className="mt-3 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vulnerability Library</h1>
          <p className="text-sm text-muted-foreground">
            Section 5.5 - root-cause vulnerabilities (fingerprint-grouped)
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} data-testid="lib-refresh">
          Refresh
        </Button>
      </header>

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : entries.length === 0 ? (
        <p
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="lib-empty"
        >
          No library entries. Run a scan to populate the library.
        </p>
      ) : (
        <ul className="grid gap-3" data-testid="lib-list">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border bg-card p-4 shadow-sm"
              data-testid="lib-row"
            >
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
                  <span
                    className={`rounded px-2 py-0.5 ${severityClass(e.severityMax)}`}
                    data-testid="lib-severity"
                  >
                    {e.severityMax}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 ${statusClass(e.status)}`}
                    data-testid="lib-status"
                  >
                    {e.status}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                First seen {new Date(e.firstSeenAt).toLocaleDateString()} · Last seen{' '}
                {new Date(e.lastSeenAt).toLocaleDateString()} · Occurrences: {e.occurrenceCount}
                {e.tags.length > 0 && <> · Tags: {e.tags.join(', ')}</>}
              </p>
            </li>
          ))}
        </ul>
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
      return 'bg-muted text-muted-foreground';
    case 'ignored':
    case 'suppressed':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
}
