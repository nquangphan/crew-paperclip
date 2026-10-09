// crew: tự dựng
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '../cn';

function Spinner({ className, label }: { className?: string; label?: string }) {
  const { t } = useT();
  const name = label ?? t('ui.loading');
  return (
    <span data-slot="spinner" role="status" aria-label={name} className="inline-flex">
      <Loader2 aria-hidden className={cn('size-4 animate-spin text-muted-foreground', className)} />
    </span>
  );
}

export { Spinner };
