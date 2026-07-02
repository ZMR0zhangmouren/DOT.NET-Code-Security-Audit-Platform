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

export function StatusBadge({
  label,
  variant = 'default',
  className,
}: StatusBadgeProps): React.ReactElement {
  return (
    <Badge variant="outline" className={cn('font-medium', VARIANT_MAP[variant], className)}>
      {label}
    </Badge>
  );
}
