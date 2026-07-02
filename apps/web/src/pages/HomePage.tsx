import { COVERAGE_MODE, type CoverageMode } from '@platform/shared';
import { Activity, Bug, FolderOpen, Plus, ScanSearch, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface HealthPayload {
  status: 'ok';
  uptimeSec: number;
  coverageModeDefault: CoverageMode;
  nodeVersion: string;
  dbTables: number;
  queueDepth?: number;
  queueRunning?: number;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
}

interface ProjectStats {
  total: number;
  active: number;
  scanRuns: number;
  vulnsFound: number;
}

/**
 * 首页 Dashboard —— 统计看板 + 最近项目 + 快捷操作
 *
 * 登录后第一眼：全局数据总览 + 快速入口
 */
export default function HomePage(): React.ReactElement {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<ProjectStats>({
    total: 0,
    active: 0,
    scanRuns: 0,
    vulnsFound: 0,
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [h, p] = await Promise.all([
          fetch('/api/health').then((r) => (r.ok ? (r.json() as Promise<HealthPayload>) : null)),
          api.get<Project[]>('/projects').catch(() => [] as Project[]),
        ]);
        if (h) setHealth(h);
        setProjects(p);
        setStats({
          total: p.length,
          active: p.filter((pr) => pr.status === 'active').length,
          scanRuns: 0,
          vulnsFound: 0,
        });
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const recentProjects = projects.slice(0, 5);

  return (
    <main className="container py-6">
      <PageHeader
        title="总览"
        description={`运行时长 ${health?.uptimeSec ? Math.floor(health.uptimeSec / 3600) + 'h ' + Math.floor((health.uptimeSec % 3600) / 60) + 'm' : '...'} · Node ${health?.nodeVersion ?? '...'} · ${health?.dbTables ?? '...'} 表`}
      />

      {err && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {err}
        </p>
      )}

      {/* 统计卡片 */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="glass-card">
              <CardContent className="p-5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="mt-2 h-8 w-12" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              title="项目总数"
              value={stats.total}
              description={`${stats.active} 活跃`}
              icon={FolderOpen}
            />
            <StatCard
              title="扫描次数"
              value={stats.scanRuns}
              description={health ? `queue: ${health.queueDepth ?? 0}` : undefined}
              icon={ScanSearch}
            />
            <StatCard title="漏洞发现" value={stats.vulnsFound} icon={Bug} />
            <StatCard
              title="系统状态"
              value={health?.status === 'ok' ? '正常' : '异常'}
              description={`coverage: ${health?.coverageModeDefault ?? '...'}`}
              icon={Activity}
            />
          </>
        )}
      </section>

      {/* 最近项目 + 快捷操作 */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* 最近项目 */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">最近项目</h2>
            <Link to="/projects">
              <Button variant="ghost" size="sm">
                查看全部 →
              </Button>
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : recentProjects.length === 0 ? (
            <EmptyState
              title="暂无项目"
              description="创建你的第一个代码审计项目"
              action={{ label: '新建项目', onClick: () => navigate('/projects') }}
            />
          ) : (
            <div className="space-y-2">
              {recentProjects.map((p) => (
                <Link key={p.id} to={`/projects/${p.id}`}>
                  <Card className="glass-card transition-colors hover:bg-accent/50">
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {p.description ?? '(无描述)'}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 快捷操作 */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">快捷操作</h2>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => navigate('/projects')}
            >
              <Plus className="mr-2 h-4 w-4" />
              新建项目
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => navigate('/projects')}
            >
              <Upload className="mr-2 h-4 w-4" />
              上传代码
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => navigate('/projects')}
            >
              <ScanSearch className="mr-2 h-4 w-4" />
              触发扫描
            </Button>
          </div>

          {/* 系统信息 */}
          {health && (
            <Card className="mt-4 glass-card">
              <CardContent className="p-4 text-xs space-y-1">
                <p className="font-medium text-sm mb-2">系统信息</p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">API 状态</span>
                  <span className="font-mono text-success">{health.status}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">Node</span>
                  <span className="font-mono">{health.nodeVersion}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">DB 表</span>
                  <span className="font-mono">{health.dbTables}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-muted-foreground">Coverage</span>
                  <span className="font-mono">{health.coverageModeDefault}</span>
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        可用 coverage_mode: <code className="font-mono">{COVERAGE_MODE.join(' / ')}</code>
      </p>
    </main>
  );
}
