// clone: ui/src/components/MetricCard.tsx @ v2026.1005.0
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../cn';
import { NavAnchor } from './nav-anchor';

interface MetricCardProps {
  icon: LucideIcon;
  value: string | number;
  label: string;
  description?: React.ReactNode;
  href?: string;
  onOpen?: () => void;
}

/** Thẻ số liệu của Tổng quan: số lớn, nhãn, mô tả (ẩn trên màn nhỏ), icon mờ góc phải. */
function MetricCard({ icon: Icon, value, label, description, href, onOpen }: MetricCardProps) {
  const clickable = Boolean(href && onOpen);
  const inner = (
    <div
      data-slot="metric-card"
      data-testid="stat-card"
      className={cn(
        'h-full rounded-lg px-4 py-4 transition-colors sm:px-5 sm:py-5',
        clickable && 'cursor-pointer hover:bg-accent/50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p data-testid="stat-value" className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
            {value}
          </p>
          <p className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
          {description ? (
            <div className="mt-1.5 hidden text-xs text-muted-foreground/70 sm:block">{description}</div>
          ) : null}
        </div>
        <Icon aria-hidden className="mt-1.5 size-4 shrink-0 text-muted-foreground/50" />
      </div>
    </div>
  );
  if (href && onOpen) {
    return (
      <NavAnchor href={href} onOpen={onOpen} className="h-full text-inherit no-underline">
        {inner}
      </NavAnchor>
    );
  }
  return inner;
}

export type { MetricCardProps };
export { MetricCard };
