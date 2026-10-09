// crew: tự dựng
import { CircleAlert } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '../cn';
import { Button } from './button';

interface ErrorStateProps {
  title: string;
  /** Hiện nguyên văn trong <pre>, không render HTML. */
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

function ErrorState({ title, message, onRetry, retryLabel, className }: ErrorStateProps) {
  const { t } = useT();
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn('flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4', className)}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <CircleAlert aria-hidden className="size-4 shrink-0" />
        <span>{title}</span>
      </div>
      {message ? (
        <pre className="font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">{message}</pre>
      ) : null}
      {onRetry ? (
        <div>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel ?? t('action.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export type { ErrorStateProps };
export { ErrorState };
