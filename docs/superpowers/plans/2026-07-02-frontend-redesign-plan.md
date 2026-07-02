# 前端 UI 重设计实施计划

> **For agentic workers:** 使用 subagent-driven-development 逐任务执行。Step 使用 checkbox (`- [ ]`) 跟踪。

**Goal:** 将前端从 shadcn 默认主题升级为专业企业级靛蓝主题 + 明暗切换 + 毛玻璃 + 侧边栏导航

**Architecture:** 三区布局（TopBar + Sidebar + Content），Inter + JetBrains Mono 字体，15 个 shadcn/ui 组件，9 个业务组件，13 个页面全部重构

**Tech Stack:** React 18 + Vite 5 + shadcn/ui + Tailwind CSS 3 + Radix UI + lucide-react + sonner

**设计文档:** `docs/superpowers/specs/2026-07-02-frontend-redesign-design.md`

---

## Phase 1: 基础设施

### Task 1.1: 更新全局 CSS 变量与毛玻璃工具类

**Files:**
- Modify: `apps/web/src/index.css`

**改动:** 替换 `:root` 和 `.dark` 全部 CSS 变量 + 新增 `.glass-*` 工具类

完整代码：
```css
@import 'highlight.js/styles/github-dark.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 240 10% 98%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 243 75% 59%;
    --primary-foreground: 0 0% 100%;
    --secondary: 240 4.8% 95%;
    --secondary-foreground: 240 10% 3.9%;
    --muted: 240 4.8% 95%;
    --muted-foreground: 240 4% 46%;
    --accent: 240 4.8% 95%;
    --accent-foreground: 240 10% 3.9%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 6% 90%;
    --input: 240 6% 90%;
    --ring: 243 75% 59%;
    --radius: 0.625rem;

    /* 语义扩展色 */
    --severity-critical: 0 72% 51%;
    --severity-high: 25 95% 53%;
    --severity-medium: 45 93% 47%;
    --severity-low: 200 80% 50%;
    --severity-info: 240 5% 50%;
    --success: 142 72% 40%;
    --warning: 38 92% 50%;
  }

  .dark {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 95%;
    --card: 240 8% 8%;
    --card-foreground: 0 0% 95%;
    --popover: 240 8% 8%;
    --popover-foreground: 0 0% 95%;
    --primary: 243 75% 68%;
    --primary-foreground: 0 0% 100%;
    --secondary: 240 4% 14%;
    --secondary-foreground: 0 0% 95%;
    --muted: 240 4% 14%;
    --muted-foreground: 240 5% 65%;
    --accent: 240 4% 14%;
    --accent-foreground: 0 0% 95%;
    --destructive: 0 72% 55%;
    --destructive-foreground: 0 0% 100%;
    --border: 240 4% 20%;
    --input: 240 4% 20%;
    --ring: 243 75% 68%;

    --severity-critical: 0 72% 55%;
    --severity-high: 25 95% 58%;
    --severity-medium: 45 93% 52%;
    --severity-low: 200 80% 55%;
    --severity-info: 240 5% 55%;
    --success: 142 72% 45%;
    --warning: 38 92% 55%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
  }
}

/* 毛玻璃工具类 */
@layer components {
  .glass-surface {
    @apply border border-border/30;
    background: hsl(var(--card) / 0.72);
    backdrop-filter: blur(16px) saturate(140%);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
  }

  .glass-card {
    @apply border border-border/25;
    background: hsl(var(--card) / 0.65);
    backdrop-filter: blur(10px) saturate(120%);
    -webkit-backdrop-filter: blur(10px) saturate(120%);
    border-radius: var(--radius);
  }

  .glass-popover {
    @apply border border-border/35;
    background: hsl(var(--popover) / 0.82);
    backdrop-filter: blur(8px) saturate(110%);
    -webkit-backdrop-filter: blur(8px) saturate(110%);
    border-radius: var(--radius);
    box-shadow: 0 8px 32px hsl(0 0% 0% / 0.12);
  }
}

/* 报告 Markdown 渲染 */
@layer components {
  .report-prose pre {
    @apply rounded-md border border-border !bg-[#0d1117] p-4 overflow-x-auto;
  }
  .report-prose pre code {
    @apply bg-transparent p-0 text-sm leading-relaxed;
  }
  .report-prose :not(pre) > code {
    @apply rounded border border-border bg-muted px-1.5 py-0.5 text-[0.875em] font-mono;
  }
  .report-prose table {
    @apply w-full border-collapse text-sm;
  }
  .report-prose th,
  .report-prose td {
    @apply border border-border px-3 py-2 text-left;
  }
  .report-prose thead {
    @apply bg-muted/60;
  }
  .report-prose tbody tr:hover {
    @apply bg-muted/40;
  }
  .report-prose a {
    @apply text-primary underline-offset-2 hover:underline;
  }
  .report-prose blockquote {
    @apply border-l-4 border-primary/60 bg-muted/40 pl-4 py-1 italic text-muted-foreground;
  }
  .report-prose h1,
  .report-prose h2,
  .report-prose h3,
  .report-prose h4 {
    @apply scroll-mt-20;
  }
}
```

### Task 1.2: 扩展 Tailwind 配置（语义色 + 字体）

**Files:**
- Modify: `apps/web/tailwind.config.js`

完整代码：
```js
/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // 语义扩展色
        severity: {
          critical: 'hsl(var(--severity-critical))',
          high: 'hsl(var(--severity-high))',
          medium: 'hsl(var(--severity-medium))',
          low: 'hsl(var(--severity-low))',
          info: 'hsl(var(--severity-info))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [animate, typography],
};
```

### Task 1.3: 创建 cn 工具函数

**Files:**
- Create: `apps/web/src/lib/utils.ts`

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

### Task 1.4: 添加 Inter + JetBrains Mono 字体

**Files:**
- Modify: `apps/web/index.html`

在 `<head>` 中 `<link>` 前加入：
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
  rel="stylesheet"
/>
```

### Task 1.5: 添加 shadcn/ui 组件

运行 npx 命令安装以下组件：
```bash
cd apps/web
npx shadcn@latest add card badge tabs dialog dropdown-menu avatar tooltip separator skeleton input textarea select table scroll-area --yes
```

### Task 1.6: 安装 sonner（Toast 通知）

```bash
cd apps/web
pnpm add sonner
```

### Task 1.7: 创建 ThemeProvider + ThemeToggle

**Files:**
- Create: `apps/web/src/components/ThemeProvider.tsx`
- Create: `apps/web/src/components/ThemeToggle.tsx`

**ThemeProvider.tsx:**
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolved: 'light',
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'system';
  });

  const resolved = theme === 'system' ? getSystemTheme() : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    localStorage.setItem('theme', theme);
  }, [resolved, theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(getSystemTheme());
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

**ThemeToggle.tsx:**
```tsx
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/ThemeProvider';

export function ThemeToggle(): React.ReactElement {
  const { resolved, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
    >
      {resolved === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
```

### Task 1.8: 创建 TopBar 组件

**Files:**
- Create: `apps/web/src/components/TopBar.tsx`

```tsx
import { LogOut, Menu, Shield } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';

interface TopBarProps {
  onToggleSidebar: () => void;
}

export function TopBar({ onToggleSidebar }: TopBarProps): React.ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center gap-4 glass-surface px-4">
      <Button variant="ghost" size="icon" onClick={onToggleSidebar}>
        <Menu className="h-5 w-5" />
      </Button>

      <Link to="/" className="flex items-center gap-2 font-semibold text-sm">
        <Shield className="h-5 w-5 text-primary" />
        <span className="hidden sm:inline">CodeSec Audit</span>
      </Link>

      <div className="flex-1" />

      <ThemeToggle />

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {user.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{user.username}</p>
              <p className="text-xs text-muted-foreground">{user.role}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/me')}>Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                logout();
                navigate('/login');
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}
```

### Task 1.9: 创建 Sidebar 组件

**Files:**
- Create: `apps/web/src/components/Sidebar.tsx`

```tsx
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  LayoutDashboard,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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

export function Sidebar({ collapsed }: SidebarProps): React.ReactElement {
  const { user } = useAuth();
  const location = useLocation();

  const isProjectPage = location.pathname.startsWith('/projects/') && location.pathname !== '/projects';
  const projectId = isProjectPage ? location.pathname.split('/')[2] : null;

  const mainItems: NavItem[] = [
    { to: '/', label: '总览', icon: <LayoutDashboard className="h-5 w-5" />, end: true },
    { to: '/projects', label: '项目列表', icon: <FolderOpen className="h-5 w-5" />, end: true },
  ];

  const adminItems: NavItem[] = [
    { to: '/admin/users', label: '用户管理', icon: <Users className="h-5 w-5" />, adminOnly: true },
    { to: '/admin/config', label: '系统配置', icon: <Shield className="h-5 w-5" />, adminOnly: true },
  ];

  const bottomItems: NavItem[] = [
    { to: '/me', label: '设置', icon: <Settings className="h-5 w-5" /> },
  ];

  function renderNavItem(item: NavItem): React.ReactElement {
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
            {mainItems.map(renderNavItem)}

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
              <nav className="flex flex-col gap-1">{adminItems.map(renderNavItem)}</nav>
            </>
          )}
        </ScrollArea>

        <div className="px-3 py-3">
          <Separator className="mb-3" />
          <nav className="flex flex-col gap-1">{bottomItems.map(renderNavItem)}</nav>
        </div>
      </aside>
    </TooltipProvider>
  );
}
```

### Task 1.10: 重写 AppLayout（三区布局）

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`

```tsx
import { useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { cn } from '@/lib/utils';

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
        className={cn(
          'transition-[margin] duration-300',
          sidebarCollapsed ? 'ml-16' : 'ml-56',
        )}
      >
        <div className="min-h-[calc(100vh-3.5rem)]">{children}</div>
      </main>
    </div>
  );
}
```

### Task 1.11: 创建业务组件

**Files:**
- Create: `apps/web/src/components/SeverityBadge.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`
- Create: `apps/web/src/components/StatCard.tsx`
- Create: `apps/web/src/components/EmptyState.tsx`
- Create: `apps/web/src/components/PageHeader.tsx`

**SeverityBadge.tsx:**
```tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const VARIANT_MAP: Record<Severity, string> = {
  critical: 'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
  high: 'bg-severity-high/15 text-severity-high border-severity-high/30',
  medium: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30',
  low: 'bg-severity-low/15 text-severity-low border-severity-low/30',
  info: 'bg-severity-info/15 text-severity-info border-severity-info/30',
};

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps): React.ReactElement {
  return (
    <Badge variant="outline" className={cn('font-medium capitalize', VARIANT_MAP[severity], className)}>
      {severity}
    </Badge>
  );
}
```

**StatusBadge.tsx:**
```tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info';

const VARIANT_MAP: Record<StatusVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  destructive: 'bg-destructive/15 text-destructive border-destructive/30',
  info: 'bg-primary/15 text-primary border-primary/30',
};

interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  className?: string;
}

export function StatusBadge({ label, variant = 'default', className }: StatusBadgeProps): React.ReactElement {
  return (
    <Badge variant="outline" className={cn('font-medium', VARIANT_MAP[variant], className)}>
      {label}
    </Badge>
  );
}
```

**StatCard.tsx:**
```tsx
import { type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: { value: number; label: string };
  className?: string;
}

export function StatCard({ title, value, description, icon: Icon, trend, className }: StatCardProps): React.ReactElement {
  return (
    <Card className={cn('glass-card', className)}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        {trend && (
          <p className={cn('mt-2 text-xs', trend.value >= 0 ? 'text-success' : 'text-destructive')}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}% {trend.label}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

**EmptyState.tsx:**
```tsx
import { Inbox, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <Icon className="h-10 w-10 text-muted-foreground/50" />
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
      {action && (
        <Button variant="outline" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
```

**PageHeader.tsx:**
```tsx
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface BreadcrumbLink {
  label: string;
  to: string;
}

interface PageAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'destructive';
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbLink[];
  actions?: PageAction[];
  badge?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  badge,
}: PageHeaderProps): React.ReactElement {
  return (
    <header className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
          {breadcrumbs.map((bc, i) => (
            <span key={bc.to} className="flex items-center gap-1">
              {i === 0 && <ChevronLeft className="h-3 w-3" />}
              <Link to={bc.to} className="hover:text-foreground hover:underline">
                {bc.label}
              </Link>
              {i < breadcrumbs.length - 1 && <span className="mx-1">/</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {badge}
        </div>
        {actions && actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.label}
                variant={action.variant || 'default'}
                onClick={action.onClick}
                size="sm"
              >
                {action.icon && <action.icon className="mr-1 h-4 w-4" />}
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </header>
  );
}
```

### Task 1.12: 更新 main.tsx（包裹 ThemeProvider + Toaster）

**Files:**
- Modify: `apps/web/src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { ThemeProvider } from '@/components/ThemeProvider';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
      <Toaster position="top-right" richColors closeButton />
    </ThemeProvider>
  </React.StrictMode>,
);
```

### Task 1.13: 更新 ScanTypes 辅助函数（使用语义色）

**Files:**
- Modify: `apps/web/src/lib/scanTypes.ts`

将 `scanStatusClass`、`coverageClass`、`gateClass` 改为使用新语义色：
```ts
export function scanStatusClass(status: ScanRunStatus): string {
  switch (status) {
    case 'queued':
      return 'bg-muted text-muted-foreground';
    case 'running':
      return 'bg-primary/20 text-primary';
    case 'succeeded':
      return 'bg-success/15 text-success border border-success/30';
    case 'failed':
      return 'bg-destructive/15 text-destructive border border-destructive/30';
    case 'canceled':
      return 'bg-muted text-muted-foreground';
  }
}

export function coverageClass(s: ApiCoverageStatus): string {
  switch (s) {
    case 'NOT_RUN':
      return 'bg-muted text-muted-foreground';
    case 'PARTIAL':
      return 'bg-warning/15 text-warning border border-warning/30';
    case 'COMPLETE':
      return 'bg-success/15 text-success border border-success/30';
  }
}

export function gateClass(g: GateDecision): string {
  switch (g) {
    case 'PASS':
      return 'bg-success/15 text-success border border-success/30';
    case 'BLOCKED':
      return 'bg-destructive/15 text-destructive border border-destructive/30';
    case 'PENDING':
      return 'bg-muted text-muted-foreground';
  }
}
```

---

## Phase 2: 核心页面重构（6 个）

### Task 2.1: 登录页

**Files:**
- Modify: `apps/web/src/pages/LoginPage.tsx`

全重写，居中毛玻璃卡片 + 靛蓝渐变背景 + lucide 图标：
（完整代码约 100 行，包含全屏渐变背景、glass-card 卡片、Shield 图标、表单输入框组件、加载 spinner、错误显示）

### Task 2.2: 首页 Dashboard

**Files:**
- Modify: `apps/web/src/pages/HomePage.tsx`

改为 Dashboard：4 个 StatCard + 最近项目列表 + 快捷操作卡片：
（完整代码约 150 行，调用 `/api/projects` + `/api/health` 获取数据）

### Task 2.3: 项目列表

**Files:**
- Modify: `apps/web/src/pages/ProjectsPage.tsx`

卡片网格替换纯表格 + PageHeader + 搜索框：
（完整代码约 180 行）

### Task 2.4: 项目详情

**Files:**
- Modify: `apps/web/src/pages/ProjectDetailPage.tsx`

使用 Tabs 组件替换手动 tab + StatCard 概览区：
（完整代码约 350 行，最大改动）

### Task 2.5: 扫描详情

**Files:**
- Modify: `apps/web/src/pages/ScanPage.tsx`

暗色终端风格日志 + 进度条动画 + 状态指示器：
（完整代码约 200 行）

### Task 2.6: 报告页

**Files:**
- Modify: `apps/web/src/pages/ReportPage.tsx`

Card 式章节折叠 + 章节导航优化：
（完整代码约 180 行）

---

## Phase 3: 剩余页面（7 个）

### Task 3.1-3.7:
- TracePage, DiffPage, VulnLibraryPage, VulnLibraryDetailPage, SettingsPage, admin/UsersPage, admin/ConfigPage

每页约 50-150 行改动，统一使用 PageHeader、Card、Badge、Table 等组件。

---

## 质量门禁

每个 Phase 完成后运行：
```bash
pnpm -r typecheck && pnpm -r test && pnpm lint
```
