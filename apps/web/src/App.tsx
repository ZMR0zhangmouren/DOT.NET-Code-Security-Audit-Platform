import { BrowserRouter, Route, Routes } from 'react-router-dom';

import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import DiffPage from '@/pages/DiffPage';
import HomePage from '@/pages/HomePage';
import LoginPage from '@/pages/LoginPage';
import ProjectDetailPage from '@/pages/ProjectDetailPage';
import ProjectsPage from '@/pages/ProjectsPage';
import ReportPage from '@/pages/ReportPage';
import ScanPage from '@/pages/ScanPage';
import SettingsPage from '@/pages/SettingsPage';
import VulnLibraryDetailPage from '@/pages/VulnLibraryDetailPage';
import VulnLibraryPage from '@/pages/VulnLibraryPage';
import ConfigPage from '@/pages/admin/ConfigPage';
import UsersPage from '@/pages/admin/UsersPage';

/**
 * 根组件 —— 路由出口
 *
 * §9 路由表(逐步落地):
 * - /                                            HomePage
 * - /login                                       LoginPage
 * - /projects                                    ProjectsPage
 * - /projects/:id                                ProjectDetailPage
 * - /projects/:id/scans/:runId                   ScanPage
 * - /projects/:id/scans/:runId/report            ReportPage (§5.4)
 * - /projects/:id/scans/diff?a=&b=               DiffPage (§5.4 多 ScanRun 对比)
 * - /projects/:id/vuln-library                   VulnLibraryPage (§5.5)
 * - /projects/:id/vuln-library/:libId            VulnLibraryDetailPage (§5.5)
 * - /admin/users                                 UsersPage (admin only)
 * - /admin/config                                ConfigPage (admin only)
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
                <Route path="/" element={<HomePage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/projects/:id/scans/:runId" element={<ScanPage />} />
                <Route path="/projects/:id/scans/:runId/report" element={<ReportPage />} />
                <Route path="/projects/:id/scans/diff" element={<DiffPage />} />
                <Route path="/projects/:id/vuln-library" element={<VulnLibraryPage />} />
                <Route
                  path="/projects/:id/vuln-library/:libId"
                  element={<VulnLibraryDetailPage />}
                />
                <Route path="/admin/users" element={<UsersPage />} />
                <Route path="/admin/config" element={<ConfigPage />} />
                <Route path="/me" element={<SettingsPage />} />
                <Route
                  path="*"
                  element={
                    <main className="container py-8">
                      <h1 className="text-2xl font-bold">404</h1>
                      <p className="text-sm text-muted-foreground">Route not found</p>
                      <Button className="mt-4" variant="outline">
                        Go home
                      </Button>
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
