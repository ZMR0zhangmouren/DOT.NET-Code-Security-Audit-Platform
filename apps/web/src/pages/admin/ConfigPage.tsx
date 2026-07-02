import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
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
          : '/settings/ai-keys/_probe',
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

  const [testing, setTesting] = useState<string | null>(null);

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

  async function testConnection(k: AiKey): Promise<void> {
    setTesting(k.id);
    setErr(null);
    try {
      const result = await api.post<{ ok: boolean; message: string; latencyMs: number }>(
        `/settings/ai-keys/${k.id}/test`,
      );
      if (result.ok) {
        toast.success(`OK (${result.latencyMs}ms)\n${result.message}`);
      } else {
        toast.error(`FAIL\n${result.message}`);
      }
      void refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(null);
    }
  }

  // 合并:已选 + 已探测(去重)
  const allModelOptions = Array.from(new Set([...discoveredModels, ...selectedModels])).sort();

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
  const [testUrl, setTestUrl] = useState('https://www.baidu.com');
  const [testRunning, setTestRunning] = useState(false);
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
    setTestRunning(true);
    try {
      const body: Record<string, unknown> = {};
      if (proxyProtocol && proxyHost && proxyPort) {
        body.protocol = proxyProtocol;
        body.host = proxyHost;
        body.port = Number(proxyPort);
        body.username = proxyUsername || undefined;
        body.password = proxyPassword || undefined;
      }
      if (testUrl.trim()) body.testUrl = testUrl.trim();
      const result = await api.post<{
        ok: boolean;
        message: string;
        latencyMs: number;
        details?: string;
      }>('/admin/proxy/test', Object.keys(body).length > 0 ? body : undefined);
      if (result.ok) {
        toast.success(`Proxy test OK (${result.latencyMs}ms)`);
      } else {
        toast.error(`Proxy test FAIL: ${result.message}`);
      }
      void refreshProxy();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTestRunning(false);
    }
  }

  return (
    <main className="container py-8">
      {/* PageHeader */}
      <div className="mb-6 flex items-start justify-between">
        <PageHeader
          title="系统配置"
          description="Section 5.7 - AI Key, git credentials, network proxy (admin only)"
        />
        <div className="flex shrink-0 gap-2 pt-1">
          <Button
            variant="outline"
            onClick={() => {
              void refresh();
            }}
            data-testid="config-refresh"
          >
            Refresh
          </Button>
          <Button onClick={() => openCreate()} data-testid="config-new">
            + New AI Key
          </Button>
        </div>
      </div>

      {err && (
        <p className="mb-3 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {/* ========== AI Keys ========== */}
      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold">AI Keys</h2>

        {/* AI Key Dialog */}
        <Dialog
          open={mode !== null}
          onOpenChange={(open) => {
            if (!open) closeModal();
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {mode?.kind === 'create'
                  ? 'New AI Key'
                  : mode?.kind === 'edit'
                    ? `Edit: ${mode.key.label}`
                    : ''}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                void onSubmit(e);
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Provider *</label>
                  <Select
                    value={provider}
                    onValueChange={(v) => setProvider(v as AiKey['provider'])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">openai</SelectItem>
                      <SelectItem value="anthropic">anthropic</SelectItem>
                      <SelectItem value="deepseek">deepseek</SelectItem>
                      <SelectItem value="minimax">minimax</SelectItem>
                      <SelectItem value="custom">custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Label *</label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    required
                    placeholder="Main OpenAI Key"
                  />
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label className="text-sm text-muted-foreground">Base URL *</label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    required
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label className="text-sm text-muted-foreground">
                    API Key {mode?.kind === 'edit' && '(leave blank to keep current)'}
                  </label>
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    {...(mode?.kind === 'create' ? { required: true, minLength: 10 } : {})}
                    className="font-mono"
                  />
                </div>
              </div>

              {/* 模型选择区 */}
              <div className="rounded border bg-background p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">Available Models</span>
                  {mode?.kind === 'edit' && (
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
                {allModelOptions.length === 0 && mode?.kind === 'edit' ? (
                  <p className="text-xs text-muted-foreground">
                    暂无可用模型;点"探测可用模型(/v1/models)"拉取。
                  </p>
                ) : allModelOptions.length === 0 && mode?.kind === 'create' ? (
                  <p className="text-xs text-muted-foreground">
                    在下方 textarea 输入模型名(一行一个),然后点 Create。
                  </p>
                ) : (
                  <ul className="grid gap-1 md:grid-cols-2" data-testid="model-list">
                    {allModelOptions.map((m) => (
                      <li key={m} className="flex items-center gap-2 text-sm">
                        <Input
                          type="checkbox"
                          checked={selectedModels.includes(m)}
                          onChange={(e) => {
                            toggleModel(m, e.target.checked);
                          }}
                          data-testid={`model-${m}`}
                          className="h-4 w-4"
                        />
                        <Input
                          type="radio"
                          name="defaultModel"
                          checked={defaultModel === m}
                          disabled={!selectedModels.includes(m)}
                          onChange={() => setDefaultModel(m)}
                          data-testid={`default-${m}`}
                          className="h-4 w-4"
                        />
                        <span className="font-mono text-xs">{m}</span>
                        {discoveredModels.includes(m) && (
                          <Badge variant="secondary" className="px-1 text-[10px]">
                            服务端返回
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  checkbox = 可用模型;radio = 默认模型(必须先勾选)
                </p>
                {mode?.kind === 'create' && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    <label className="text-sm text-muted-foreground">
                      Available models (one per line; parsed into selections above on open)
                    </label>
                    <Textarea
                      value={availableModelsText}
                      onChange={(e) => setAvailableModelsText(e.target.value)}
                      rows={4}
                      className="font-mono"
                      placeholder="gpt-4o&#10;gpt-4o-mini"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeModal} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving || !label || selectedModels.length === 0 || !defaultModel}
                  data-testid="config-save"
                >
                  {saving ? 'Saving...' : mode?.kind === 'create' ? 'Create' : 'Save'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* AI Keys list */}
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : keys.length === 0 ? (
          <p
            className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
            data-testid="config-empty"
          >
            No AI keys configured yet. Click "+ New AI Key" to add one (Phase 1.5 needs at least one
            active key to run scans).
          </p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table data-testid="config-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Base URL</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Key hint</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Last test</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id} data-testid="config-row">
                      <TableCell className="font-semibold">{k.label}</TableCell>
                      <TableCell className="font-mono text-xs">{k.provider}</TableCell>
                      <TableCell className="max-w-[200px] truncate font-mono text-xs">
                        {k.baseUrl}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{k.defaultModel}</TableCell>
                      <TableCell className="font-mono text-xs">{k.apiKeyHint}</TableCell>
                      <TableCell>
                        <StatusBadge
                          variant={k.isActive ? 'success' : 'default'}
                          label={k.isActive ? 'yes' : 'no'}
                        />
                      </TableCell>
                      <TableCell>
                        {k.lastTestStatus === 'success' ? (
                          <StatusBadge variant="success" label="OK" />
                        ) : k.lastTestStatus === 'failed' ? (
                          <span title={k.lastTestMessage ?? ''}>
                            <StatusBadge variant="destructive" label="FAIL" />
                          </span>
                        ) : (
                          <StatusBadge variant="default" label="-" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
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
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ========== Git Credentials ========== */}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Git Credentials</h2>
          <Button onClick={() => openGitCreate()} data-testid="git-new">
            + Add Git Credential
          </Button>
        </div>

        {/* Git Credential Dialog */}
        <Dialog
          open={gitMode !== null}
          onOpenChange={(open) => {
            if (!open) closeGitModal();
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {gitMode?.kind === 'create'
                  ? 'New Git Credential'
                  : gitMode?.kind === 'edit'
                    ? `Edit: ${gitMode.cred.label}`
                    : ''}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                void onSubmitGit(e);
              }}
              data-testid="git-form"
              className="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Scope *</label>
                  <Select
                    value={gitScope}
                    onValueChange={(v) => setGitScope(v as 'system' | 'project')}
                    disabled={gitMode?.kind === 'edit'}
                  >
                    <SelectTrigger data-testid="git-scope">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">system</SelectItem>
                      <SelectItem value="project">project</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {gitScope === 'project' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm text-muted-foreground">Project ID *</label>
                    <Input
                      value={gitProjectId}
                      onChange={(e) => setGitProjectId(e.target.value)}
                      required
                      disabled={gitMode?.kind === 'edit'}
                      placeholder="proj-..."
                      className="font-mono"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Label *</label>
                  <Input
                    value={gitLabel}
                    onChange={(e) => setGitLabel(e.target.value)}
                    required
                    placeholder="GitHub 个人 token"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Kind *</label>
                  <Select
                    value={gitKind}
                    onValueChange={(v) => setGitKind(v as 'ssh_key' | 'https_token')}
                    disabled={gitMode?.kind === 'edit'}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="https_token">https_token</SelectItem>
                      <SelectItem value="ssh_key">ssh_key</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Host Pattern *</label>
                  <Input
                    value={gitHostPattern}
                    onChange={(e) => setGitHostPattern(e.target.value)}
                    required
                    placeholder="github.com"
                    className="font-mono"
                  />
                </div>
                {gitKind === 'https_token' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm text-muted-foreground">Username *</label>
                    <Input
                      value={gitUsername}
                      onChange={(e) => setGitUsername(e.target.value)}
                      required
                      placeholder="octocat"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label className="text-sm text-muted-foreground">
                    Secret {gitMode?.kind === 'edit' && '(leave blank to keep current)'}
                  </label>
                  <Textarea
                    value={gitSecret}
                    onChange={(e) => setGitSecret(e.target.value)}
                    {...(gitMode?.kind === 'create' ? { required: true } : {})}
                    rows={gitKind === 'ssh_key' ? 6 : 2}
                    placeholder={
                      gitKind === 'ssh_key' ? '-----BEGIN OPENSSH PRIVATE KEY-----' : 'ghp_...'
                    }
                    className="font-mono text-xs"
                    data-testid="git-secret"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Input
                    type="checkbox"
                    checked={gitActive}
                    onChange={(e) => setGitActive(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-muted-foreground">Active</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={closeGitModal} disabled={gitSaving}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={gitSaving || !gitLabel || !gitHostPattern || !gitSecret}
                  data-testid="git-save"
                >
                  {gitSaving ? 'Saving...' : gitMode?.kind === 'create' ? 'Create' : 'Save'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Git Credentials list */}
        {gitLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : gitCreds.length === 0 ? (
          <p
            className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
            data-testid="git-empty"
          >
            No git credentials configured yet.
          </p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table data-testid="git-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Fingerprint</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gitCreds.map((c) => (
                    <TableRow key={c.id} data-testid="git-row">
                      <TableCell className="font-semibold">{c.label}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.scope}
                        {c.projectId ? `:${c.projectId}` : ''}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.kind}</TableCell>
                      <TableCell className="font-mono text-xs">{c.hostPattern}</TableCell>
                      <TableCell className="font-mono text-xs">{c.username ?? '-'}</TableCell>
                      <TableCell className="max-w-[160px] truncate font-mono text-xs">
                        {c.fingerprint}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          variant={c.isActive ? 'success' : 'default'}
                          label={c.isActive ? 'yes' : 'no'}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.createdBy}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
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
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ========== Network Proxy ========== */}
      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Network Proxy</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="text"
              placeholder="Test URL (e.g. https://www.baidu.com)"
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              className="w-64"
              data-testid="proxy-test-url"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={testRunning}
              onClick={() => {
                void testProxy();
              }}
              data-testid="proxy-test"
            >
              {testRunning ? 'Testing...' : 'Test'}
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

        {/* Proxy Dialog */}
        <Dialog
          open={proxyMode !== null}
          onOpenChange={(open) => {
            if (!open) closeProxyModal();
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Proxy Configuration</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                void onSubmitProxy(e);
              }}
              data-testid="proxy-form"
              className="space-y-4"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Protocol</label>
                  <Select
                    value={proxyProtocol ?? '_direct'}
                    onValueChange={(v) =>
                      setProxyProtocol(v === '_direct' ? null : (v as 'http' | 'https' | 'socks5'))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select protocol..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_direct">(direct mode - no proxy)</SelectItem>
                      <SelectItem value="http">http</SelectItem>
                      <SelectItem value="https">https</SelectItem>
                      <SelectItem value="socks5">socks5</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Apply To *</label>
                  <Select
                    value={proxyApplyTo}
                    onValueChange={(v) =>
                      setProxyApplyTo(v as 'all' | 'http_only' | 'all_outbound')
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_outbound">all_outbound</SelectItem>
                      <SelectItem value="all">all</SelectItem>
                      <SelectItem value="http_only">http_only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">
                    Host {proxyProtocol !== null && '*'}
                  </label>
                  <Input
                    value={proxyHost}
                    onChange={(e) => setProxyHost(e.target.value)}
                    required={proxyProtocol !== null}
                    disabled={proxyProtocol === null}
                    placeholder="127.0.0.1"
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">
                    Port {proxyProtocol !== null && '*'}
                  </label>
                  <Input
                    type="number"
                    value={proxyPort}
                    onChange={(e) =>
                      setProxyPort(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    required={proxyProtocol !== null}
                    disabled={proxyProtocol === null}
                    placeholder="7890"
                    className="font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">Username</label>
                  <Input
                    value={proxyUsername}
                    onChange={(e) => setProxyUsername(e.target.value)}
                    disabled={proxyProtocol === null}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-foreground">
                    Password {proxyCfg?.passwordHint && `(current: ${proxyCfg.passwordHint})`}
                  </label>
                  <Input
                    type="password"
                    value={proxyPassword}
                    onChange={(e) => setProxyPassword(e.target.value)}
                    disabled={proxyProtocol === null}
                    placeholder="leave blank to keep current"
                    className="font-mono"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Input
                    type="checkbox"
                    checked={proxyActive}
                    onChange={(e) => setProxyActive(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-muted-foreground">Active</span>
                </label>
              </div>
              <div className="flex justify-end gap-2">
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
          </DialogContent>
        </Dialog>

        {/* Proxy Config summary */}
        {proxyLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ) : proxyCfg ? (
          <Card data-testid="proxy-summary">
            <CardContent className="p-4">
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
                  <div>
                    <StatusBadge
                      variant={proxyCfg.isActive ? 'success' : 'default'}
                      label={proxyCfg.isActive ? 'yes' : 'no'}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Test</div>
                  <div title={proxyCfg.testMessage ?? ''}>
                    {proxyCfg.testStatus === 'success' ? (
                      <StatusBadge variant="success" label="OK" />
                    ) : proxyCfg.testStatus === 'failed' ? (
                      <StatusBadge variant="destructive" label="FAIL" />
                    ) : (
                      <StatusBadge variant="default" label="unknown" />
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
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
