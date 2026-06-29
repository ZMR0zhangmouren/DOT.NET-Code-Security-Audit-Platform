import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import ProjectMembersSection from '@/components/ProjectMembersSection';
import ScanRunNewDialog from '@/components/ScanRunNewDialog';
import UploadDropzone from '@/components/UploadDropzone';
import { Button } from '@/components/ui/button';
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

type Tab = 'overview' | 'scans' | 'members';

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
 * §9 路由 /projects/:id —— 项目详情 + 编辑/删除 + Scans tab
 */
export default function ProjectDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [saving, setSaving] = useState(false);

  const [tab, setTab] = useState<Tab>('overview');

  // Scans tab 状态
  const [versions, setVersions] = useState<CodeVersionPublic[]>([]);
  const [runs, setRuns] = useState<ScanRunPublic[]>([]);
  const [scansLoading, setScansLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showNewScan, setShowNewScan] = useState(false);
  // §5.4 多 ScanRun 对比 —— 弹窗内 select a/b
  const [showCompare, setShowCompare] = useState(false);
  const [compareA, setCompareA] = useState<string>('');
  const [compareB, setCompareB] = useState<string>('');
  // §11 Q7 双轨 C —— 记录正在 replay-with-latest 的 run id
  const [replayingId, setReplayingId] = useState<string | null>(null);

  // Members tab 状态(§4.2.8)
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (tab === 'scans') {
      void refreshScans();
    } else if (tab === 'members') {
      void refreshMembers();
    }
  }, [tab, refreshScans, refreshMembers]);

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
      setEditing(false);
      void refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!id) return;
    if (!project) return;
    if (!confirm(`Delete project "${project.name}"? This is permanent.`)) return;
    try {
      await api.delete(`/projects/${id}`);
      navigate('/projects');
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function onUploaded(_cv: CodeVersionPublic): void {
    setShowUpload(false);
    void refreshScans();
  }

  function onCreatedRun(run: ScanRunPublic): void {
    setShowNewScan(false);
    navigate(`/projects/${id}/scans/${run.id}`);
  }

  // §11 Q7 双轨 C —— 用最新 Skill 重扫
  async function onReplayWithLatest(runId: string): Promise<void> {
    if (!id) return;
    setReplayingId(runId);
    try {
      const fresh = await api.post<ScanRunPublic>(`/scan-runs/${runId}/replay-with-latest`);
      // 跳到新 ScanRun 的实时页
      navigate(`/projects/${id}/scans/${fresh.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setReplayingId(null);
    }
  }

  return (
    <main className="container py-8">
      <Link to="/projects" className="text-sm text-muted-foreground underline">
        ← Projects
      </Link>

      {loading && <p className="mt-4 text-sm text-muted-foreground">Loading...</p>}

      {err && (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {project && (
        <>
          <header className="mt-3 mb-4 flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold">{project.name}</h1>
              <p className="text-sm text-muted-foreground">
                {project.id} · {project.visibility} · {project.status}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setEditing((v) => !v)}
                data-testid="project-edit"
              >
                {editing ? 'Cancel' : 'Edit'}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void onDelete()}
                data-testid="project-delete"
              >
                Delete
              </Button>
            </div>
          </header>

          {project.description && (
            <p className="mb-4 text-sm text-muted-foreground">{project.description}</p>
          )}

          {editing && (
            <form
              onSubmit={(e) => {
                void onSave(e);
              }}
              className="mb-4 rounded-lg border bg-card p-4"
            >
              <h2 className="mb-3 text-lg font-semibold">Edit Project</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-muted-foreground">Name *</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={128}
                    className="rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Visibility</span>
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                    className="rounded-md border border-input bg-background px-3 py-2"
                  >
                    <option value="private">private</option>
                    <option value="public">public</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'archived')}
                    className="rounded-md border border-input bg-background px-3 py-2"
                  >
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="text-muted-foreground">Description</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="rounded-md border border-input bg-background px-3 py-2"
                  />
                </label>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !name.trim()} data-testid="project-save">
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          )}

          <nav className="mb-4 flex flex-wrap gap-2 border-b pb-2">
            <button
              type="button"
              onClick={() => setTab('overview')}
              className={
                tab === 'overview'
                  ? 'inline-flex items-center gap-1 rounded-t border-b-2 border-primary bg-card px-3 py-1 text-sm font-medium'
                  : 'inline-flex items-center gap-1 rounded px-3 py-1 text-sm text-muted-foreground hover:bg-muted'
              }
              data-testid="tab-overview"
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setTab('scans')}
              className={
                tab === 'scans'
                  ? 'inline-flex items-center gap-1 rounded-t border-b-2 border-primary bg-card px-3 py-1 text-sm font-medium'
                  : 'inline-flex items-center gap-1 rounded px-3 py-1 text-sm text-muted-foreground hover:bg-muted'
              }
              data-testid="tab-scans"
            >
              Scans
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                §5.3
              </span>
            </button>
            <Link
              to={`/projects/${id}/vuln-library`}
              className={
                location.pathname.includes('/vuln-library')
                  ? 'inline-flex items-center gap-1 rounded-t border-b-2 border-primary bg-card px-3 py-1 text-sm font-medium'
                  : 'inline-flex items-center gap-1 rounded px-3 py-1 text-sm text-muted-foreground hover:bg-muted'
              }
              data-testid="tab-vuln-library"
            >
              Vuln Library
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                §5.5
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setTab('members')}
              className={
                tab === 'members'
                  ? 'inline-flex items-center gap-1 rounded-t border-b-2 border-primary bg-card px-3 py-1 text-sm font-medium'
                  : 'inline-flex items-center gap-1 rounded px-3 py-1 text-sm text-muted-foreground hover:bg-muted'
              }
              data-testid="tab-members"
            >
              Members
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                §4.2.8
              </span>
            </button>
          </nav>

          {tab === 'overview' && (
            <section className="rounded-lg border bg-card p-6 text-sm">
              <dl className="grid grid-cols-[120px_1fr] gap-2">
                <dt className="text-muted-foreground">Project ID</dt>
                <dd className="font-mono text-xs">{project.id}</dd>
                <dt className="text-muted-foreground">Owner</dt>
                <dd className="font-mono text-xs">{project.ownerId}</dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(project.createdAt).toLocaleString()}</dd>
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{new Date(project.updatedAt).toLocaleString()}</dd>
              </dl>
              <div className="mt-6 border-t pt-4">
                <h3 className="mb-2 text-sm font-semibold">
                  已接通章节(§5.1 / §5.3 / §4.2.8 / §5.5 / §5.7)
                </h3>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>
                    <strong>项目 (5.1):</strong> CRUD + 删除 + 编辑;Owner 可改所有字段
                  </li>
                  <li>
                    <strong>Versions (5.2 P0 zip):</strong> CodeVersion 表已落库;zip 上传 UI 已在
                    Scans 标签里(显示 N versions + 上传按钮);Phase 2 接私有 git / GitHub 拉取
                  </li>
                  <li>
                    <strong>Scans (5.3):</strong> 列表 + 实时页 + 报告 + 多 ScanRun 对比(5.4) +
                    Quality Gate 字段已显示;入口覆盖统计(2026-06 commit 1bc9df4)
                  </li>
                  <li>
                    <strong>Members (4.2.8):</strong> 列表 / grant by username / role 切换 /
                    revoke(2026-06 commit bde81f9);仅 owner 或 lead 可改
                  </li>
                  <li>
                    <strong>Vuln Library (5.5):</strong> 列表 + 详情 + 状态流转(2026-06 commit
                    b8ddff4)
                  </li>
                  <li>
                    <strong>系统配置 (5.7):</strong> AI Key + git 凭证 + 代理 + 用户管理 (2026-06
                    commit 6b8cb83)
                  </li>
                </ul>
              </div>
            </section>
          )}

          {tab === 'scans' && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">Scans</h2>
                <span className="text-xs text-muted-foreground">
                  {versions.length} versions · {runs.length} runs
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void refreshScans();
                    }}
                    data-testid="scans-refresh"
                  >
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowUpload((v) => !v)}
                    data-testid="scans-upload-toggle"
                  >
                    {showUpload ? '取消上传' : '+ Upload Version'}
                  </Button>
                  <Button
                    variant="outline"
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
                    {showCompare ? '取消对比' : 'Compare'}
                  </Button>
                  <Button onClick={() => setShowNewScan((v) => !v)} data-testid="scans-new">
                    + New Scan
                  </Button>
                </div>
              </div>

              {showCompare && (
                <div
                  className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
                  data-testid="scans-compare-panel"
                >
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Baseline (A)</span>
                    <select
                      value={compareA}
                      onChange={(e) => setCompareA(e.target.value)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                      data-testid="compare-select-a"
                    >
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id} ({r.status})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">Target (B)</span>
                    <select
                      value={compareB}
                      onChange={(e) => setCompareB(e.target.value)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                      data-testid="compare-select-b"
                    >
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id} ({r.status})
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    disabled={!compareA || !compareB || compareA === compareB}
                    onClick={() => {
                      navigate(
                        `/projects/${id}/scans/diff?a=${encodeURIComponent(compareA)}&b=${encodeURIComponent(compareB)}`,
                      );
                    }}
                    data-testid="compare-go"
                  >
                    Compare →
                  </Button>
                </div>
              )}

              {showUpload && id && (
                <div className="rounded-lg border bg-card p-4" data-testid="scans-upload-panel">
                  <h3 className="mb-3 text-sm font-semibold">Upload Code Version (zip)</h3>
                  <UploadDropzone projectId={id} onSuccess={onUploaded} />
                </div>
              )}

              {showNewScan && id && (
                <ScanRunNewDialog
                  projectId={id}
                  versions={versions}
                  onClose={() => setShowNewScan(false)}
                  onCreated={onCreatedRun}
                />
              )}

              {scansLoading ? (
                <p className="text-sm text-muted-foreground">Loading scans...</p>
              ) : versions.length === 0 ? (
                <div
                  className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
                  data-testid="scans-empty-versions"
                >
                  还没有 CodeVersion —— 点 "+ Upload Version" 上传一个 zip,再创建 ScanRun。
                </div>
              ) : runs.length === 0 ? (
                <div
                  className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
                  data-testid="scans-empty-runs"
                >
                  还没有 ScanRun —— 点 "+ New Scan" 创建第一个。
                </div>
              ) : (
                <div
                  className="overflow-x-auto rounded-lg border bg-card text-sm"
                  data-testid="scans-table-wrap"
                >
                  <table className="w-full" data-testid="scans-table">
                    <thead>
                      <tr className="border-b bg-muted text-left">
                        <th className="p-2">Run ID</th>
                        <th className="p-2">Code Version</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Coverage</th>
                        <th className="p-2">Gate</th>
                        <th className="p-2">Started</th>
                        <th className="p-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r) => {
                        const ver = versions.find((v) => v.id === r.codeVersionId);
                        return (
                          <tr key={r.id} className="border-b last:border-0" data-testid="scans-row">
                            <td className="p-2 font-mono text-xs">{r.id}</td>
                            <td className="p-2 text-xs">
                              {ver ? (ver.versionLabel ?? ver.id) : r.codeVersionId}
                            </td>
                            <td className="p-2">
                              <span
                                className={`rounded px-2 py-0.5 text-xs ${scanStatusClass(r.status)}`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="p-2">
                              <span
                                className={`rounded px-2 py-0.5 text-xs ${coverageClass(r.apiCoverageStatus)}`}
                              >
                                {r.apiCoverageStatus}
                              </span>
                            </td>
                            <td className="p-2">
                              <span
                                className={`rounded px-2 py-0.5 text-xs ${gateClass(r.gateDecision)}`}
                              >
                                {r.gateDecision}
                              </span>
                            </td>
                            <td className="p-2 text-xs text-muted-foreground">
                              {r.startedAt
                                ? new Date(r.startedAt).toLocaleString()
                                : new Date(r.queuedAt).toLocaleString()}
                            </td>
                            <td className="p-2">
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
                                  onClick={() => {
                                    void onReplayWithLatest(r.id);
                                  }}
                                  data-testid="replay-with-latest"
                                >
                                  {replayingId === r.id ? 'Replaying...' : 'Replay (Latest Skill)'}
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
            </section>
          )}

          {tab === 'members' && (
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
              onRoleChange={async (userId, newRole) => {
                try {
                  await api.patch(`/projects/${id}/members/${userId}`, {
                    projectRole: newRole,
                  });
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
          )}
        </>
      )}
    </main>
  );
}
