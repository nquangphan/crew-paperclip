// crew: tự dựng
// Chú giải của bản đồ Roadmap: bảy trạng thái (cùng biểu tượng và màu với danh sách yêu cầu) và hai loại cạnh.
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

export function RoadmapLegend({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <section
      aria-label={t('roadmap.legend.label')}
      data-slot="roadmap-legend"
      className={cn('rounded-lg border bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-sm', className)}
    >
      <ul className="grid grid-cols-3 gap-x-3 gap-y-1">
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
