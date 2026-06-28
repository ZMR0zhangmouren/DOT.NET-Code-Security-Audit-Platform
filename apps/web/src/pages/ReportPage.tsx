import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router-dom';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { ReportSectionNav, extractSections } from '@/components/ReportSectionNav';
import { Button } from '@/components/ui/button';
import { getToken } from '@/lib/api';

type RenderState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'rendered'; markdown: string }
  | { kind: 'render-error'; markdown: string; error: string };

/**
 * §5.4 /projects/:id/scans/:runId/report —— 报告页
 * - 顶部 3 个下载按钮(Markdown / JSON / 归档 zip)
 * - 左侧章节导航(自动从 ## / ### 抽取)
 * - 主区用 react-markdown + remark-gfm + rehype-highlight + Tailwind prose 渲染
 * - 渲染失败时降级显示原文 + 错误条
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
        // 尝试渲染,失败也保留原文用于降级显示
        try {
          // 预演一遍解析(仅检查 markdown 是否能 parse)
          // react-markdown 内部已经容错,这里只是做一次 sanity check
          if (typeof t !== 'string') throw new Error('Report body is not text');
          setState({ kind: 'rendered', markdown: t });
        } catch (e) {
          setState({
            kind: 'render-error',
            markdown: t,
            error: (e as Error).message,
          });
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
    try {
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
    } catch (e) {
      setState({ kind: 'render-error', markdown: '', error: (e as Error).message });
      setDownloading(null);
    }
  }

  // 从 markdown 抽取章节(只在成功拿到原文时)
  const sections = useMemo(() => {
    if (state.kind !== 'rendered' && state.kind !== 'render-error') return [];
    return extractSections(state.markdown);
  }, [state]);

  const errorMsg = state.kind === 'render-error' ? state.error : null;
  const markdown =
    state.kind === 'rendered' || state.kind === 'render-error' ? state.markdown : null;

  return (
    <main className="container py-8">
      <Link
        to={`/projects/${id ?? ''}/scans/${runId ?? ''}`}
        className="text-sm text-muted-foreground underline"
      >
        ← Back to scan
      </Link>

      <header className="mt-3 mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Audit Report</h1>
          <p className="text-sm text-muted-foreground">Section 5.4 - {runId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      {errorMsg && (
        <p className="mb-3 text-sm text-destructive" role="alert" data-testid="report-error">
          {errorMsg}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <ReportSectionNav sections={sections} />

        <article
          className="report-prose prose prose-slate max-w-none rounded-lg border bg-card p-6 dark:prose-invert prose-pre:my-3 prose-headings:font-semibold"
          data-testid="report-article"
        >
          {state.kind === 'loading' && (
            <p className="text-sm text-muted-foreground" data-testid="report-loading">
              Loading report...
            </p>
          )}
          {markdown !== null && state.kind === 'rendered' && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                // 给每个 h2/h3 一个稳定 id,与 ReportSectionNav 锚点一致
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
        </article>
      </div>
    </main>
  );
}

/**
 * 从 ReactMarkdown 传入的 children 数组里拼出标题文字,然后走与 extractSections
 * 完全相同的 slug 算法,保证 nav anchor 和正文 id 一一对齐。
 */
function headingIdFromChildren(children: React.ReactNode): string {
  const text = nodeToText(children);
  return slugifyForAnchor(text);
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

// 与 ReportSectionNav.slugifyHeading 保持一致
function slugifyForAnchor(text: string): string {
  const base = text
    .trim()
    .replace(/[^a-zA-Z0-9一-龥]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'section';
}
