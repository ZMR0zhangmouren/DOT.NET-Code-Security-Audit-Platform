import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
import ProjectDetailPage from '@/pages/ProjectDetailPage';
import ProjectsPage from '@/pages/ProjectsPage';
import ScanPage from '@/pages/ScanPage';
import VulnLibraryPage from '@/pages/VulnLibraryPage';

/**
 * 根组件 —— 路由出口
 *
 * §9 路由表(逐步落地):
 * - /                                            HomePage
 * - /login                                       LoginPage
 * - /projects                                    ProjectsPage
 * - /projects/:id                                ProjectDetailPage
 * - /projects/:id/scans/:runId                   ScanPage
 * - /projects/:id/vuln-library                   VulnLibraryPage
 *
 * Phase 2+ 继续添加:报告 / 漏洞详情 / Agent Trace / 系统配置 / 审计日志 等。
 */
export default function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/projects/:id/scans/:runId" element={<ScanPage />} />
        <Route path="/projects/:id/vuln-library" element={<VulnLibraryPage />} />
        <Route
          path="*"
          element={
            <main className="container py-8">
              <h1 className="text-2xl font-bold">404</h1>
              <p className="text-sm text-muted-foreground">路由不存在</p>
              <Button className="mt-4" variant="outline">
                回首页
              </Button>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
