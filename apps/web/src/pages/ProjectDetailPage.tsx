import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';

/**
 * §9 路由 /projects/:id —— 项目详情
 *
 * MVP 占位:展示项目 ID + 三个标签页占位(版本列表 / 扫描历史 / 成员)。
 */
export default function ProjectDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <main className="container py-8">
      <header className="mb-6">
        <Link to="/projects" className="text-sm text-muted-foreground underline">
          ← 项目列表
        </Link>
        <h1 className="mt-2 text-3xl font-bold">项目 {id}</h1>
        <p className="text-sm text-muted-foreground">§5.1 · 详情 / 版本 / 扫描 / 成员</p>
      </header>
      <nav className="mb-4 flex gap-2 border-b">
        <Button variant="ghost" className="rounded-b-none border-b-2 border-primary" disabled>
          版本列表
        </Button>
        <Button variant="ghost" disabled>
          扫描历史
        </Button>
        <Button variant="ghost" disabled>
          成员
        </Button>
      </nav>
      <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        三个标签页内容将在 Phase 2(ProjectModule)接入。
      </section>
    </main>
  );
}
