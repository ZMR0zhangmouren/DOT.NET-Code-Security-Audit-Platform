import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { PageHeader } from '@/components/PageHeader';
import ProjectMembersSection from '@/components/ProjectMembersSection';
import ScanRunNewDialog from '@/components/ScanRunNewDialog';
import { StatusBadge } from '@/components/StatusBadge';
import UploadDropzone from '@/components/UploadDropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import {
  coverageClass,
  gateClass,
  scanStatusClass,
  type CodeVersionPublic,
  type ScanRunPublic,
} from '@/lib/scanTypes';

interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  visibility: 'public' | 'private';
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

type ProjectMemberRole = 'lead' | 'contributor' | 'viewer';

interface ProjectMember {
  userId: string;
  username: string;
  email: string;
  displayName: string | null;
  projectRole: ProjectMemberRole;
  grantedBy: string;
  grantedAt: number;
}

/**
 * §9 路由 /projects/:id —— 项目详情 + Tabs（概览/扫描/版本/成员）
 */
export default function ProjectDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 编辑模式
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [saving, setSaving] = useState(false);

  // Scans tab
  const [versions, setVersions] = useState<CodeVersionPublic[]>([]);
  const [runs, setRuns] = useState<ScanRunPublic[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showNewScan, setShowNewScan] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareA, setCompareA] = useState<string>('');
  const [compareB, setCompareB] = useState<string>('');
  const [replayingId, setReplayingId] = useState<string | null>(null);

  // Members tab
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [membersSearch, setMembersSearch] = useState('');

  // 刷新项目
  async function refresh(): Promise<void> {
    if (!id) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await api.get<Project>(`/projects/${id}`);
      setProject(data);
      setName(data.name);
      setDescription(data.description ?? '');
      setVisibility(data.visibility);
      setStatus(data.status);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const refreshScans = useCallback(async (): Promise<void> => {
    if (!id) return;
    setScansLoading(true);
    try {
      const [vs, rs] = await Promise.all([
        api.get<CodeVersionPublic[]>(`/projects/${id}/code-versions`),
        api.get<ScanRunPublic[]>(`/projects/${id}/scan-runs`),
      ]);
      setVersions(vs);
      setRuns(rs);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setScansLoading(false);
    }
  }, [id]);

  const refreshMembers = useCallback(async (): Promise<void> => {
    if (!id) return;
    setMembersLoading(true);
    try {
      const list = await api.get<ProjectMember[]>(`/projects/${id}/members`);
      setMembers(list);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setMembersLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    void refreshScans();
    void refreshMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onSave(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setErr(null);
    try {
      await api.patch(`/projects/${id}`, {
        name,
        description: description.trim() || null,
        visibility,
        status,
      });
      setEditOpen(false);
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!id || !project) return;
    if (!confirm(`Delete project "${project.name}"? This is permanent.`)) return;
    try {
      await api.delete(`/projects/${id}`);
      navigate('/projects');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function onReplayWithLatest(runId: string): Promise<void> {
    if (!id) return;
    setReplayingId(runId);
    try {
      const fresh = await api.post<ScanRunPublic>(`/scan-runs/${runId}/replay-with-latest`);
      navigate(`/projects/${id}/scans/${fresh.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setReplayingId(null);
    }
  }

  if (loading) {
    return (
      <main className="container py-6">
        <div className="space-y-4">
          <div className="h-8 w-48 rounded bg-muted animate-pulse" />
          <div className="h-4 w-64 rounded bg-muted animate-pulse" />
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="container py-6">
        <p className="text-sm text-destructive" role="alert">
          {err ?? '项目未找到'}
        </p>
      </main>
    );
  }

  return (
    <main className="container py-6">
      {err && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      <PageHeader
        title={project.name}
        description={
          project.description ??
          `${project.visibility} · ${project.status} · ${project.id.slice(0, 8)}...`
        }
        breadcrumbs={[{ label: '项目列表', to: '/projects' }]}
        badge={
          <StatusBadge
            label={project.status}
            variant={project.status === 'active' ? 'success' : 'default'}
          />
        }
        actions={[
          { label: 'Edit', variant: 'outline', onClick: () => setEditOpen(true) },
          { label: 'Delete', variant: 'destructive', onClick: () => void onDelete() },
        ]}
      />

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="glass-popover max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              void onSave(e);
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground">Name *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={128}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-muted-foreground">Visibility</label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as 'public' | 'private')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">private</SelectItem>
                    <SelectItem value="public">public</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-muted-foreground">Status</label>
                <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'archived')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">active</SelectItem>
                    <SelectItem value="archived">archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()} data-testid="project-save">
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="overview" data-testid="tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="scans" data-testid="tab-scans">
            Scans
          </TabsTrigger>
          <TabsTrigger value="versions" data-testid="tab-versions">
            Versions
          </TabsTrigger>
          <TabsTrigger value="members" data-testid="tab-members">
            Members
          </TabsTrigger>
          <TabsTrigger value="vuln-library" data-testid="tab-vuln-library" asChild>
            <Link to={`/projects/${id}/vuln-library`}>Vuln Library</Link>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">项目信息</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <dl className="grid gap-2 sm:grid-cols-[120px_1fr]">
                <dt className="text-muted-foreground">Project ID</dt>
                <dd className="font-mono text-xs">{project.id}</dd>
                <dt className="text-muted-foreground">Owner</dt>
                <dd className="font-mono text-xs">{project.ownerId}</dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(project.createdAt).toLocaleString()}</dd>
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{new Date(project.updatedAt).toLocaleString()}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Code Versions{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  ({versions.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No code versions yet. Go to the Scans tab and upload a zip file.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted text-left">
                        <th className="p-2">Label</th>
                        <th className="p-2">Source</th>
                        <th className="p-2">Files</th>
                        <th className="p-2">LOC</th>
                        <th className="p-2">Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.id} className="border-b" data-testid="version-row">
                          <td className="p-2 font-mono font-semibold">
                            {v.versionLabel ?? '(no label)'}
                          </td>
                          <td className="p-2">{v.sourceType}</td>
                          <td className="p-2">{v.fileCount}</td>
                          <td className="p-2">{v.locCount}</td>
                          <td className="p-2">{new Date(v.uploadedAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scans Tab */}
        <TabsContent value="scans" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {versions.length} versions · {runs.length} runs
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshScans()}
                data-testid="scans-refresh"
              >
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUpload((v) => !v)}
                data-testid="scans-upload-toggle"
              >
                {showUpload ? '取消上传' : '+ Upload Version'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (runs.length < 2) {
                    setErr('需要至少 2 个 ScanRun 才能对比');
                    return;
                  }
                  setCompareA(runs[1]?.id ?? '');
                  setCompareB(runs[0]?.id ?? '');
                  setShowCompare((v) => !v);
                }}
                disabled={runs.length < 2}
                data-testid="scans-compare-toggle"
              >
                Compare
              </Button>
              <Button size="sm" onClick={() => setShowNewScan((v) => !v)} data-testid="scans-new">
                + New Scan
              </Button>
            </div>
          </div>

          {showCompare && (
            <div
              className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
              data-testid="scans-compare-panel"
            >
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Baseline (A)</label>
                <Select value={compareA} onValueChange={setCompareA}>
                  <SelectTrigger className="w-[200px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.id.slice(0, 8)}... ({r.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Target (B)</label>
                <Select value={compareB} onValueChange={setCompareB}>
                  <SelectTrigger className="w-[200px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.id.slice(0, 8)}... ({r.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                disabled={!compareA || !compareB || compareA === compareB}
                onClick={() =>
                  navigate(
                    `/projects/${id}/scans/diff?a=${encodeURIComponent(compareA)}&b=${encodeURIComponent(compareB)}`,
                  )
                }
                data-testid="compare-go"
              >
                Compare →
              </Button>
            </div>
          )}

          {showUpload && id && (
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Upload Code Version (zip)</CardTitle>
              </CardHeader>
              <CardContent>
                <UploadDropzone
                  projectId={id}
                  onSuccess={(_cv) => {
                    setShowUpload(false);
                    void refreshScans();
                  }}
                />
              </CardContent>
            </Card>
          )}

          {showNewScan && id && (
            <ScanRunNewDialog
              projectId={id}
              versions={versions}
              onClose={() => setShowNewScan(false)}
              onCreated={(run) => {
                setShowNewScan(false);
                navigate(`/projects/${id}/scans/${run.id}`);
              }}
            />
          )}

          {scansLoading ? (
            <p className="text-sm text-muted-foreground">Loading scans...</p>
          ) : runs.length === 0 ? (
            <div
              className="rounded-lg border p-6 text-center text-sm text-muted-foreground"
              data-testid="scans-empty-runs"
            >
              {versions.length === 0
                ? '还没有 CodeVersion —— 点 "+ Upload Version" 上传一个 zip'
                : '还没有 ScanRun —— 点 "+ New Scan" 创建第一个'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border" data-testid="scans-table-wrap">
              <table className="w-full text-sm" data-testid="scans-table">
                <thead>
                  <tr className="border-b bg-muted text-left">
                    <th className="p-3">Run ID</th>
                    <th className="p-3">Version</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Coverage</th>
                    <th className="p-3">Gate</th>
                    <th className="p-3">Started</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const ver = versions.find((v) => v.id === r.codeVersionId);
                    return (
                      <tr key={r.id} className="border-b last:border-0" data-testid="scans-row">
                        <td className="p-3 font-mono text-xs">{r.id.slice(0, 8)}...</td>
                        <td className="p-3 text-xs">
                          {ver
                            ? (ver.versionLabel ?? ver.id.slice(0, 8))
                            : r.codeVersionId.slice(0, 8)}
                        </td>
                        <td className="p-3">
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${scanStatusClass(r.status)}`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="p-3">
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${coverageClass(r.apiCoverageStatus)}`}
                          >
                            {r.apiCoverageStatus}
                          </span>
                        </td>
                        <td className="p-3">
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${gateClass(r.gateDecision)}`}
                          >
                            {r.gateDecision}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {r.startedAt
                            ? new Date(r.startedAt).toLocaleString()
                            : new Date(r.queuedAt).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(`/projects/${id}/scans/${r.id}`)}
                              data-testid="scans-open"
                            >
                              Open
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={replayingId === r.id}
                              onClick={() => void onReplayWithLatest(r.id)}
                              data-testid="replay-with-latest"
                            >
                              {replayingId === r.id ? 'Replaying...' : 'Replay'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Versions Tab */}
        <TabsContent value="versions" className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {versions.length} version{versions.length !== 1 ? 's' : ''}
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void refreshScans()}
                data-testid="versions-refresh"
              >
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowUpload(true);
                }}
                data-testid="versions-upload-jump"
              >
                + Upload Version
              </Button>
            </div>
          </div>

          {scansLoading ? (
            <p className="text-sm text-muted-foreground">Loading versions...</p>
          ) : versions.length === 0 ? (
            <Card
              className="glass-card p-6 text-center text-sm text-muted-foreground"
              data-testid="versions-empty"
            >
              No code versions yet. Upload a zip to get started.
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border" data-testid="versions-table-wrap">
              <table className="w-full text-sm" data-testid="versions-table">
                <thead>
                  <tr className="border-b bg-muted text-left">
                    <th className="p-3">Label</th>
                    <th className="p-3">Source</th>
                    <th className="p-3">Files</th>
                    <th className="p-3">LOC</th>
                    <th className="p-3">Checksum</th>
                    <th className="p-3">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.id} className="border-b" data-testid="versions-row">
                      <td className="p-3 font-mono font-semibold text-xs">
                        {v.versionLabel ?? '(no label)'}
                      </td>
                      <td className="p-3 text-xs">{v.sourceType}</td>
                      <td className="p-3 text-xs">{v.fileCount}</td>
                      <td className="p-3 text-xs">{v.locCount}</td>
                      <td className="p-3 font-mono text-xs">{v.checksum.slice(0, 12)}…</td>
                      <td className="p-3 text-xs">{new Date(v.uploadedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Members Tab */}
        <TabsContent value="members">
          <ProjectMembersSection
            projectId={id!}
            members={members}
            loading={membersLoading}
            showAdd={showAddMember}
            onShowAdd={() => setShowAddMember(true)}
            onCancelAdd={() => setShowAddMember(false)}
            onAdded={() => {
              setShowAddMember(false);
              void refreshMembers();
            }}
            search={membersSearch}
            onSearchChange={setMembersSearch}
            onRoleChange={async (userId, newRole) => {
              try {
                await api.patch(`/projects/${id}/members/${userId}`, { projectRole: newRole });
                void refreshMembers();
              } catch (e) {
                setErr(e instanceof ApiError ? e.message : (e as Error).message);
              }
            }}
            onRevoke={async (userId, username) => {
              if (!confirm(`Revoke member "${username}" from this project?`)) return;
              try {
                await api.delete(`/projects/${id}/members/${userId}`);
                void refreshMembers();
              } catch (e) {
                setErr(e instanceof ApiError ? e.message : (e as Error).message);
              }
            }}
          />
        </TabsContent>

        {/* Vuln Library Tab — redirects via asChild Link */}
        <TabsContent value="vuln-library">
          <p className="text-sm text-muted-foreground p-4">跳转到漏洞库页面...</p>
        </TabsContent>
      </Tabs>
    </main>
  );
}
