// crew: tự dựng
// Chú giải của bản đồ Roadmap: bảy trạng thái (cùng biểu tượng và màu với danh sách yêu cầu) và hai loại cạnh. Nằm dưới
// khung bản đồ (không che nút); thu gọn được bằng nút "Chú thích", mặc định thu gọn trên màn hẹp.
import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '../../cn';
import { StatusGlyph } from '../status-glyph';

export const ROADMAP_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
] as const;

/** Màn hẹp hơn mốc `sm` (640px) thì chú giải mặc định thu gọn. */
const NARROW = '(max-width: 639px)';
const startsOpen = () => typeof window === 'undefined' || !window.matchMedia?.(NARROW).matches;

export function RoadmapLegend({ className }: { className?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(startsOpen);
  const listId = useId();
  return (
    <section
      aria-label={t('roadmap.legend.label')}
      data-slot="roadmap-legend"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-card px-2 py-1 font-medium text-card-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        {t('roadmap.legend.label')}
        <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
      </button>
      <ul id={listId} hidden={!open} className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {ROADMAP_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <StatusGlyph status={status} size="sm" />
            <span>{t(`status.${status}`)}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="w-5 border-t-2 border-muted-foreground/50" />
          <span>{t('roadmap.legend.parent')}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="w-5 border-t-2 border-dashed border-primary" />
          <span>{t('roadmap.legend.blocks')}</span>
        </li>
      </ul>
    </section>
  );
}
