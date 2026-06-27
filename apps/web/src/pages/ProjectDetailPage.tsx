import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

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

/**
 * §9 路由 /projects/:id —— 项目详情 + 编辑/删除
 */
export default function ProjectDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    void refresh();
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

          <nav className="mb-4 flex gap-2 border-b">
            <Button variant="ghost" className="rounded-b-none border-b-2 border-primary" disabled>
              Overview
            </Button>
            <Button variant="ghost" disabled>
              Versions
            </Button>
            <Button variant="ghost" disabled>
              Scans
            </Button>
            <Button variant="ghost" disabled>
              Members
            </Button>
          </nav>

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
            <p className="mt-4 text-muted-foreground">
              Versions / Scans / Members 等标签页将在 §5.2 / §5.3 / §4.2.8 实施时接入。
            </p>
          </section>
        </>
      )}
    </main>
  );
}
