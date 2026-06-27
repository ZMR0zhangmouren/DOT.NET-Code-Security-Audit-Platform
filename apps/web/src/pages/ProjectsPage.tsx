import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

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
 * §9 路由 /projects —— 项目列表 + 新建
 */
export default function ProjectsPage(): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');

  async function refresh(): Promise<void> {
    setLoading(true);
    setErr(null);
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      const data = await api.get<Project[]>(`/projects${qs}`);
      setProjects(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      const created = await api.post<Project>('/projects', {
        name,
        description: description.trim() || undefined,
        visibility,
      });
      setShowNew(false);
      setName('');
      setDescription('');
      setProjects((prev) => [created, ...prev]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function onArchive(p: Project): Promise<void> {
    if (!confirm(`Archive project "${p.name}"?`)) return;
    try {
      await api.patch(`/projects/${p.id}`, { status: 'archived' });
      void refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <main className="container py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">Section 5.1 - project management</p>
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            placeholder="Search..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void refresh();
            }}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <Button variant="outline" onClick={() => void refresh()} data-testid="refresh">
            Refresh
          </Button>
          <Button onClick={() => setShowNew((v) => !v)} data-testid="new-project">
            + New Project
          </Button>
        </div>
      </header>

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
          <h2 className="mb-3 text-lg font-semibold">New Project</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
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
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="rounded-md border border-input bg-background px-3 py-2"
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
            <Button type="submit" disabled={creating || !name.trim()} data-testid="create-project">
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : projects.length === 0 ? (
        <p
          className="rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="empty"
        >
          No projects yet. Click "+ New Project" to create one.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-testid="project-list">
          {projects.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border bg-card p-4 shadow-sm"
              data-testid="project-card"
            >
              <div className="flex items-start justify-between">
                <Link
                  to={`/projects/${p.id}`}
                  className="font-semibold hover:underline"
                  data-testid="project-name"
                >
                  {p.name}
                </Link>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    p.status === 'active'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {p.description ?? '(no description)'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {p.visibility} - {new Date(p.createdAt).toLocaleString()}
              </p>
              {p.status === 'active' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => {
                    void onArchive(p);
                  }}
                >
                  Archive
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
