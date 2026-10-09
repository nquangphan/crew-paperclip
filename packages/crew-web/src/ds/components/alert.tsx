// crew: tự dựng
import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../cn';

type AlertVariant = 'info' | 'warning' | 'destructive';

const VARIANT_CLASS: Record<AlertVariant, string> = {
  info: 'border-blue-600/40 bg-blue-600/5 text-blue-700 dark:text-blue-400',
  warning: 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  destructive: 'border-destructive/40 bg-destructive/5 text-destructive',
};

const ICON: Record<AlertVariant, typeof Info> = { info: Info, warning: AlertTriangle, destructive: CircleAlert };

interface AlertProps {
  variant?: AlertVariant;
  title?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/** Khung thông báo trong trang: info (status), warning/destructive (alert). Chữ do người gọi truyền (đã qua t()). */
function Alert({ variant = 'info', title, className, children }: AlertProps) {
  const Icon = ICON[variant];
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={variant === 'info' ? 'status' : 'alert'}
      className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', VARIANT_CLASS[variant], className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className="text-muted-foreground break-words">{children}</div> : null}
      </div>
    </div>
  );
}

export type { AlertProps, AlertVariant };
export { Alert };
