import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api';

type TraceRole = 'system' | 'user' | 'assistant' | 'tool';

interface AgentTraceItem {
  id: string;
  scanRunId: string;
  traceIndex: number;
  role: TraceRole;
  content: string | null;
  toolCalls: Array<Record<string, unknown>> | null;
  toolCallId: string | null;
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string | null;
  createdAt: number;
}

interface AgentTraceSummary {
  scanRunId: string;
  total: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  model: string | null;
}

const roleBadgeVariant: Record<TraceRole, 'default' | 'info' | 'success' | 'warning'> = {
  system: 'default',
  user: 'info',
  assistant: 'success',
  tool: 'warning',
};

/**
 * Phase 3 1.2/2.7 —— /projects/:id/scans/:runId/trace
 *
 * 顶部 summary:scan_id / 总 trace 数 / token 用量 / 主 model
 * 时间线:每个 trace 一行卡片
 *   - role 彩色 chip
 *   - content 折叠(默认折叠,点击展开)
 *   - tool_calls:render 成 tool name + args JSON viewer
 *   - token 用量 footer
 */
export default function TracePage(): React.ReactElement {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [summary, setSummary] = useState<AgentTraceSummary | null>(null);
  const [items, setItems] = useState<AgentTraceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, sum] = await Promise.all([
          api.get<AgentTraceItem[]>(`/scan-runs/${runId}/trace`),
          api.get<AgentTraceSummary>(`/scan-runs/${runId}/trace/summary`),
        ]);
        if (cancelled) return;
        setItems(list);
        setSummary(sum);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : (e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const totalTokensDisplay = useMemo(() => {
    if (!summary) return '-';
    if (summary.totalTokens > 0) return summary.totalTokens.toLocaleString();
    return `${summary.totalPromptTokens.toLocaleString()} prompt + ${summary.totalCompletionTokens.toLocaleString()} completion`;
  }, [summary]);

  return (
    <main className="container py-8">
      <PageHeader
        title="Agent Trace"
        description={`Phase 3 1.2/2.7 — ${runId}`}
        breadcrumbs={[{ label: 'Back to scan', to: `/projects/${id ?? ''}/scans/${runId ?? ''}` }]}
      />

      {error && (
        <p className="mb-3 text-sm text-destructive" role="alert" data-testid="trace-error">
          {error}
        </p>
      )}

      {summary && (
        <Card className="mb-6 glass-card" data-testid="trace-summary">
          <div className="grid gap-3 p-4 sm:grid-cols-4">
            <SummaryField label="scan_run_id" value={summary.scanRunId} mono />
            <SummaryField label="total traces" value={summary.total.toLocaleString()} />
            <SummaryField label="total tokens" value={totalTokensDisplay} />
            <SummaryField label="model" value={summary.model ?? '(unknown)'} />
          </div>
        </Card>
      )}

      {items === null && error === null && (
        <p className="text-sm text-muted-foreground" data-testid="trace-loading">
          Loading trace...
        </p>
      )}

      {items !== null && items.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="trace-empty">
          No trace recorded yet. (Traces are persisted when the scan reaches the OpenAI call loop.)
        </p>
      )}

      <ol className="space-y-3" data-testid="trace-list">
        {items?.map((t) => (
          <li
            key={t.id}
            data-testid="trace-item"
            data-trace-index={t.traceIndex}
            data-trace-role={t.role}
          >
            <Card className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{t.traceIndex}</span>
                <StatusBadge
                  label={t.role}
                  variant={roleBadgeVariant[t.role]}
                  data-testid="trace-role"
                />
                {t.toolCallId && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">
                    tool_call_id: <span className="font-mono">{t.toolCallId}</span>
                  </span>
                )}
                {t.finishReason && (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">
                    finish: {t.finishReason}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(t.createdAt).toISOString()}
                </span>
              </div>

              {t.content !== null && t.content !== '' && <ContentBlock content={t.content} />}

              {t.toolCalls && t.toolCalls.length > 0 && <ToolCallsBlock toolCalls={t.toolCalls} />}

              {(t.promptTokens !== null ||
                t.completionTokens !== null ||
                t.totalTokens !== null ||
                t.model) && (
                <div className="mt-2 flex flex-wrap gap-3 border-t pt-2 text-xs text-muted-foreground">
                  {t.model && (
                    <span>
                      model: <span className="font-mono">{t.model}</span>
                    </span>
                  )}
                  {t.promptTokens !== null && <span>prompt: {t.promptTokens}</span>}
                  {t.completionTokens !== null && <span>completion: {t.completionTokens}</span>}
                  {t.totalTokens !== null && <span>total: {t.totalTokens}</span>}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ol>
    </main>
  );
}

function SummaryField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="text-xs">
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? 'font-mono' : 'font-semibold'}>{value}</div>
    </div>
  );
}

function ContentBlock({ content }: { content: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const preview = content.length > 120 ? content.slice(0, 120) + '...' : content;
  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-xs text-muted-foreground underline hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        data-testid="trace-content-toggle"
      >
        {open ? 'hide content' : 'show content'}
      </button>
      <pre
        className={`mt-1 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs transition-all ${
          open ? 'max-h-96' : 'max-h-16'
        }`}
        data-testid="trace-content"
      >
        {open ? content : preview}
      </pre>
    </div>
  );
}

function ToolCallsBlock({
  toolCalls,
}: {
  toolCalls: Array<Record<string, unknown>>;
}): React.ReactElement {
  return (
    <div className="mt-2 space-y-2">
      <div className="text-xs font-medium">tool_calls ({toolCalls.length})</div>
      {toolCalls.map((tc, idx) => {
        const fn =
          (tc['function'] as Record<string, unknown> | undefined) ??
          ({} as Record<string, unknown>);
        const name = typeof fn['name'] === 'string' ? (fn['name'] as string) : '?';
        const rawArgs = fn['arguments'];
        let parsedArgs: unknown = rawArgs;
        if (typeof rawArgs === 'string') {
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
            parsedArgs = rawArgs;
          }
        }
        return (
          <div key={idx} className="rounded border bg-muted/40 p-2" data-testid="trace-tool-call">
            <div className="text-xs">
              <span className="rounded bg-primary px-2 py-0.5 text-primary-foreground font-medium">
                {name}
              </span>
              {typeof tc['id'] === 'string' && (
                <span className="ml-2 font-mono text-muted-foreground">{tc['id']}</span>
              )}
            </div>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs leading-relaxed">
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
