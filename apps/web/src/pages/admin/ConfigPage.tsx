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

interface GitCredential {
  id: string;
  scope: 'system' | 'project';
  projectId: string | null;
  label: string;
  kind: 'ssh_key' | 'https_token';
  hostPattern: string;
  username: string | null;
  fingerprint: string;
  isActive: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface ProxyConfig {
  id: string;
  protocol: 'http' | 'https' | 'socks5' | null;
  host: string | null;
  port: number | null;
  username: string | null;
  passwordHint: string | null;
  applyTo: 'all' | 'http_only' | 'all_outbound';
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: number;
  testStatus: 'unknown' | 'success' | 'failed';
  testMessage: string | null;
}

type Mode = { kind: 'create' } | { kind: 'edit'; key: AiKey };
type GitMode = { kind: 'create' } | { kind: 'edit'; cred: GitCredential };
type ProxyMode = { kind: 'edit'; cfg: ProxyConfig };

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
  const [availableModelsText, setAvailableModelsText] = useState('gpt-4o\ngpt-4o-mini');
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
    const initialModels = availableModelsText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    setSelectedModels(initialModels);
    setDefaultModel(initialModels[0] ?? '');
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

  // ---- Git Credentials 状态 ----
  const [gitCreds, setGitCreds] = useState<GitCredential[]>([]);
  const [gitLoading, setGitLoading] = useState(true);
  const [gitMode, setGitMode] = useState<GitMode | null>(null);
  const [gitSaving, setGitSaving] = useState(false);
  const [gitScope, setGitScope] = useState<'system' | 'project'>('system');
  const [gitProjectId, setGitProjectId] = useState('');
  const [gitLabel, setGitLabel] = useState('');
  const [gitKind, setGitKind] = useState<'ssh_key' | 'https_token'>('https_token');
  const [gitHostPattern, setGitHostPattern] = useState('');
  const [gitUsername, setGitUsername] = useState('');
  const [gitSecret, setGitSecret] = useState('');
  const [gitActive, setGitActive] = useState(true);

  // ---- Proxy Config 状态 ----
  const [proxyCfg, setProxyCfg] = useState<ProxyConfig | null>(null);
  const [proxyLoading, setProxyLoading] = useState(true);
  const [proxyMode, setProxyMode] = useState<ProxyMode | null>(null);
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyProtocol, setProxyProtocol] = useState<'http' | 'https' | 'socks5' | null>('http');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState<number | ''>('');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const [proxyApplyTo, setProxyApplyTo] = useState<'all' | 'http_only' | 'all_outbound'>(
    'all_outbound',
  );
  const [proxyActive, setProxyActive] = useState(true);

  async function refreshGitCreds(): Promise<void> {
    setGitLoading(true);
    try {
      const data = await api.get<GitCredential[]>('/admin/git-credentials');
      setGitCreds(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGitLoading(false);
    }
  }

  async function refreshProxy(): Promise<void> {
    setProxyLoading(true);
    try {
      const data = await api.get<ProxyConfig | null>('/admin/proxy');
      setProxyCfg(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProxyLoading(false);
    }
  }

  useEffect(() => {
    void refreshGitCreds();
    void refreshProxy();
  }, []);

  function openGitCreate(): void {
    setGitMode({ kind: 'create' });
    setGitScope('system');
    setGitProjectId('');
    setGitLabel('');
    setGitKind('https_token');
    setGitHostPattern('');
    setGitUsername('');
    setGitSecret('');
    setGitActive(true);
  }

  function openGitEdit(c: GitCredential): void {
    setGitMode({ kind: 'edit', cred: c });
    setGitScope(c.scope);
    setGitProjectId(c.projectId ?? '');
    setGitLabel(c.label);
    setGitKind(c.kind);
    setGitHostPattern(c.hostPattern);
    setGitUsername(c.username ?? '');
    setGitSecret(''); // 不回显
    setGitActive(c.isActive);
  }

  function closeGitModal(): void {
    setGitMode(null);
  }

  async function onSubmitGit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!gitMode) return;
    setGitSaving(true);
    setErr(null);
    try {
      if (gitMode.kind === 'create') {
        await api.post('/admin/git-credentials', {
          scope: gitScope,
          projectId: gitScope === 'project' ? gitProjectId : null,
          label: gitLabel,
          kind: gitKind,
          hostPattern: gitHostPattern,
          username: gitKind === 'https_token' ? gitUsername : null,
          secret: gitSecret,
          isActive: gitActive,
        });
      } else {
        const patch: Record<string, unknown> = {
          label: gitLabel,
          hostPattern: gitHostPattern,
          username: gitKind === 'https_token' ? gitUsername : null,
          isActive: gitActive,
        };
        if (gitSecret.trim()) patch['secret'] = gitSecret;
        await api.patch(`/admin/git-credentials/${gitMode.cred.id}`, patch);
      }
      closeGitModal();
      void refreshGitCreds();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setGitSaving(false);
    }
  }

  async function removeGitCred(c: GitCredential): Promise<void> {
    if (!confirm(`Delete git credential "${c.label}"?`)) return;
    try {
      await api.delete(`/admin/git-credentials/${c.id}`);
      void refreshGitCreds();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function openProxyEdit(c: ProxyConfig): void {
    setProxyMode({ kind: 'edit', cfg: c });
    setProxyProtocol(c.protocol);
    setProxyHost(c.host ?? '');
    setProxyPort(c.port ?? '');
    setProxyUsername(c.username ?? '');
    setProxyPassword(''); // 不回显
    setProxyApplyTo(c.applyTo);
    setProxyActive(c.isActive);
  }

  function closeProxyModal(): void {
    setProxyMode(null);
  }

  async function onSubmitProxy(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!proxyMode) return;
    setProxySaving(true);
    setErr(null);
    try {
      await api.patch('/admin/proxy', {
        protocol: proxyProtocol,
        host: proxyProtocol === null ? null : proxyHost,
        port: proxyProtocol === null ? null : proxyPort === '' ? null : Number(proxyPort),
        username: proxyProtocol === null ? null : proxyUsername || null,
        password: proxyPassword.trim() ? proxyPassword : null,
        applyTo: proxyApplyTo,
        isActive: proxyActive,
      });
      closeProxyModal();
      void refreshProxy();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setProxySaving(false);
    }
  }

  async function testProxy(): Promise<void> {
    setErr(null);
    try {
      // 优先发送表单当前值(不保存 DB 也能测);后端有 body 则用 body,无 body 则读 DB
      const body =
        proxyProtocol && proxyHost && proxyPort
          ? {
              protocol: proxyProtocol,
              host: proxyHost,
              port: Number(proxyPort),
              username: proxyUsername || undefined,
              password: proxyPassword || undefined,
            }
          : undefined;
      const result = await api.post<{ ok: boolean; message: string; latencyMs: number }>(
        '/admin/proxy/test',
        body,
      );
      alert(
        result.ok ? `OK (${result.latencyMs}ms)\n${result.message}` : `FAIL\n${result.message}`,
      );
      void refreshProxy();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

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
              {allModelOptions.length === 0 && mode.kind === 'edit' ? (
                <p className="text-xs text-muted-foreground">
                  暂无可用模型;点"探测可用模型(/v1/models)"拉取。
                </p>
              ) : allModelOptions.length === 0 && mode.kind === 'create' ? (
                <p className="text-xs text-muted-foreground">
                  在下方 textarea 输入模型名(一行一个),然后点 Create。
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
              {mode.kind === 'create' && (
                <label className="mt-3 flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">
                    Available models (one per line; parsed into selections above on open)
                  </span>
                  <textarea
                    value={availableModelsText}
                    onChange={(e) => setAvailableModelsText(e.target.value)}
                    rows={4}
                    className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                    placeholder="gpt-4o&#10;gpt-4o-mini"
                  />
                </label>
              )}
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

      {/* ---------- §5.7 Git Credentials ---------- */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Git Credentials</h2>
          <Button onClick={() => openGitCreate()} data-testid="git-new">
            + Add Git Credential
          </Button>
        </div>

        {gitMode && (
          <form
            onSubmit={(e) => {
              void onSubmitGit(e);
            }}
            className="mb-4 rounded-lg border bg-card p-4"
            data-testid="git-form"
          >
            <h3 className="mb-3 text-base font-semibold">
              {gitMode.kind === 'create' ? 'New Git Credential' : `Edit: ${gitMode.cred.label}`}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Scope *</span>
                <select
                  value={gitScope}
                  onChange={(e) => setGitScope(e.target.value as 'system' | 'project')}
                  disabled={gitMode.kind === 'edit'}
                  className="rounded-md border border-input bg-background px-3 py-2"
                  data-testid="git-scope"
                >
                  <option value="system">system</option>
                  <option value="project">project</option>
                </select>
              </label>
              {gitScope === 'project' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Project ID *</span>
                  <input
                    value={gitProjectId}
                    onChange={(e) => setGitProjectId(e.target.value)}
                    required
                    disabled={gitMode.kind === 'edit'}
                    placeholder="proj-..."
                    className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Label *</span>
                <input
                  value={gitLabel}
                  onChange={(e) => setGitLabel(e.target.value)}
                  required
                  placeholder="GitHub 个人 token"
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Kind *</span>
                <select
                  value={gitKind}
                  onChange={(e) => setGitKind(e.target.value as 'ssh_key' | 'https_token')}
                  disabled={gitMode.kind === 'edit'}
                  className="rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="https_token">https_token</option>
                  <option value="ssh_key">ssh_key</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Host Pattern *</span>
                <input
                  value={gitHostPattern}
                  onChange={(e) => setGitHostPattern(e.target.value)}
                  required
                  placeholder="github.com"
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                />
              </label>
              {gitKind === 'https_token' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Username *</span>
                  <input
                    value={gitUsername}
                    onChange={(e) => setGitUsername(e.target.value)}
                    required
                    placeholder="octocat"
                    className="rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                <span className="text-muted-foreground">
                  Secret {gitMode.kind === 'edit' && '(leave blank to keep current)'}
                </span>
                <textarea
                  value={gitSecret}
                  onChange={(e) => setGitSecret(e.target.value)}
                  {...(gitMode.kind === 'create' ? { required: true } : {})}
                  rows={gitKind === 'ssh_key' ? 6 : 2}
                  placeholder={
                    gitKind === 'ssh_key' ? '-----BEGIN OPENSSH PRIVATE KEY-----' : 'ghp_...'
                  }
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                  data-testid="git-secret"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={gitActive}
                  onChange={(e) => setGitActive(e.target.checked)}
                />
                <span className="text-muted-foreground">Active</span>
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeGitModal} disabled={gitSaving}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={gitSaving || !gitLabel || !gitHostPattern || !gitSecret}
                data-testid="git-save"
              >
                {gitSaving ? 'Saving...' : gitMode.kind === 'create' ? 'Create' : 'Save'}
              </Button>
            </div>
          </form>
        )}

        {gitLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : gitCreds.length === 0 ? (
          <p
            className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
            data-testid="git-empty"
          >
            No git credentials configured yet.
          </p>
        ) : (
          <table className="w-full rounded-lg border bg-card text-sm" data-testid="git-table">
            <thead>
              <tr className="border-b bg-muted text-left">
                <th className="p-2">Label</th>
                <th className="p-2">Scope</th>
                <th className="p-2">Kind</th>
                <th className="p-2">Host</th>
                <th className="p-2">Username</th>
                <th className="p-2">Fingerprint</th>
                <th className="p-2">Active</th>
                <th className="p-2">Created By</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {gitCreds.map((c) => (
                <tr key={c.id} className="border-b" data-testid="git-row">
                  <td className="p-2 font-semibold">{c.label}</td>
                  <td className="p-2 font-mono text-xs">
                    {c.scope}
                    {c.projectId ? `:${c.projectId}` : ''}
                  </td>
                  <td className="p-2 font-mono text-xs">{c.kind}</td>
                  <td className="p-2 font-mono text-xs">{c.hostPattern}</td>
                  <td className="p-2 font-mono text-xs">{c.username ?? '-'}</td>
                  <td className="p-2 font-mono text-xs">{c.fingerprint}</td>
                  <td className="p-2">
                    <span
                      className={
                        c.isActive
                          ? 'rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground'
                          : 'rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                      }
                    >
                      {c.isActive ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs">{c.createdBy}</td>
                  <td className="p-2 space-x-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        openGitEdit(c);
                      }}
                      data-testid="git-edit"
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void removeGitCred(c);
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

      {/* ---------- §5.7 Proxy Config ---------- */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Network Proxy</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void testProxy();
              }}
              data-testid="proxy-test"
            >
              Test Connection
            </Button>
            {proxyCfg && (
              <Button onClick={() => openProxyEdit(proxyCfg)} data-testid="proxy-edit">
                Edit
              </Button>
            )}
            {!proxyCfg && (
              <Button
                onClick={() =>
                  setProxyMode({
                    kind: 'edit',
                    cfg: {
                      id: 'singleton',
                      protocol: 'http',
                      host: '',
                      port: null,
                      username: null,
                      passwordHint: null,
                      applyTo: 'all_outbound',
                      isActive: true,
                      updatedBy: null,
                      updatedAt: 0,
                      testStatus: 'unknown',
                      testMessage: null,
                    },
                  })
                }
                data-testid="proxy-new"
              >
                + Configure
              </Button>
            )}
          </div>
        </div>

        {proxyMode && (
          <form
            onSubmit={(e) => {
              void onSubmitProxy(e);
            }}
            className="mb-4 rounded-lg border bg-card p-4"
            data-testid="proxy-form"
          >
            <h3 className="mb-3 text-base font-semibold">Proxy Configuration</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Protocol</span>
                <select
                  value={proxyProtocol ?? ''}
                  onChange={(e) =>
                    setProxyProtocol(
                      e.target.value === ''
                        ? null
                        : (e.target.value as 'http' | 'https' | 'socks5'),
                    )
                  }
                  className="rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="">(direct mode - no proxy)</option>
                  <option value="http">http</option>
                  <option value="https">https</option>
                  <option value="socks">socks</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Apply To *</span>
                <select
                  value={proxyApplyTo}
                  onChange={(e) =>
                    setProxyApplyTo(e.target.value as 'all' | 'http_only' | 'all_outbound')
                  }
                  className="rounded-md border border-input bg-background px-3 py-2"
                >
                  <option value="all_outbound">all_outbound</option>
                  <option value="all">all</option>
                  <option value="http_only">http_only</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Host {proxyProtocol !== null && '*'}</span>
                <input
                  value={proxyHost}
                  onChange={(e) => setProxyHost(e.target.value)}
                  required={proxyProtocol !== null}
                  disabled={proxyProtocol === null}
                  placeholder="127.0.0.1"
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Port {proxyProtocol !== null && '*'}</span>
                <input
                  type="number"
                  value={proxyPort}
                  onChange={(e) =>
                    setProxyPort(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  required={proxyProtocol !== null}
                  disabled={proxyProtocol === null}
                  placeholder="7890"
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Username</span>
                <input
                  value={proxyUsername}
                  onChange={(e) => setProxyUsername(e.target.value)}
                  disabled={proxyProtocol === null}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  Password {proxyCfg?.passwordHint && `(current: ${proxyCfg.passwordHint})`}
                </span>
                <input
                  type="password"
                  value={proxyPassword}
                  onChange={(e) => setProxyPassword(e.target.value)}
                  disabled={proxyProtocol === null}
                  placeholder="leave blank to keep current"
                  className="rounded-md border border-input bg-background px-3 py-2 font-mono"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={proxyActive}
                  onChange={(e) => setProxyActive(e.target.checked)}
                />
                <span className="text-muted-foreground">Active</span>
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeProxyModal}
                disabled={proxySaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={proxySaving} data-testid="proxy-save">
                {proxySaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        )}

        {proxyLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : proxyCfg ? (
          <div className="rounded-lg border bg-card p-4 text-sm" data-testid="proxy-summary">
            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Protocol</div>
                <div className="font-mono">{proxyCfg.protocol ?? '(direct)'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Endpoint</div>
                <div className="font-mono">
                  {proxyCfg.host && proxyCfg.port ? `${proxyCfg.host}:${proxyCfg.port}` : '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Username</div>
                <div className="font-mono">{proxyCfg.username ?? '-'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Apply To</div>
                <div className="font-mono">{proxyCfg.applyTo}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Active</div>
                <div>{proxyCfg.isActive ? 'yes' : 'no'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Test</div>
                <div
                  className={
                    proxyCfg.testStatus === 'success'
                      ? 'text-green-600'
                      : proxyCfg.testStatus === 'failed'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  }
                  title={proxyCfg.testMessage ?? ''}
                >
                  {proxyCfg.testStatus === 'success'
                    ? 'OK'
                    : proxyCfg.testStatus === 'failed'
                      ? 'FAIL'
                      : 'unknown'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p
            className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
            data-testid="proxy-empty"
          >
            No proxy configured. Direct mode by default.
          </p>
        )}
      </section>
    </main>
  );
}
