import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';

/**
 * §9 路由 /projects/:id/vuln-library —— 漏洞库列表(根因级)
 *
 * MVP 占位;Phase 1 接入 VulnerabilityModule 后填充真实数据。
 */
export default function VulnLibraryPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <main className="container py-8">
      <header className="mb-6">
        <Link to={`/projects/${id ?? ''}`} className="text-sm text-muted-foreground underline">
          ← 项目详情
        </Link>
        <h1 className="mt-2 text-3xl font-bold">漏洞库</h1>
        <p className="text-sm text-muted-foreground">
          §5.5 · 根因级漏洞聚合 · Phase 1 接入 VulnerabilityModule
        </p>
      </header>
      <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        漏洞库视图按 fingerprint(归一化)聚合,跨 CodeVersion 追踪同一根因漏洞。MVP 阶段尚未填充数据。
      </section>
      <Button variant="outline" className="mt-4" disabled>
        按等级筛选(Phase 1)
      </Button>
    </main>
  );
}
