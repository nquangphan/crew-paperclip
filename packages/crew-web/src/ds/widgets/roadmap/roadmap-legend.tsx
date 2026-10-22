// crew: tự dựng
// Chú giải của bản đồ Roadmap: bảy trạng thái (cùng biểu tượng với danh sách yêu cầu, màu theo bảng màu của bản đồ), các
// loại cạnh và dây "đang chạy" (mẫu nét vẽ bằng đúng class của dây trên bản đồ). Nằm dưới khung bản đồ (không che nút);
// thu gọn được bằng nút "Chú thích", mặc định thu gọn trên màn hẹp.
import { ChevronDown, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useT } from '@/i18n';
import { cn } from '../../cn';
import { StatusGlyph } from '../status-glyph';
import { roadmapToneVar } from './roadmap-node';
import type { RoadmapEdgeKind } from './roadmap-types';

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

/** Mục chú giải của huy hiệu Jev (màu trùng huy hiệu trên thẻ). */
const JEV_LEGEND = [
  { tone: 'blocked', color: 'var(--roadmap-tone-blocked)' },
  { tone: 'attention', color: 'var(--roadmap-tone-todo)' },
  { tone: 'quiet', color: 'var(--muted-foreground)' },
  { tone: 'mismatch', color: 'var(--roadmap-tone-todo)' },
] as const;

const SWATCH_PATH = 'M 1,6 C 9,1 15,11 23,6';

/** Mẫu nét của một loại cạnh: cùng class `.roadmap-edge` với dây trên bản đồ nên luôn khớp màu và kiểu nét. */
function EdgeSwatch({ kind, running = false }: { kind: RoadmapEdgeKind; running?: boolean }) {
  return (
    <svg aria-hidden width="24" height="12" viewBox="0 0 24 12" className="shrink-0 overflow-visible">
      <path d={SWATCH_PATH} data-edge-kind={kind} data-running={running || undefined} className="roadmap-edge" />
      {running ? <path d={SWATCH_PATH} className="roadmap-edge-flow" /> : null}
    </svg>
  );
}

export interface RoadmapLegendProps {
  className?: string;
  /** Loại cạnh cần chú giải (mặc định cha-con và chặn). */
  edges?: readonly RoadmapEdgeKind[];
  /** Thêm mục "Việc đang xem" (bản đồ Crew ở trang chi tiết). */
  current?: boolean;
  /** Thêm mục Jev (huy hiệu khiên): chỉ khi bản đồ có thẻ mang huy hiệu. */
  jev?: boolean;
  /** Thêm mục cờ "Jev: nên là large": chỉ khi bản đồ có thẻ mang cờ complexity. */
  jevComplexity?: boolean;
}

const DEFAULT_EDGES: readonly RoadmapEdgeKind[] = ['parent', 'blocks'];

export function RoadmapLegend({
  className,
  edges = DEFAULT_EDGES,
  current = false,
  jev = false,
  jevComplexity = false,
}: RoadmapLegendProps) {
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
        className="inline-flex cursor-pointer items-center gap-1 rounded-full border bg-card px-2.5 py-1 font-medium text-card-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        {t('roadmap.legend.label')}
        <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
      </button>
      <ul id={listId} hidden={!open} className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {ROADMAP_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <StatusGlyph status={status} size="sm" color={roadmapToneVar(status)} />
            <span>{t(`status.${status}`)}</span>
          </li>
        ))}
        {edges.map((kind) => (
          <li key={kind} className="flex items-center gap-1.5">
            <EdgeSwatch kind={kind} />
            <span>{t(`roadmap.legend.${kind}`)}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <EdgeSwatch kind="parent" running />
          <span>{t('roadmap.legend.running')}</span>
        </li>
        {current ? (
          <li className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-3 rounded-sm bg-card ring-2 ring-primary ring-offset-1 ring-offset-background"
            />
            <span>{t('roadmap.legend.current')}</span>
          </li>
        ) : null}
        {jev
          ? JEV_LEGEND.map(({ tone, color }) => (
              <li key={tone} className="flex items-center gap-1.5" data-slot="roadmap-legend-jev">
                <ShieldCheck aria-hidden className="size-3.5" style={{ color }} />
                <span>{t(`roadmap.legend.jev.${tone}`)}</span>
              </li>
            ))
          : null}
        {jevComplexity ? (
          <li className="flex items-center gap-1.5" data-slot="roadmap-legend-complexity">
            <TriangleAlert aria-hidden className="size-3.5" style={{ color: 'var(--roadmap-tone-todo)' }} />
            <span>{t('roadmap.legend.jev.complexity')}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
