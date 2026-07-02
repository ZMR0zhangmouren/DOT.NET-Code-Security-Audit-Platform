import { Plus, RefreshCw, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
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
import { Textarea } from '@/components/ui/textarea';
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
 * §9 路由 /projects —— 项目卡片网格 + 搜索 + 新建 Dialog
 */
export default function ProjectsPage(): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  // 新建项目
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [creating, setCreating] = useState(false);

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
      setDialogOpen(false);
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
    <main className="container py-6">
      <PageHeader
        title="项目列表"
        description="管理所有代码审计项目"
        actions={[
          {
            label: '新建项目',
            icon: Plus,
            onClick: () => setDialogOpen(true),
          },
        ]}
      />

      {err && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {/* 搜索栏 */}
      <div className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="搜索项目..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void refresh();
            }}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={() => void refresh()} data-testid="refresh">
          <RefreshCw className="mr-1 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* 项目列表 */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="glass-card">
              <CardContent className="p-5">
                <div className="h-5 w-2/3 rounded bg-muted animate-pulse" />
                <div className="mt-2 h-4 w-full rounded bg-muted animate-pulse" />
                <div className="mt-2 h-3 w-1/3 rounded bg-muted animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          title={q.trim() ? '未找到匹配项目' : '暂无项目'}
          description={q.trim() ? '尝试其他搜索词' : '创建你的第一个代码审计项目'}
          action={
            q.trim()
              ? {
                  label: '清除搜索',
                  onClick: () => {
                    setQ('');
                    void refresh();
                  },
                }
              : { label: '新建项目', onClick: () => setDialogOpen(true) }
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-list">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} data-testid="project-card">
              <Card className="glass-card h-full transition-all hover:shadow-md hover:border-primary/30">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base" data-testid="project-name">
                      {p.name}
                    </CardTitle>
                    <StatusBadge
                      label={p.status}
                      variant={p.status === 'active' ? 'success' : 'default'}
                    />
                  </div>
                </CardHeader>
                <CardContent className="pb-4">
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {p.description ?? '(无描述)'}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.visibility}</span>
                    <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                  {p.status === 'active' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2 h-7 text-xs"
                      onClick={(e) => {
                        e.preventDefault();
                        void onArchive(p);
                      }}
                    >
                      Archive
                    </Button>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* 新建项目 Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-popover">
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              void onCreate(e);
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-name" className="text-sm text-muted-foreground">
                项目名称 *
              </label>
              <Input
                id="proj-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={128}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-vis" className="text-sm text-muted-foreground">
                可见性
              </label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as 'public' | 'private')}
              >
                <SelectTrigger id="proj-vis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">private</SelectItem>
                  <SelectItem value="public">public</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-desc" className="text-sm text-muted-foreground">
                描述
              </label>
              <Textarea
                id="proj-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDialogOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating || !name.trim()}
                data-testid="create-project"
              >
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
