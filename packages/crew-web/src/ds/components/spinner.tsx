// crew: tự dựng
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '../cn';

/**
 * Vòng xoay đang tải. `decorative`: chỉ là hình (aria-hidden), dùng trong nút đã có chữ "Đang …" để tên nút không
 * bị lặp.
 */
function Spinner({
  className,
  label,
  decorative = false,
}: {
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  const { t } = useT();
  const name = label ?? t('ui.loading');
  const icon = <Loader2 aria-hidden className={cn('size-4 animate-spin text-muted-foreground', className)} />;
  if (decorative) {
    return (
      <span data-slot="spinner" aria-hidden className="inline-flex">
        {icon}
      </span>
    );
  }
  return (
    <span data-slot="spinner" role="status" aria-label={name} className="inline-flex">
      {icon}
    </span>
  );
}

export { Spinner };
