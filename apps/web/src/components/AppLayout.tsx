import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

/**
 * 全局 Layout —— 顶部导航 + 侧栏 + 主区
 *
 * Phase 1:极简版。Phase 2 加面包屑、用户菜单、主题切换。
 */
export default function AppLayout({ children }: { children: ReactNode }): React.ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="container flex h-14 items-center justify-between">
          <Link to="/" className="font-bold">
            Audit Platform
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            {user ? (
              <>
                <NavLink to="/projects" className="px-3 py-1 hover:underline">
                  Projects
                </NavLink>
                {user.role === 'admin' && (
                  <>
                    <NavLink to="/admin/users" className="px-3 py-1 hover:underline">
                      Users
                    </NavLink>
                    <NavLink to="/admin/config" className="px-3 py-1 hover:underline">
                      Config
                    </NavLink>
                  </>
                )}
                <span className="px-2 text-xs text-muted-foreground">
                  {user.username} · {user.role}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                  data-testid="logout-button"
                >
                  Logout
                </Button>
              </>
            ) : (
              <NavLink to="/login" className="px-3 py-1 hover:underline">
                Login
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
