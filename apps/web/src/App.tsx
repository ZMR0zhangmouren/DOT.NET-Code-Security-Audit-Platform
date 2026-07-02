import { Component, lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/* ================================================================
 * React.lazy 必须在模块顶层调用,不能写在渲染函数里!
 * 否则每次渲染创建新组件引用,路由切换失效。
 * ================================================================ */

// eager import —— LoginPage 首屏必需,且不在 AppLayout 内
import LoginPage from '@/pages/LoginPage';

// 所有懒加载页面（模块顶层 lazy）
const HomePage = lazy(() => import('@/pages/HomePage'));
const ProjectsPage = lazy(() => import('@/pages/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('@/pages/ProjectDetailPage'));
const ScanPage = lazy(() => import('@/pages/ScanPage'));
const ReportPage = lazy(() => import('@/pages/ReportPage'));
const TracePage = lazy(() => import('@/pages/TracePage'));
const DiffPage = lazy(() => import('@/pages/DiffPage'));
const VulnLibraryPage = lazy(() => import('@/pages/VulnLibraryPage'));
const VulnLibraryDetailPage = lazy(() => import('@/pages/VulnLibraryDetailPage'));
const ScanVulnsPage = lazy(() => import('@/pages/ScanVulnsPage'));
const ScanVulnDetailPage = lazy(() => import('@/pages/ScanVulnDetailPage'));
const VulnComparePage = lazy(() => import('@/pages/VulnComparePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));
const ConfigPage = lazy(() => import('@/pages/admin/ConfigPage'));
const AuditLogPage = lazy(() => import('@/pages/admin/AuditLogPage'));

/* ================================================================
 * ErrorBoundary —— 捕获懒加载/渲染异常,显示降级 UI
 * ================================================================ */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): { hasError: boolean; error: Error } {
    return { hasError: true, error };
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="container py-6">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
            <h2 className="text-lg font-semibold text-destructive">页面加载失败</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {this.state.error?.message ?? '未知错误'}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

/* ================================================================
 * AuthGuard —— 未登录重定向到 /login
 * ================================================================ */
function AuthGuard({ children }: { children: ReactNode }): React.ReactElement {
  // 检查是否有 access_token（内存或 localStorage）
  const hasToken = (() => {
    // 优先检查内存（useAuth 初始化时会从 localStorage 同步到内存）
    const memToken = (() => {
      try {
        // 直接读 localStorage 作为 fallback
        return localStorage.getItem('access_token');
      } catch {
        return null;
      }
    })();
    return !!memToken;
  })();

  if (!hasToken) {
    // 无 token —— 但不要立即跳转,因为 useAuth 正在尝试 refresh
    // 只在确认无缓存 token 时才跳
    // 检查是否有 user 信息缓存
    const hasUser = (() => {
      try {
        return !!localStorage.getItem('user');
      } catch {
        return false;
      }
    })();

    if (!hasToken && !hasUser) {
      return <Navigate to="/login" replace />;
    }
  }

  return <>{children}</>;
}

/* ================================================================
 * PageSkeleton —— 统一的懒加载骨架屏
 * ================================================================ */
function PageSkeleton(): React.ReactElement {
  return (
    <main className="container py-6">
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </main>
  );
}

/* ================================================================
 * 路由表 —— §9 完整 17 页
 * ================================================================ */
export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* 受保护路由 —— 带 AuthGuard */}
        <Route
          path="*"
          element={
            <AuthGuard>
              <AppLayout>
                <ErrorBoundary>
                  <Suspense fallback={<PageSkeleton />}>
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/projects" element={<ProjectsPage />} />
                      <Route path="/projects/:id" element={<ProjectDetailPage />} />
                      <Route path="/projects/:id/scans/:runId" element={<ScanPage />} />
                      <Route path="/projects/:id/scans/:runId/report" element={<ReportPage />} />
                      <Route path="/projects/:id/scans/:runId/trace" element={<TracePage />} />
                      <Route path="/projects/:id/scans/diff" element={<DiffPage />} />
                      <Route path="/projects/:id/vuln-library" element={<VulnLibraryPage />} />
                      <Route
                        path="/projects/:id/vuln-library/:libId"
                        element={<VulnLibraryDetailPage />}
                      />
                      <Route path="/projects/:id/scans/:runId/vulns" element={<ScanVulnsPage />} />
                      <Route
                        path="/projects/:id/scans/:runId/vulns/:vulnId"
                        element={<ScanVulnDetailPage />}
                      />
                      <Route
                        path="/projects/:id/vuln-library/compare"
                        element={<VulnComparePage />}
                      />
                      <Route path="/admin/users" element={<UsersPage />} />
                      <Route path="/admin/config" element={<ConfigPage />} />
                      <Route path="/admin/audit-log" element={<AuditLogPage />} />
                      <Route path="/me" element={<SettingsPage />} />
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
                  </Suspense>
                </ErrorBoundary>
              </AppLayout>
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
