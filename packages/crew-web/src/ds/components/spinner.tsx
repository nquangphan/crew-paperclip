// crew: tự dựng
import { Loader2 } from 'lucide-react';
import { cn } from '../cn';

function Spinner({ className, label = 'Đang tải' }: { className?: string; label?: string }) {
  return (
    <span data-slot="spinner" role="status" aria-label={label} className="inline-flex">
      <Loader2 aria-hidden className={cn('size-4 animate-spin text-muted-foreground', className)} />
    </span>
  );
}

export { Spinner };
