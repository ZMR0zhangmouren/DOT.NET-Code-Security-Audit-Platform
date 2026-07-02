import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * ErrorBoundary —— 捕获懒加载组件渲染异常,显示降级 UI 而非白屏
 */
class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): { hasError: boolean; error: Error } {
    return { hasError: true, error };
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <main className="container py-6">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
              <h2 className="text-lg font-semibold text-destructive">页面加载失败</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {this.state.error?.message ?? '未知错误'}
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
              >
                刷新页面
              </Button>
            </div>
          </main>
        )
      );
    }
    return this.props.children;
  }
}

/** 懒加载包装 + Suspense fallback + ErrorBoundary */
function LazyPage({
  loader,
}: {
  loader: () => Promise<{ default: ComponentType }>;
}): React.ReactElement {
  const Lazy = lazy(loader);
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <main className="container py-6">
            <div className="space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
          </main>
        }
      >
        <Lazy />
      </Suspense>
    </ErrorBoundary>
  );
}

// 仅 LoginPage 不安 lazy(它是独立路由,初次访问即需,且不依赖 AppLayout)
import LoginPage from '@/pages/LoginPage';

/**
 * 根组件 —— 路由出口,全部页面 React.lazy 代码分割
 *
 * §9 路由表:
 * - /                                            HomePage
 * - /login                                       LoginPage
 * - /projects                                    ProjectsPage
 * - /projects/:id                                ProjectDetailPage
 * - /projects/:id/scans/:runId                   ScanPage
 * - /projects/:id/scans/:runId/report            ReportPage (§5.4)
 * - /projects/:id/scans/:runId/trace             TracePage (§1.2/2.7 Agent Trace)
 * - /projects/:id/scans/diff?a=&b=               DiffPage (§5.4 多 ScanRun 对比)
 * - /projects/:id/vuln-library                   VulnLibraryPage (§5.5)
 * - /projects/:id/vuln-library/:libId            VulnLibraryDetailPage (§5.5)
 * - /projects/:id/scans/:runId/vulns             ScanVulnsPage (§5.5 实例列表)
 * - /projects/:id/scans/:runId/vulns/:vulnId     ScanVulnDetailPage (§5.5 实例详情)
 * - /projects/:id/vuln-library/compare           VulnComparePage (§5.5 跨版本对比)
 * - /admin/users                                 UsersPage (admin only)
 * - /admin/config                                ConfigPage (admin only)
 * - /admin/audit-log                             AuditLogPage (admin only, §9)
 * - /me                                         SettingsPage (§6.2 改自己密码)
 */
export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="*"
          element={
            <AppLayout>
              <Routes>
                <Route path="/" element={<LazyPage loader={() => import('@/pages/HomePage')} />} />
                <Route
                  path="/projects"
                  element={<LazyPage loader={() => import('@/pages/ProjectsPage')} />}
                />
                <Route
                  path="/projects/:id"
                  element={<LazyPage loader={() => import('@/pages/ProjectDetailPage')} />}
                />
                <Route
                  path="/projects/:id/scans/:runId"
                  element={<LazyPage loader={() => import('@/pages/ScanPage')} />}
                />
                <Route
                  path="/projects/:id/scans/:runId/report"
                  element={<LazyPage loader={() => import('@/pages/ReportPage')} />}
                />
                <Route
                  path="/projects/:id/scans/:runId/trace"
                  element={<LazyPage loader={() => import('@/pages/TracePage')} />}
                />
                <Route
                  path="/projects/:id/scans/diff"
                  element={<LazyPage loader={() => import('@/pages/DiffPage')} />}
                />
                <Route
                  path="/projects/:id/vuln-library"
                  element={<LazyPage loader={() => import('@/pages/VulnLibraryPage')} />}
                />
                <Route
                  path="/projects/:id/vuln-library/:libId"
                  element={<LazyPage loader={() => import('@/pages/VulnLibraryDetailPage')} />}
                />
                <Route
                  path="/projects/:id/scans/:runId/vulns"
                  element={<LazyPage loader={() => import('@/pages/ScanVulnsPage')} />}
                />
                <Route
                  path="/projects/:id/scans/:runId/vulns/:vulnId"
                  element={<LazyPage loader={() => import('@/pages/ScanVulnDetailPage')} />}
                />
                <Route
                  path="/projects/:id/vuln-library/compare"
                  element={<LazyPage loader={() => import('@/pages/VulnComparePage')} />}
                />
                <Route
                  path="/admin/users"
                  element={<LazyPage loader={() => import('@/pages/admin/UsersPage')} />}
                />
                <Route
                  path="/admin/config"
                  element={<LazyPage loader={() => import('@/pages/admin/ConfigPage')} />}
                />
                <Route
                  path="/admin/audit-log"
                  element={<LazyPage loader={() => import('@/pages/admin/AuditLogPage')} />}
                />
                <Route
                  path="/me"
                  element={<LazyPage loader={() => import('@/pages/SettingsPage')} />}
                />
                <Route
                  path="*"
                  element={
                    <main className="container py-6 flex flex-col items-center justify-center min-h-[60vh]">
                      <h1 className="text-6xl font-bold text-muted-foreground/30">404</h1>
                      <p className="mt-4 text-lg text-muted-foreground">页面未找到</p>
                    </main>
                  }
                />
              </Routes>
            </AppLayout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
