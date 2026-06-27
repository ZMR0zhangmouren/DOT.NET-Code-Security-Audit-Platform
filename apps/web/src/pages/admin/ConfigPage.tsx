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

type Mode = { kind: 'create' } | { kind: 'edit'; key: AiKey };

/**
 * §5.7 /admin/config —— AI Key CRUD + Test + 模型选择
 *
 * 表单:
 * - availableModels:多选 checkbox + "自动探测"按钮(POST /:id/models)
 * - defaultModel:radio(从已选 availableModels 中选一个)
 */
export default function ConfigPage(): React.ReactElement {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  // 表单字段
  const [provider, setProvider] = useState<AiKey['provider']>('openai');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);

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

  function openCreate(): void {
    setMode({ kind: 'create' });
    setProvider('openai');
    setLabel('');
    setBaseUrl('https://api.openai.com/v1');
    setApiKey('');
    setDefaultModel('');
    setSelectedModels([]);
    setDiscoveredModels([]);
  }

  function openEdit(k: AiKey): void {
    setMode({ kind: 'edit', key: k });
    setProvider(k.provider);
    setLabel(k.label);
    setBaseUrl(k.baseUrl);
    setApiKey(''); // 不回显明文,留空表示不改
    setDefaultModel(k.defaultModel);
    setSelectedModels([...k.availableModels]);
    setDiscoveredModels([]);
  }

  function closeModal(): void {
    setMode(null);
  }

  function toggleModel(m: string, on: boolean): void {
    setSelectedModels((prev) => {
      const next = on ? Array.from(new Set([...prev, m])) : prev.filter((x) => x !== m);
      if (!on && defaultModel === m) setDefaultModel('');
      return next;
    });
  }

  async function discoverModels(): Promise<void> {
    if (!mode) return;
    if (!apiKey.trim() && mode.kind === 'create') {
      setErr('Discover requires API key — please paste the key first');
      return;
    }
    setDiscovering(true);
    setErr(null);
    try {
      // 编辑模式下,如未改 apiKey,直接 POST :id/models(用已存的明文)
      // 否则先临时跑(Phase 2 接 form 临时探测)
      const result = await api.post<{ ok: boolean; models: string[]; message?: string }>(
        mode.kind === 'edit'
          ? `/settings/ai-keys/${mode.key.id}/models`
          : `/settings/ai-keys/_probe`, // 编辑模式优先走 :id;新建时 Phase 2 接
        {},
      );
      if (!result.ok) {
        setErr(result.message ?? 'discover failed');
        return;
      }
      setDiscoveredModels(result.models);
      setSelectedModels((prev) => Array.from(new Set([...prev, ...result.models])));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDiscovering(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!mode) return;
    setSaving(true);
    setErr(null);
    try {
      if (mode.kind === 'create') {
        await api.post('/settings/ai-keys', {
          provider,
          label,
          baseUrl,
          apiKey,
          defaultModel,
          availableModels: selectedModels,
        });
      } else {
        const patch: Record<string, unknown> = {
          label,
          baseUrl,
          defaultModel,
          availableModels: selectedModels,
        };
        if (apiKey.trim()) patch['apiKey'] = apiKey;
        await api.patch(`/settings/ai-keys/${mode.key.id}`, patch);
      }
      closeModal();
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
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

  // 合并:已选 + 已探测(去重)
  const allModelOptions = Array.from(new Set([...discoveredModels, ...selectedModels])).sort();

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
          <Button onClick={() => openCreate()} data-testid="config-new">
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

        {mode && (
          <form
            onSubmit={(e) => {
              void onSubmit(e);
            }}
            className="mb-4 rounded-lg border bg-card p-4"
          >
            <h3 className="mb-3 text-base font-semibold">
              {mode.kind === 'create' ? 'New AI Key' : `Edit: ${mode.key.label}`}
            </h3>
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
                <span className="text-muted-foreground">
                  API Key {mode.kind === 'edit' && '(leave blank to keep current)'}
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  {...(mode.kind === 'create' ? { required: true, minLength: 10 } : {})}
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                />
              </label>
            </div>

            {/* 模型选择区 */}
            <div className="mt-4 rounded border bg-background p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">Available Models</span>
                {mode.kind === 'edit' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={discovering}
                    onClick={() => {
                      void discoverModels();
                    }}
                    data-testid="discover-models"
                  >
                    {discovering ? '探测中...' : '探测可用模型(/v1/models)'}
                  </Button>
                )}
              </div>
              {allModelOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  暂无可用模型;若新建,先在 API Key 输入完整 key 后用 Phase 2 的"未保存探测"功能。
                </p>
              ) : (
                <ul className="grid gap-1 md:grid-cols-2" data-testid="model-list">
                  {allModelOptions.map((m) => (
                    <li key={m} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedModels.includes(m)}
                        onChange={(e) => {
                          toggleModel(m, e.target.checked);
                        }}
                        data-testid={`model-${m}`}
                      />
                      <input
                        type="radio"
                        name="defaultModel"
                        checked={defaultModel === m}
                        disabled={!selectedModels.includes(m)}
                        onChange={() => setDefaultModel(m)}
                        data-testid={`default-${m}`}
                      />
                      <span className="font-mono text-xs">{m}</span>
                      {discoveredModels.includes(m) && (
                        <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                          服务端返回
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                checkbox = 可用模型;radio = 默认模型(必须先勾选)
              </p>
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeModal} disabled={saving}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !label || selectedModels.length === 0 || !defaultModel}
                data-testid="config-save"
              >
                {saving ? 'Saving...' : mode.kind === 'create' ? 'Create' : 'Save'}
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
                      variant="secondary"
                      onClick={() => {
                        openEdit(k);
                      }}
                      data-testid="key-edit"
                    >
                      Edit
                    </Button>
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
