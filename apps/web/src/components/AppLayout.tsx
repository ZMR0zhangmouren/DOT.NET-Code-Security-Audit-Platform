import { useState, type ReactNode } from 'react';

import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { cn } from '@/lib/utils';

/**
 * 全局 Layout —— 三区结构：TopBar + Sidebar + Content
 *
 * - TopBar: sticky 毛玻璃顶部栏，Logo + 折叠按钮 + 主题切换 + 用户头像下拉
 * - Sidebar: fixed 毛玻璃侧边栏，可折叠 (w-16 / w-56)，支持图标+Tooltip 模式
 * - Content: 自适应内容区，ml-16 / ml-56 过渡动画
 */
export default function AppLayout({ children }: { children: ReactNode }): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  function toggleSidebar(): void {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar onToggleSidebar={toggleSidebar} />
      <Sidebar collapsed={sidebarCollapsed} />
      <main
        className={cn('transition-[margin] duration-300', sidebarCollapsed ? 'ml-16' : 'ml-56')}
      >
        <div className="min-h-[calc(100vh-3.5rem)]">{children}</div>
      </main>
    </div>
  );
}
