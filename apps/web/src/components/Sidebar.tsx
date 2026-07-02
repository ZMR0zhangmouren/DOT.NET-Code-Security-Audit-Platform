import { FolderOpen, LayoutDashboard, Settings, Shield, Users } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

interface SidebarProps {
  collapsed: boolean;
}

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactElement;
  adminOnly?: boolean;
  end?: boolean;
}

function NavItemLink({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}): React.ReactElement {
  const { user } = useAuth();

  if (item.adminOnly && user?.role !== 'admin') return <></>;

  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-foreground/70 hover:bg-muted hover:text-foreground',
          collapsed && 'justify-center px-2',
        )
      }
    >
      {item.icon}
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip key={item.to}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return <div key={item.to}>{link}</div>;
}

export function Sidebar({ collapsed }: SidebarProps): React.ReactElement {
  const { user } = useAuth();
  const location = useLocation();

  const isProjectPage =
    location.pathname.startsWith('/projects/') && location.pathname !== '/projects';
  const projectId = isProjectPage ? location.pathname.split('/')[2] : null;

  const mainItems: NavItem[] = [
    { to: '/', label: '总览', icon: <LayoutDashboard className="h-5 w-5" />, end: true },
    { to: '/projects', label: '项目列表', icon: <FolderOpen className="h-5 w-5" />, end: true },
  ];

  const adminItems: NavItem[] = [
    {
      to: '/admin/users',
      label: '用户管理',
      icon: <Users className="h-5 w-5" />,
      adminOnly: true,
    },
    {
      to: '/admin/config',
      label: '系统配置',
      icon: <Shield className="h-5 w-5" />,
      adminOnly: true,
    },
  ];

  const bottomItems: NavItem[] = [
    { to: '/me', label: '设置', icon: <Settings className="h-5 w-5" /> },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          'fixed left-0 top-14 bottom-0 z-40 flex flex-col glass-surface transition-[width] duration-300',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="flex flex-col gap-1">
            {mainItems.map((item) => (
              <NavItemLink key={item.to} item={item} collapsed={collapsed} />
            ))}

            {isProjectPage && projectId && (
              <NavLink
                to={`/projects/${projectId}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground/70 hover:bg-muted hover:text-foreground',
                    collapsed && 'justify-center px-2',
                  )
                }
              >
                <FolderOpen className="h-5 w-5" />
                {!collapsed && <span className="truncate">当前项目</span>}
              </NavLink>
            )}
          </nav>

          {user?.role === 'admin' && (
            <>
              <Separator className="my-3" />
              <nav className="flex flex-col gap-1">
                {adminItems.map((item) => (
                  <NavItemLink key={item.to} item={item} collapsed={collapsed} />
                ))}
              </nav>
            </>
          )}
        </ScrollArea>

        <div className="px-3 py-3">
          <Separator className="mb-3" />
          <nav className="flex flex-col gap-1">
            {bottomItems.map((item) => (
              <NavItemLink key={item.to} item={item} collapsed={collapsed} />
            ))}
          </nav>
        </div>
      </aside>
    </TooltipProvider>
  );
}
