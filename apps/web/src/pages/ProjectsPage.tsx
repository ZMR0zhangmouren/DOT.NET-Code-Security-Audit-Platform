import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

/**
 * §9 路由 /projects —— 项目列表
 *
 * MVP 占位:展示一个提示卡片 + 新建按钮;Phase 2 接 ProjectModule 后填充真实数据。
 */
export default function ProjectsPage(): React.ReactElement {
  return (
    <main className="container py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">项目列表</h1>
          <p className="text-sm text-muted-foreground">
            §5.1 项目管理 · Phase 2 接入 ProjectModule
          </p>
        </div>
        <Button disabled>新建项目(Phase 2)</Button>
      </header>
      <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        暂无项目。Phase 2 完成后此处展示项目卡片网格,支持筛选/搜索/分页。
      </section>
      <Link to="/" className="mt-4 inline-block text-sm underline">
        返回首页
      </Link>
    </main>
  );
}
