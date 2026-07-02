import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams } from 'react-router-dom';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { PageHeader } from '@/components/PageHeader';
import { ReportSectionNav, extractSections } from '@/components/ReportSectionNav';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { getToken } from '@/lib/api';

type RenderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'rendered'; markdown: string }
  | { kind: 'render-error'; markdown: string; error: string };

/**
 * §5.4 /projects/:id/scans/:runId/report —— 审计报告页
 */
export default function ReportPage(): React.ReactElement {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [state, setState] = useState<RenderState>({ kind: 'idle' });
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    setState({ kind: 'loading' });
    let cancelled = false;
    fetch(`/api/scan-runs/${runId}/report`, {
      headers: { authorization: `Bearer ${getToken() ?? ''}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (cancelled) return;
        try {
          if (typeof t !== 'string') throw new Error('Report body is not text');
          setState({ kind: 'rendered', markdown: t });
        } catch (e) {
          setState({ kind: 'render-error', markdown: t, error: (e as Error).message });
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setState({ kind: 'render-error', markdown: '', error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  function download(kind: 'md' | 'json' | 'archive'): void {
    if (!runId) return;
    const url = `/api/scan-runs/${runId}/report${kind === 'md' ? '' : kind === 'json' ? '.json' : '-archive'}`;
    setDownloading(kind);
    fetch(url, { headers: { authorization: `Bearer ${getToken() ?? ''}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = obj;
        a.download = `${runId}-${kind === 'archive' ? 'archive.zip' : 'report.' + kind}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(obj);
      })
      .catch((e: Error) => {
        setState((prev) =>
          prev.kind === 'rendered' || prev.kind === 'render-error'
            ? { ...prev, error: e.message }
            : { kind: 'render-error', markdown: '', error: e.message },
        );
      })
      .finally(() => setDownloading(null));
  }

  const sections = useMemo(() => {
    if (state.kind !== 'rendered' && state.kind !== 'render-error') return [];
    return extractSections(state.markdown);
  }, [state]);

  const errorMsg = state.kind === 'render-error' ? state.error : null;
  const markdown =
    state.kind === 'rendered' || state.kind === 'render-error' ? state.markdown : null;
  const isLoading = state.kind === 'loading' || state.kind === 'idle';

  return (
    <main className="container py-6">
      <PageHeader
        title="审计报告"
        description={`ScanRun: ${runId?.slice(0, 8) ?? '...'} · Section 5.4`}
        breadcrumbs={[
          { label: '项目列表', to: '/projects' },
          { label: '项目详情', to: `/projects/${id ?? ''}` },
          { label: '扫描详情', to: `/projects/${id ?? ''}/scans/${runId ?? ''}` },
        ]}
        actions={[
          {
            label: downloading === 'md' ? 'Downloading...' : 'Export',
            icon: Download,
            onClick: () => download('md'),
            variant: 'outline',
            disabled: downloading !== null,
          },
        ]}
        badge={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-1 h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => download('md')} disabled={downloading !== null}>
                Download .md
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => download('json')} disabled={downloading !== null}>
                Download .json
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => download('archive')} disabled={downloading !== null}>
                Download .zip (md + json + log)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {errorMsg && (
        <p className="mb-4 text-sm text-destructive" role="alert" data-testid="report-error">
          {errorMsg}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : (
          <ReportSectionNav sections={sections} />
        )}

        <Card className="report-prose prose prose-slate max-w-none p-6 dark:prose-invert prose-pre:my-3 prose-headings:font-semibold glass-card">
          {isLoading && (
            <div className="space-y-4" data-testid="report-loading">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}
          {markdown !== null && state.kind === 'rendered' && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                h2: ({ children, ...rest }) => (
                  <h2 id={headingIdFromChildren(children)} {...rest}>
                    {children}
                  </h2>
                ),
                h3: ({ children, ...rest }) => (
                  <h3 id={headingIdFromChildren(children)} {...rest}>
                    {children}
                  </h3>
                ),
              }}
            >
              {markdown}
            </ReactMarkdown>
          )}
          {markdown !== null && state.kind === 'render-error' && (
            <>
              <div
                className="mb-4 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm"
                data-testid="report-fallback-banner"
              >
                Markdown 渲染失败,以下为原文(plain text)。
              </div>
              <pre className="overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
                {markdown}
              </pre>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}

// --- helpers (与 ReportSectionNav 保持一致) ---

function headingIdFromChildren(children: React.ReactNode): string {
  return slugifyForAnchor(nodeToText(children));
}

function nodeToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (ReactIsElement(node)) {
    return nodeToText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

function ReactIsElement(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'props' in (value as object);
}

function slugifyForAnchor(text: string): string {
  const base = text
    .trim()
    .replace(/[^a-zA-Z0-9一-龥]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'section';
}
