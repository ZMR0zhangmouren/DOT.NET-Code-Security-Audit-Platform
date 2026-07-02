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
  variant?: 'default' | 'outline' | 'destructive' | 'ghost';
  disabled?: boolean;
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
                disabled={action.disabled}
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
