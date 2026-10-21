// clone: ui/src/components/{KanbanBoard,IssuesList}.tsx @ v2026.1005.0 (bảng Kanban và nút mật độ bảng)
// Bảng Kanban của Paperclip: mỗi trạng thái một cột có màu riêng và số đếm, thẻ có mã, chấm Đang chạy, tiêu đề hai
// dòng, người làm; cột lạnh thu thành thanh dọc, mỗi cột hiện từng trang thẻ. Kéo thẻ sang cột khác gọi `onMove`
// (màn hình tự gửi PATCH). Không kéo được (`canDrag` false) thì bảng chỉ để xem. Chữ do màn hình truyền vào.
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, Check, ChevronsDownUp, ListCollapse, PanelTopClose, RotateCcw } from 'lucide-react';
import * as React from 'react';
import { cn } from '../cn';
import { Badge } from '../components/badge';
import { Card } from '../components/card';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover';
import { Identity } from './issue-detail';
import { ToolbarIconButton } from './issue-list';
import { NavAnchor } from './nav-anchor';
import { StatusGlyph } from './status-glyph';

/** Quá ngần này thẻ thì bảng tự chuyển thẻ gọn (mật độ "tự động"). */
export const KANBAN_BOARD_HIGH_VOLUME_THRESHOLD = 100;
export const KANBAN_COLUMN_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export type KanbanColumnPageSize = (typeof KANBAN_COLUMN_PAGE_SIZE_OPTIONS)[number];
export const KANBAN_COLUMN_DEFAULT_PAGE_SIZE: KanbanColumnPageSize = 10;
/** Cột "lạnh": thu thành thanh dọc khi bật Thu cột lạnh. */
export const KANBAN_COLD_STATUSES = ['backlog', 'done', 'cancelled'] as const;
/** Thứ tự cột của bảng (khác thứ tự nhóm của danh sách). */
export const KANBAN_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'] as const;

interface ColumnTone {
  rail: string;
  railOver: string;
  header: string;
  count: string;
  body: string;
  bodyOver: string;
  card: string;
}

const DEFAULT_TONE: ColumnTone = {
  rail: 'border-border bg-muted/20',
  railOver: 'bg-accent/50 ring-1 ring-primary/20',
  header: 'text-muted-foreground',
  count: 'text-muted-foreground/60',
  body: 'bg-muted/20',
  bodyOver: 'bg-accent/40',
  card: '',
};

// Mỗi cột một sắc theo trạng thái: xám backlog, hổ phách todo, xanh dương đang làm, tím review, đỏ bị chặn, lục xong.
const COLUMN_TONES: Record<string, ColumnTone> = {
  backlog: {
    rail: 'border-border bg-muted/30',
    railOver: 'bg-muted/50 ring-1 ring-neutral-400/25',
    header: 'text-muted-foreground',
    count: 'text-muted-foreground/60',
    body: 'bg-muted/30 ring-1 ring-inset ring-border/50',
    bodyOver: 'bg-muted/50 ring-1 ring-inset ring-neutral-400/25',
    card: '',
  },
  todo: {
    rail: 'border-amber-500/25 bg-amber-50/60 dark:bg-amber-950/20',
    railOver: 'bg-amber-100/70 ring-1 ring-amber-500/25 dark:bg-amber-950/35',
    header: 'text-amber-700 dark:text-amber-300',
    count: 'text-amber-700/65 dark:text-amber-300/65',
    body: 'bg-amber-50/45 ring-1 ring-inset ring-amber-500/15 dark:bg-amber-950/15',
    bodyOver: 'bg-amber-100/70 ring-1 ring-inset ring-amber-500/25 dark:bg-amber-950/30',
    card: '',
  },
  in_progress: {
    rail: 'border-violet-500/25 bg-violet-50/60 dark:bg-violet-950/20',
    railOver: 'bg-violet-100/70 ring-1 ring-violet-500/25 dark:bg-violet-950/35',
    header: 'text-violet-700 dark:text-violet-300',
    count: 'text-violet-700/65 dark:text-violet-300/65',
    body: 'bg-violet-50/45 ring-1 ring-inset ring-violet-500/15 dark:bg-violet-950/15',
    bodyOver: 'bg-violet-100/70 ring-1 ring-inset ring-violet-500/25 dark:bg-violet-950/30',
    card: '',
  },
  blocked: {
    rail: 'border-red-500/25 bg-red-50/60 dark:bg-red-950/20',
    railOver: 'bg-red-100/70 ring-1 ring-red-500/25 dark:bg-red-950/35',
    header: 'text-red-700 dark:text-red-300',
    count: 'text-red-700/65 dark:text-red-300/65',
    body: 'bg-red-50/45 ring-1 ring-inset ring-red-500/15 dark:bg-red-950/15',
    bodyOver: 'bg-red-100/70 ring-1 ring-inset ring-red-500/25 dark:bg-red-950/30',
    card: '',
  },
  in_review: {
    rail: 'border-cyan-500/25 bg-cyan-50/60 dark:bg-cyan-950/20',
    railOver: 'bg-cyan-100/70 ring-1 ring-cyan-500/25 dark:bg-cyan-950/35',
    header: 'text-cyan-700 dark:text-cyan-300',
    count: 'text-cyan-700/65 dark:text-cyan-300/65',
    body: 'bg-cyan-50/45 ring-1 ring-inset ring-cyan-500/15 dark:bg-cyan-950/15',
    bodyOver: 'bg-cyan-100/70 ring-1 ring-inset ring-cyan-500/25 dark:bg-cyan-950/30',
    card: '',
  },
  done: {
    rail: 'border-green-500/25 bg-green-50/60 dark:bg-green-950/20',
    railOver: 'bg-green-100/70 ring-1 ring-green-500/25 dark:bg-green-950/35',
    header: 'text-green-700 dark:text-green-300',
    count: 'text-green-700/65 dark:text-green-300/65',
    body: 'bg-green-50/45 ring-1 ring-inset ring-green-500/15 dark:bg-green-950/15',
    bodyOver: 'bg-green-100/70 ring-1 ring-inset ring-green-500/25 dark:bg-green-950/30',
    card: '',
  },
  cancelled: {
    rail: 'border-neutral-300/70 bg-muted/25 opacity-80 dark:border-neutral-700/70 dark:bg-neutral-900/20',
    railOver: 'bg-muted/45 opacity-90 ring-1 ring-neutral-400/25 dark:bg-neutral-900/35',
    header: 'text-muted-foreground/80',
    count: 'text-muted-foreground/50',
    body: 'bg-muted/25 ring-1 ring-inset ring-border/50',
    bodyOver: 'bg-muted/45 ring-1 ring-inset ring-neutral-400/25',
    card: 'bg-muted/35 text-muted-foreground opacity-80 hover:shadow-none',
  },
};

const toneOf = (status: string): ColumnTone => COLUMN_TONES[status] ?? DEFAULT_TONE;

export interface KanbanCardData {
  id: string;
  status: string;
  title: string;
  /** Mã hiện ở đầu thẻ (TPS-12). */
  identifier: string;
  /** Trang đầy đủ của yêu cầu; click thường gọi `onOpen`. */
  href: string;
  onOpen: () => void;
  /** Tên người làm; không có tên mà có id thì hiện 8 ký tự đầu của id. */
  assigneeName?: string | null;
  assigneeId?: string | null;
  live?: boolean;
  /** Số yêu cầu con (mọi cấp) đang chạy. */
  liveBelow?: number;
  /** Run xong mà chưa có bước tiếp theo. */
  needsNextStep?: boolean;
  /** Phần thêm ở dòng cuối thẻ (giai đoạn Crew, x/y con xong). */
  meta?: React.ReactNode;
}

export interface KanbanBoardLabels {
  status: (status: string) => string;
  showMore: (count: number) => string;
  showing: (shown: number, total: number) => string;
  live: string;
  liveBelow: (count: number) => string;
  nextStep: string;
  nextStepTitle: string;
}

/** Cột đích khi thả: `overId` là id cột (trạng thái) hoặc id thẻ nằm trong cột đó. */
export function resolveKanbanTargetStatus(
  overId: string,
  cards: readonly Pick<KanbanCardData, 'id' | 'status'>[],
): string | null {
  if ((KANBAN_STATUSES as readonly string[]).includes(overId)) return overId;
  return cards.find((c) => c.id === overId)?.status ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Thẻ.

interface KanbanCardViewProps extends Omit<React.ComponentProps<typeof Card>, 'title'> {
  card: KanbanCardData;
  labels: KanbanBoardLabels;
  compact: boolean;
  overlay?: boolean;
  dragging?: boolean;
  draggable?: boolean;
}

function KanbanCardView({
  card,
  labels,
  compact,
  overlay = false,
  dragging = false,
  draggable = false,
  className,
  ...rest
}: KanbanCardViewProps) {
  const liveBelow = card.liveBelow ?? 0;
  return (
    <Card
      data-testid="kanban-card"
      data-issue-id={card.id}
      className={cn(
        'block gap-0 py-0 transition-shadow',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging && !overlay ? 'opacity-30' : '',
        overlay ? 'shadow-lg ring-1 ring-primary/20' : 'hover:shadow-sm',
        compact ? 'p-2' : 'p-2.5',
        className,
      )}
      {...rest}
    >
      <NavAnchor
        href={card.href}
        onOpen={() => {
          // Vừa kéo xong thì không mở yêu cầu.
          if (!dragging) card.onOpen();
        }}
        aria-label={card.title}
        className="block text-inherit no-underline"
      >
        <div className={cn('flex items-start gap-1.5', compact ? 'mb-1' : 'mb-1.5')}>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{card.identifier}</span>
          {card.needsNextStep ? (
            <Badge
              variant="outline"
              className="border-amber-400/45 bg-amber-50/60 px-1.5 text-(length:--text-nano) text-amber-700 dark:border-amber-300/35 dark:bg-amber-400/10 dark:text-amber-300"
              title={labels.nextStepTitle}
            >
              <AlertTriangle aria-hidden className="size-3" />
              {labels.nextStep}
            </Badge>
          ) : null}
          {card.live ? (
            <span
              data-slot="kanban-live"
              title={labels.live}
              className="inline-flex shrink-0 items-center gap-1 text-(length:--text-nano) font-medium text-violet-600 dark:text-violet-400"
            >
              <span aria-hidden className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-pulse rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-violet-500" />
              </span>
              {compact ? labels.live : <span className="sr-only">{labels.live}</span>}
            </span>
          ) : null}
          {!card.live && liveBelow > 0 ? (
            <Badge variant="outline" className="border-border px-1.5 text-(length:--text-nano) text-muted-foreground">
              <span aria-hidden className="size-2 shrink-0 rounded-full border border-muted-foreground/60" />
              {labels.liveBelow(liveBelow)}
            </Badge>
          ) : null}
        </div>
        <p className={cn('line-clamp-2 leading-snug', compact ? 'mb-1.5 text-xs' : 'mb-2 text-sm')}>{card.title}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {card.assigneeName ? (
            <Identity name={card.assigneeName} />
          ) : card.assigneeId ? (
            <span className="font-mono text-xs text-muted-foreground">{card.assigneeId.slice(0, 8)}</span>
          ) : null}
          {card.meta}
        </div>
      </NavAnchor>
    </Card>
  );
}

function SortableKanbanCard({
  card,
  labels,
  compact,
  className,
}: {
  card: KanbanCardData;
  labels: KanbanBoardLabels;
  compact: boolean;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <KanbanCardView
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      card={card}
      labels={labels}
      compact={compact}
      dragging={isDragging}
      draggable
      className={className}
      {...attributes}
      {...listeners}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Cột.

interface KanbanColumnProps {
  status: string;
  cards: KanbanCardData[];
  labels: KanbanBoardLabels;
  compact: boolean;
  collapsed: boolean;
  visibleCount: number;
  revealIncrement: number;
  onShowMore: () => void;
  canDrag: boolean;
}

function KanbanColumn(props: KanbanColumnProps) {
  return props.canDrag ? <DroppableColumn {...props} /> : <ColumnLayout {...props} isOver={false} />;
}

function DroppableColumn(props: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: props.status });
  return <ColumnLayout {...props} dropRef={setNodeRef} isOver={isOver} />;
}

function ColumnLayout({
  status,
  cards,
  labels,
  compact,
  collapsed,
  visibleCount,
  revealIncrement,
  onShowMore,
  canDrag,
  dropRef,
  isOver,
}: KanbanColumnProps & { dropRef?: (el: HTMLElement | null) => void; isOver: boolean }) {
  const visible = collapsed ? [] : cards.slice(0, visibleCount);
  const hiddenCount = Math.max(cards.length - visible.length, 0);
  const nextReveal = Math.min(revealIncrement, hiddenCount);
  const tone = toneOf(status);
  const label = labels.status(status);

  if (collapsed) {
    return (
      <div
        ref={dropRef}
        data-testid="kanban-column"
        data-status={status}
        data-collapsed="true"
        className={cn(
          'flex min-h-(--sz-220px) w-(--sz-52px) shrink-0 flex-col items-center rounded-md border px-1.5 py-2 transition-colors',
          tone.rail,
          isOver && tone.railOver,
        )}
        title={`${label}: ${cards.length}`}
      >
        <StatusGlyph status={status} />
        <span
          className={cn(
            'mt-2 rotate-180 text-(length:--text-nano) font-semibold tracking-wide uppercase [writing-mode:vertical-rl]',
            tone.header,
          )}
        >
          {label}
        </span>
        <Badge
          variant="ghost"
          className={cn('mt-auto bg-background px-1.5 text-(length:--text-nano) tabular-nums', tone.header)}
        >
          {cards.length}
        </Badge>
      </div>
    );
  }

  const renderCard = (card: KanbanCardData) =>
    canDrag ? (
      <SortableKanbanCard key={card.id} card={card} labels={labels} compact={compact} className={tone.card} />
    ) : (
      <KanbanCardView key={card.id} card={card} labels={labels} compact={compact} className={tone.card} />
    );

  return (
    <section
      data-testid="kanban-column"
      data-status={status}
      aria-label={label}
      className="flex w-(--sz-260px) min-w-(--sz-260px) shrink-0 flex-col"
    >
      <div className="mb-1 flex items-center gap-2 px-3 py-2">
        <StatusGlyph status={status} />
        <span className={cn('text-xs font-semibold tracking-wide uppercase', tone.header)}>{label}</span>
        <span data-slot="kanban-count" className={cn('ml-auto text-xs tabular-nums', tone.count)}>
          {cards.length}
        </span>
      </div>
      <div
        ref={dropRef}
        className={cn(
          'min-h-(--sz-120px) flex-1 space-y-1 rounded-md p-2 transition-colors',
          isOver ? tone.bodyOver : tone.body,
        )}
      >
        {/* Thẻ chưa hiện không làm đích sắp xếp cho tới khi bấm Hiện thêm. */}
        {canDrag ? (
          <SortableContext items={visible.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {visible.map(renderCard)}
          </SortableContext>
        ) : (
          visible.map(renderCard)
        )}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="mt-1 flex w-full items-center justify-center rounded-md border border-dashed border-border bg-background/70 px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            onClick={onShowMore}
          >
            {labels.showMore(nextReveal)}
          </button>
        ) : null}
        {cards.length > 0 && (hiddenCount > 0 || cards.length >= visibleCount) ? (
          <p className="px-1 pt-1 text-(length:--text-micro) text-muted-foreground">
            {labels.showing(visible.length, cards.length)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Bảng.

export interface KanbanBoardProps {
  cards: KanbanCardData[];
  labels: KanbanBoardLabels;
  compact?: boolean;
  collapsedStatuses?: readonly string[];
  /** Số thẻ mỗi cột hiện lúc đầu và mỗi lần bấm Hiện thêm. */
  pageSize?: number;
  /** false: không kéo thả (người chỉ đọc). */
  canDrag: boolean;
  /** Thả thẻ sang cột khác trạng thái. */
  onMove: (id: string, status: string) => void;
}

function KanbanBoard({
  cards,
  labels,
  compact = false,
  collapsedStatuses = [],
  pageSize = KANBAN_COLUMN_DEFAULT_PAGE_SIZE,
  canDrag,
  onMove,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [visibleState, setVisibleState] = React.useState<{ pageSize: number; counts: Record<string, number> }>({
    pageSize,
    counts: {},
  });
  // Đổi số thẻ mỗi cột thì mọi cột về trang đầu.
  const counts = visibleState.pageSize === pageSize ? visibleState.counts : {};
  const collapsedSet = React.useMemo(() => new Set(collapsedStatuses), [collapsedStatuses]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byStatus = React.useMemo(() => {
    const grouped = new Map<string, KanbanCardData[]>(KANBAN_STATUSES.map((s) => [s, []]));
    for (const card of cards) grouped.get(card.status)?.push(card);
    return grouped;
  }, [cards]);

  const activeCard = activeId ? cards.find((c) => c.id === activeId) : undefined;

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const card = cards.find((c) => c.id === String(active.id));
    if (!card) return;
    const target = resolveKanbanTargetStatus(String(over.id), cards);
    if (target && target !== card.status) onMove(card.id, target);
  };

  const columns = (
    <div data-testid="kanban-board" className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-4">
      {KANBAN_STATUSES.map((status) => {
        const columnCards = byStatus.get(status) ?? [];
        return (
          <KanbanColumn
            key={status}
            status={status}
            cards={columnCards}
            labels={labels}
            compact={compact}
            // Đang thu cột lạnh thì cột trống cũng thu thành thanh cho đồng đều.
            collapsed={collapsedSet.has(status) || (collapsedSet.size > 0 && columnCards.length === 0)}
            visibleCount={counts[status] ?? pageSize}
            revealIncrement={pageSize}
            canDrag={canDrag}
            onShowMore={() =>
              setVisibleState((current) => {
                const base = current.pageSize === pageSize ? current.counts : {};
                return { pageSize, counts: { ...base, [status]: (base[status] ?? pageSize) + pageSize } };
              })
            }
          />
        );
      })}
    </div>
  );

  if (!canDrag) return columns;
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      {columns}
      <DragOverlay>
        {activeCard ? <KanbanCardView card={activeCard} labels={labels} compact={compact} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Nút mật độ bảng trên thanh công cụ (chỉ hiện ở chế độ bảng).

export interface KanbanToolbarControlsProps {
  compact: boolean;
  coldCollapsed: boolean;
  pageSize: number;
  /** Có thiết lập khác mặc định: bật nút Đặt lại. */
  customized: boolean;
  onToggleCompact: () => void;
  onToggleCold: () => void;
  onPageSize: (size: KanbanColumnPageSize) => void;
  onReset: () => void;
  labels: {
    compactOn: string;
    compactOff: string;
    coldCollapse: string;
    coldExpand: string;
    pageSize: string;
    perColumn: (size: number) => string;
    reset: string;
  };
}

function KanbanToolbarControls({
  compact,
  coldCollapsed,
  pageSize,
  customized,
  onToggleCompact,
  onToggleCold,
  onPageSize,
  onReset,
  labels,
}: KanbanToolbarControlsProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <ToolbarIconButton
        label={compact ? labels.compactOff : labels.compactOn}
        active={compact}
        aria-pressed={compact}
        onClick={onToggleCompact}
      >
        <ChevronsDownUp aria-hidden />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={coldCollapsed ? labels.coldExpand : labels.coldCollapse}
        active={coldCollapsed}
        aria-pressed={coldCollapsed}
        onClick={onToggleCold}
      >
        <PanelTopClose aria-hidden />
      </ToolbarIconButton>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ToolbarIconButton
            label={labels.pageSize}
            active={pageSize !== KANBAN_COLUMN_DEFAULT_PAGE_SIZE}
            className="size-auto h-8 gap-1.5 px-2"
          >
            <ListCollapse aria-hidden />
            <span className="min-w-4 text-xs tabular-nums">{pageSize}</span>
          </ToolbarIconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 p-0">
          <div role="menu" aria-label={labels.pageSize} className="flex flex-col gap-0.5 p-2">
            {KANBAN_COLUMN_PAGE_SIZE_OPTIONS.map((size) => {
              const selected = size === pageSize;
              return (
                <button
                  key={size}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={cn(
                    'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm',
                    selected ? 'bg-accent/50 text-foreground' : 'text-muted-foreground hover:bg-accent/50',
                  )}
                  onClick={() => {
                    onPageSize(size);
                    setOpen(false);
                  }}
                >
                  <span>{labels.perColumn(size)}</span>
                  {selected ? <Check aria-hidden className="size-3.5" /> : null}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      <ToolbarIconButton label={labels.reset} disabled={!customized} onClick={onReset}>
        <RotateCcw aria-hidden />
      </ToolbarIconButton>
    </>
  );
}

export { KanbanBoard, KanbanToolbarControls };
