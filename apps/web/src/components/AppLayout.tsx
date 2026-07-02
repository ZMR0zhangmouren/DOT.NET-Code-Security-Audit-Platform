import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { cn } from '@/lib/utils';

/**
 * 全局 Layout —— 三区结构：TopBar + Sidebar + Content
 *
 * 响应式断点：
 * - ≥1024px (desktop): 完整侧边栏，用户可折叠 (w-16 / w-56)
 * - 768-1023px (tablet): 侧边栏始终折叠为图标模式 (w-16)
 * - <768px (mobile): 侧边栏隐藏，点击汉堡打开 overlay 抽屉
 */
export default function AppLayout({ children }: { children: ReactNode }): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);

  const handleResize = useCallback(() => {
    const w = window.innerWidth;
    setIsMobile(w < 768);
    setIsTablet(w >= 768 && w < 1024);
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  function toggleSidebar(): void {
    if (isMobile) {
      setMobileOpen((prev) => !prev);
      return;
    }
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }

  function closeMobile(): void {
    setMobileOpen(false);
  }

  // Determine effective collapsed state
  const effectiveCollapsed = isMobile ? false : isTablet ? true : sidebarCollapsed;

  // Content margin: mobile = 0 (overlay), tablet = ml-16, desktop = depends
  const contentMargin = isMobile
    ? 'ml-0'
    : isTablet
      ? 'ml-16'
      : sidebarCollapsed
        ? 'ml-16'
        : 'ml-56';

  return (
    <div className="min-h-screen bg-background">
      <TopBar onToggleSidebar={toggleSidebar} isMobile={isMobile} />

      {/* Mobile overlay sidebar */}
      {isMobile && mobileOpen && <Sidebar collapsed={false} overlay onCloseOverlay={closeMobile} />}

      {/* Desktop/tablet sidebar */}
      <Sidebar collapsed={effectiveCollapsed} />

      <main className={cn('transition-[margin] duration-300', contentMargin)}>
        <div className="min-h-[calc(100vh-3.5rem)]">{children}</div>
      </main>
    </div>
  );
}
