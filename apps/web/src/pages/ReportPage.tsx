import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { getToken } from '@/lib/api';

/**
 * §5.4 /projects/:id/scans/:runId/report —— 报告页
 * - 顶部 3 个下载按钮(Markdown / JSON / 归档 zip)
 * - 中部渲染 Markdown 预览(纯文本展示,Phase 2 接 marked / react-markdown)
 */
export default function ReportPage(): React.ReactElement {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    setMd(null);
    setErr(null);
    fetch(`/api/scan-runs/${runId}/report`, {
      headers: { authorization: `Bearer ${getToken() ?? ''}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => setMd(t))
      .catch((e: Error) => setErr(e.message));
  }, [runId]);

  function download(kind: 'md' | 'json' | 'archive'): void {
    if (!runId) return;
    const url = `/api/scan-runs/${runId}/report${kind === 'md' ? '' : '.' + kind === 'json' ? '.json' : '-archive'}`;
    setDownloading(kind);
    try {
      const a = document.createElement('a');
      a.href = url;
      // 带 token(后端读 Authorization header)
      // 简单做法:把 token 放在 hash,后端不读;为简化直接 fetch 后 blob 下载
      fetch(url, { headers: { authorization: `Bearer ${getToken() ?? ''}` } })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        })
        .then((blob) => {
          const obj = URL.createObjectURL(blob);
          a.href = obj;
          a.download = `${runId}-${kind === 'archive' ? 'archive.zip' : 'report.' + kind}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(obj);
        })
        .catch((e: Error) => setErr(e.message))
        .finally(() => setDownloading(null));
    } catch (e) {
      setErr((e as Error).message);
      setDownloading(null);
    }
  }

  return (
    <main className="container py-8">
      <Link
        to={`/projects/${id ?? ''}/scans/${runId ?? ''}`}
        className="text-sm text-muted-foreground underline"
      >
        ← Back to scan
      </Link>

      <header className="mt-3 mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Audit Report</h1>
          <p className="text-sm text-muted-foreground">Section 5.4 - {runId}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={downloading !== null}
            onClick={() => {
              download('md');
            }}
            data-testid="download-md"
          >
            {downloading === 'md' ? 'Downloading...' : 'Download .md'}
          </Button>
          <Button
            variant="outline"
            disabled={downloading !== null}
            onClick={() => {
              download('json');
            }}
            data-testid="download-json"
          >
            {downloading === 'json' ? 'Downloading...' : 'Download .json'}
          </Button>
          <Button
            disabled={downloading !== null}
            onClick={() => {
              download('archive');
            }}
            data-testid="download-archive"
          >
            {downloading === 'archive' ? 'Downloading...' : 'Download .zip (md + json + log)'}
          </Button>
        </div>
      </header>

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {md === null && !err ? (
        <p className="text-sm text-muted-foreground">Loading report...</p>
      ) : (
        <article className="rounded-lg border bg-card p-6">
          <pre className="overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{md}</pre>
        </article>
      )}
    </main>
  );
}
