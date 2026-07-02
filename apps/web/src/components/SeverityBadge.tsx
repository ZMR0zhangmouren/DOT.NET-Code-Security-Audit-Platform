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
    <Badge
      variant="outline"
      className={cn('font-medium capitalize', VARIANT_MAP[severity], className)}
    >
      {severity}
    </Badge>
  );
}
