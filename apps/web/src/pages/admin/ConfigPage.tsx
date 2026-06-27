import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

interface AiKey {
  id: string;
  provider: 'openai' | 'anthropic' | 'deepseek' | 'minimax' | 'custom';
  label: string;
  baseUrl: string;
  defaultModel: string;
  isActive: boolean;
  availableModels: string[];
  lastTestAt: number | null;
  lastTestStatus: 'unknown' | 'success' | 'failed';
  lastTestMessage: string | null;
  apiKeyHint: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * §5.7 /admin/config —— 系统配置(仅 admin)
 *
 * MVP 行为:AI Key CRUD + 启停;"测试连接" 调 PATCH 触发后端测活
 */
export default function ConfigPage(): React.ReactElement {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const [provider, setProvider] = useState<AiKey['provider']>('openai');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('gpt-4o');
  const [availableModelsText, setAvailableModelsText] = useState('gpt-4o\ngpt-4o-mini');
  const [creating, setCreating] = useState(false);

  async function refresh(): Promise<void> {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get<AiKey[]>('/settings/ai-keys');
      setKeys(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      const availableModels = availableModelsText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api.post('/settings/ai-keys', {
        provider,
        label,
        baseUrl,
        apiKey,
        defaultModel,
        availableModels,
      });
      setShowNew(false);
      setLabel('');
      setApiKey('');
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(k: AiKey): Promise<void> {
    try {
      await api.patch(`/settings/ai-keys/${k.id}`, { isActive: !k.isActive });
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(k: AiKey): Promise<void> {
    if (!confirm(`Delete AI key "${k.label}"?`)) return;
    try {
      await api.delete(`/settings/ai-keys/${k.id}`);
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const [testing, setTesting] = useState<string | null>(null);
  async function testConnection(k: AiKey): Promise<void> {
    setTesting(k.id);
    setErr(null);
    try {
      const result = await api.post<{ ok: boolean; message: string; latencyMs: number }>(
        `/settings/ai-keys/${k.id}/test`,
      );
      alert(
        result.ok ? `OK (${result.latencyMs}ms)\n${result.message}` : `FAIL\n${result.message}`,
      );
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTesting(null);
    }
  }

  return (
    <main className="container py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">System Configuration</h1>
          <p className="text-sm text-muted-foreground">
            Section 5.7 - AI Key, git credentials, network proxy (admin only)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refresh()} data-testid="config-refresh">
            Refresh
          </Button>
          <Button onClick={() => setShowNew((v) => !v)} data-testid="config-new">
            + New AI Key
          </Button>
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold">AI Keys</h2>
        {err && (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {err}
          </p>
        )}

        {showNew && (
          <form
            onSubmit={(e) => {
              void onCreate(e);
            }}
            className="mb-4 rounded-lg border bg-card p-4"
          >
            <h3 className="mb-3 text-base font-semibold">New AI Key</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Provider *</span>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as AiKey['provider'])}
                  className="rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                  <option value="deepseek">deepseek</option>
                  <option value="minimax">minimax</option>
                  <option value="custom">custom</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Label *</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                  placeholder="Main OpenAI Key"
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">Base URL *</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  required
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">API Key *</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                  minLength={10}
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Default model *</span>
                <input
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                  required
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Available models (1 per line)</span>
                <textarea
                  value={availableModelsText}
                  onChange={(e) => setAvailableModelsText(e.target.value)}
                  rows={3}
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowNew(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating || !label || !apiKey}
                data-testid="config-create"
              >
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : keys.length === 0 ? (
          <p
            className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
            data-testid="config-empty"
          >
            No AI keys configured yet. Click "+ New AI Key" to add one (Phase 1.5 needs at least one
            active key to run scans).
          </p>
        ) : (
          <table className="w-full rounded-lg border bg-card text-sm" data-testid="config-table">
            <thead>
              <tr className="border-b bg-muted text-left">
                <th className="p-2">Label</th>
                <th className="p-2">Provider</th>
                <th className="p-2">Base URL</th>
                <th className="p-2">Model</th>
                <th className="p-2">Key hint</th>
                <th className="p-2">Active</th>
                <th className="p-2">Last test</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b" data-testid="config-row">
                  <td className="p-2 font-semibold">{k.label}</td>
                  <td className="p-2 font-mono text-xs">{k.provider}</td>
                  <td className="p-2 font-mono text-xs">{k.baseUrl}</td>
                  <td className="p-2 font-mono text-xs">{k.defaultModel}</td>
                  <td className="p-2 font-mono text-xs">{k.apiKeyHint}</td>
                  <td className="p-2">
                    <span
                      className={
                        k.isActive
                          ? 'rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground'
                          : 'rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                      }
                    >
                      {k.isActive ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td className="p-2 text-xs">
                    {k.lastTestStatus === 'success' ? (
                      <span className="text-green-600">OK</span>
                    ) : k.lastTestStatus === 'failed' ? (
                      <span className="text-destructive" title={k.lastTestMessage ?? ''}>
                        FAIL
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="p-2 space-x-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testing === k.id}
                      onClick={() => {
                        void testConnection(k);
                      }}
                      data-testid="key-test"
                    >
                      {testing === k.id ? 'Testing...' : 'Test'}
                    </Button>
                    <Button
                      size="sm"
                      variant={k.isActive ? 'outline' : 'default'}
                      onClick={() => {
                        void toggle(k);
                      }}
                    >
                      {k.isActive ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void remove(k);
                      }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Other (Phase 2+)</h2>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>- Git credentials (system-level SSH Key / HTTPS Token)</li>
          <li>- Network proxy (HTTP / HTTPS / SOCKS5)</li>
          <li>- Tool validation status</li>
        </ul>
      </section>
    </main>
  );
}
