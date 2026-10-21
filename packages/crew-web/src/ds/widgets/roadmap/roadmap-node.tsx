// crew: tự dựng
// Mặt nút của bản đồ Roadmap kiểu bàn điều khiển: thẻ nền tối hơi trong (theme sáng: nền trắng), viền mảnh, tô màu theo
// trạng thái từ bảng màu riêng của bản đồ (`roadmapToneVar`, token `--roadmap-tone-*`); đầu thẻ có biểu tượng trạng thái,
// mã, nhãn trạng thái; ô chi tiết dạng dòng lệnh; khối run (vài run mới nhất, tổng tiền). Kích thước thẻ cố định theo nội
// dung, khớp `roadmapNodeSize` trong roadmap-layout.ts.
// Mỗi nút là một <button> có aria-label đủ nghĩa.
import { BookOpen, Bot, Building2, FileText, Folder, FolderOpen, GitBranch } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from '../../cn';
import { StatusGlyph } from '../status-glyph';
import { runsHeight } from './roadmap-layout';
import { RoadmapRunList, roadmapRunsLabel, useRunClock } from './roadmap-run-list';
import { isRunActive } from './roadmap-runs';
import type { RoadmapNode } from './roadmap-types';

type TFn = ReturnType<typeof useT>['t'];

const statusText = (t: TFn, status: string | null | undefined) =>
  status ? t(`status.${status}`, { defaultValue: status }) : '';

/** Nhãn đọc màn hình của một nút, kèm các ghi chú không vừa thẻ (`notes`). */
export function roadmapNodeLabel(t: TFn, node: RoadmapNode): string {
  const base = baseLabel(t, node);
  return node.notes?.length ? `${base}. ${node.notes.join('. ')}` : base;
}

function baseLabel(t: TFn, node: RoadmapNode): string {
  switch (node.kind) {
    case 'company':
      return t('roadmap.aria.company', { name: node.title, projects: node.total ?? 0, open: node.open ?? 0 });
    case 'project':
      return t('roadmap.aria.project', { name: node.title, total: node.total ?? 0, open: node.open ?? 0 });
    case 'request':
      return t('roadmap.aria.request', {
        id: node.identifier ?? '',
        title: node.title,
        status: statusText(t, node.status),
        done: node.done ?? 0,
        total: node.total ?? 0,
      });
    case 'ticket':
      return t('roadmap.aria.ticket', {
        id: node.identifier ?? '',
        title: node.title,
        status: statusText(t, node.status),
        assignee: node.assignee ?? t('roadmap.meta.unassigned'),
      });
    case 'docs':
      if (node.disabled) return node.total === undefined ? t('roadmap.aria.docsLoading') : t('roadmap.aria.docsEmpty');
      return t('roadmap.aria.docs', { count: node.total ?? 0 });
    case 'folder':
      return t('roadmap.aria.folder', { name: node.title, count: node.total ?? 0 });
    case 'page':
      return t('roadmap.aria.page', { title: node.title });
    default:
      return t('roadmap.aria.more', { count: node.extra ?? 0 });
  }
}

/** Dòng phụ của nút Docs: số trang, chưa có docs, hoặc đang tải (chưa biết số trang). */
function docsMeta(t: TFn, node: RoadmapNode): string {
  if (!node.disabled) return t('roadmap.meta.pages', { count: node.total ?? 0 });
  return node.total === undefined ? t('roadmap.meta.loading') : t('roadmap.meta.noDocs');
}

/** Dòng phụ ngắn của một nút (dạng danh sách). */
export function roadmapNodeMeta(t: TFn, node: RoadmapNode): string {
  switch (node.kind) {
    case 'company':
      return t('roadmap.meta.company', { projects: node.total ?? 0, open: node.open ?? 0 });
    case 'project':
      return `${t('roadmap.meta.requests', { count: node.total ?? 0 })} · ${t('roadmap.meta.open', { count: node.open ?? 0 })}`;
    case 'request':
      return `${statusText(t, node.status)} · ${t('roadmap.meta.progress', { done: node.done ?? 0, total: node.total ?? 0 })}`;
    case 'ticket':
      return [statusText(t, node.status), node.assignee].filter(Boolean).join(' · ');
    case 'docs':
      return docsMeta(t, node);
    case 'folder':
      return t('roadmap.meta.pages', { count: node.total ?? 0 });
    case 'page':
      return node.subtitle ?? '';
    default:
      return '';
  }
}

const TONED = new Set([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
  'cancelled',
  'qc_awaiting',
  'qc_reopen',
  'qc_verified',
]);

/** Màu trạng thái của bản đồ (`var(--roadmap-tone-*)`); trạng thái lạ dùng màu "chưa lên kế hoạch". */
export function roadmapToneVar(status: string | null | undefined): string {
  return `var(--roadmap-tone-${status && TONED.has(status) ? status : 'backlog'})`;
}

const Meta = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn('block truncate text-[11px] leading-4 text-muted-foreground', className)}>{children}</span>
);

/** Đầu thẻ yêu cầu/việc con: biểu tượng trạng thái, mã (chữ đơn cách), nhãn trạng thái bên phải. */
function IssueHead({ node }: { node: RoadmapNode }) {
  const { t } = useT();
  const status = node.status ?? 'backlog';
  return (
    <span className="flex h-4 min-w-0 items-center gap-1.5">
      <StatusGlyph status={status} size="sm" color="var(--tone)" />
      <span className="truncate font-mono text-[11px] leading-4 text-muted-foreground">{node.identifier}</span>
      <span className="roadmap-pill ml-auto shrink-0 rounded-full px-1.5 text-[10px] leading-4 font-medium">
        {statusText(t, node.status)}
      </span>
    </span>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useT();
  if (!total) return <Meta>{t('roadmap.meta.noChildren')}</Meta>;
  return (
    <span className="flex h-4 items-center gap-2">
      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        <span
          className="block h-full rounded-full bg-(--roadmap-tone-done) shadow-[0_0_8px_var(--roadmap-tone-done)]"
          style={{ width: `${Math.round((done / total) * 100)}%` }}
        />
      </span>
      <span className="shrink-0 text-[11px] leading-4 text-muted-foreground tabular-nums">
        {t('roadmap.meta.progress', { done, total })}
      </span>
    </span>
  );
}

/** Ô chi tiết dạng dòng lệnh (giai đoạn · vòng sửa của bản đồ Crew): dữ liệu thật của thẻ, không có thì không vẽ. */
function Console({ text }: { text: string }) {
  return (
    <span className="roadmap-console mt-0.5 block h-[22px] truncate rounded-md px-2 font-mono text-[10.5px] leading-[22px]">
      <span aria-hidden className="mr-1.5 opacity-60">
        ›
      </span>
      {text}
    </span>
  );
}

const Title = ({ children, clamp = false }: { children: ReactNode; clamp?: boolean }) => (
  <strong
    className={cn(
      'block text-[13px] leading-[18px] font-semibold text-card-foreground',
      clamp ? 'line-clamp-2' : 'truncate',
    )}
  >
    {children}
  </strong>
);

/** Nội dung bên trong nút theo loại. */
function Face({ node, center, now }: { node: RoadmapNode; center: boolean; now: number }) {
  const { t } = useT();
  switch (node.kind) {
    case 'company':
      return (
        <>
          <Building2 aria-hidden className="size-5 text-(--tone)" />
          <strong className="line-clamp-2 text-sm font-semibold">{node.title}</strong>
          <span className="text-[11px] leading-4 text-muted-foreground">
            {t('roadmap.meta.company', { projects: node.total ?? 0, open: node.open ?? 0 })}
          </span>
        </>
      );
    case 'project':
      return (
        <>
          <Folder aria-hidden className="size-4 text-(--tone)" />
          <strong className="line-clamp-2 text-sm font-semibold">{node.title}</strong>
          <span className="text-[11px] leading-4 text-muted-foreground">
            {t('roadmap.meta.requests', { count: node.total ?? 0 })}
          </span>
          <span className="text-[11px] leading-4 text-muted-foreground">
            {t('roadmap.meta.open', { count: node.open ?? 0 })}
          </span>
        </>
      );
    case 'request':
      return (
        <>
          <IssueHead node={node} />
          <Title clamp={center}>{node.title}</Title>
          <Progress done={node.done ?? 0} total={node.total ?? 0} />
          {node.detail ? <Console text={node.detail} /> : null}
          {node.runs ? <RoadmapRunList runs={node.runs} now={now} /> : null}
        </>
      );
    case 'ticket':
      return (
        <>
          <IssueHead node={node} />
          <Title>{node.title}</Title>
          <span className="flex h-4 min-w-0 items-center gap-1 text-[11px] leading-4 text-muted-foreground">
            <Bot aria-hidden className="size-3 shrink-0 opacity-70" />
            <span className={cn('truncate', !node.assignee && 'italic')}>
              {node.assignee ?? t('roadmap.meta.unassigned')}
            </span>
            {node.children ? (
              <span className="ml-auto flex shrink-0 items-center gap-0.5 tabular-nums">
                <GitBranch aria-hidden className="size-3 opacity-70" />
                {t('roadmap.meta.children', { count: node.children })}
              </span>
            ) : null}
          </span>
          {node.detail ? <Console text={node.detail} /> : null}
          {node.runs ? <RoadmapRunList runs={node.runs} now={now} /> : null}
        </>
      );
    case 'docs':
      return (
        <>
          <span className="flex items-center gap-1.5">
            <BookOpen aria-hidden className="size-4 shrink-0 text-(--tone)" />
            <Title>{t('roadmap.docs')}</Title>
          </span>
          <Meta>{docsMeta(t, node)}</Meta>
        </>
      );
    case 'folder':
      return (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            <FolderOpen aria-hidden className="size-4 shrink-0 text-(--tone)" />
            <Title>{node.title}</Title>
          </span>
          <Meta>{t('roadmap.meta.pages', { count: node.total ?? 0 })}</Meta>
        </>
      );
    case 'page':
      return (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <Title>{node.title}</Title>
          </span>
          {node.subtitle ? <Meta>{node.subtitle}</Meta> : null}
        </>
      );
    default:
      return <span className="text-xs font-medium">{t('roadmap.more', { count: node.extra ?? 0 })}</span>;
  }
}

/** Khung theo loại; kích thước khớp `roadmapNodeSize` (roadmap-layout.ts). Chiều cao thẻ việc nằm ở `ISSUE_HEIGHT`. */
const SHAPE: Record<RoadmapNode['kind'], string> = {
  company: 'roadmap-orb size-40 flex-col items-center justify-center gap-1 rounded-full border-2 p-4 text-center',
  project: 'roadmap-orb size-34 flex-col items-center justify-center gap-0.5 rounded-full border-[3px] p-3 text-center',
  request: 'roadmap-card w-[236px] flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left',
  ticket: 'roadmap-card w-[240px] flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left',
  docs: 'roadmap-card w-[200px] h-[64px] flex-col justify-center gap-1.5 rounded-xl px-3 text-left',
  folder: 'roadmap-card w-[200px] h-[64px] flex-col justify-center gap-1.5 rounded-xl px-3 text-left',
  page: 'roadmap-card w-[200px] h-[64px] flex-col justify-center gap-1.5 rounded-xl px-3 text-left',
  more: 'roadmap-card h-10 w-[120px] items-center justify-center rounded-full border-dashed! text-(--tone)',
};

const CENTER: Partial<Record<RoadmapNode['kind'], string>> = {
  project: 'size-40',
  request: 'w-[268px] justify-between gap-1 py-3',
  folder: 'w-[220px] h-[68px]',
  docs: 'w-[220px] h-[68px]',
};

/**
 * Chiều cao (px) của thẻ việc: thân thẻ, ô chi tiết cao thêm đúng một ô (khớp `DETAIL_LINE` của roadmap-layout.ts), khối
 * run cao thêm `runsHeight`.
 */
const ISSUE_HEIGHT: Record<'request' | 'ticket', { normal: number; center: number; detail: number }> = {
  request: { normal: 82, center: 104, detail: 30 },
  ticket: { normal: 82, center: 82, detail: 30 },
};

function issueHeight(node: RoadmapNode, center: boolean): number | undefined {
  if (node.kind !== 'request' && node.kind !== 'ticket') return undefined;
  const h = ISSUE_HEIGHT[node.kind];
  return (center ? h.center : h.normal) + (node.detail ? h.detail : 0) + runsHeight(node);
}

/** Màu chủ đạo của nút (`--tone`): trạng thái với việc, màu project với project, màu chính với công ty/docs. */
function toneOf(node: RoadmapNode): string {
  switch (node.kind) {
    case 'request':
    case 'ticket':
      return roadmapToneVar(node.status);
    case 'project':
      return node.color || 'var(--primary)';
    case 'company':
    case 'docs':
    case 'folder':
    case 'more':
      return 'var(--primary)';
    default:
      return roadmapToneVar(null);
  }
}

/** Tooltip của nút có ghi chú: tiêu đề đầy đủ (thẻ cắt bớt) rồi mỗi ghi chú một dòng. */
function nodeTooltip(node: RoadmapNode): string {
  const head = [node.identifier, node.title].filter(Boolean).join(' · ');
  return [head, ...(node.notes ?? [])].join('\n');
}

export interface RoadmapNodeButtonProps {
  node: RoadmapNode;
  center: boolean;
  /** Mờ đi khi camera đang phóng vào nút khác. */
  dimmed?: boolean;
  /** Bay ra từ tâm: độ lệch (đơn vị bản đồ) và độ trễ (ms). */
  enter?: { fromX: number; fromY: number; delay: number } | null;
  onActivate: () => void;
}

/** Nút bấm được trên bản đồ (hoặc nút mờ không bấm được khi `node.disabled`). */
export function RoadmapNodeButton({ node, center, dimmed, enter, onActivate }: RoadmapNodeButtonProps) {
  const { t, lang } = useT();
  const now = useRunClock(!!node.runs?.runs.some(isRunActive));
  const style: CSSProperties & Record<string, string | number> = { '--tone': toneOf(node) };
  const height = issueHeight(node, center);
  if (height !== undefined) style.height = height;
  if (enter) {
    style['--from-x'] = `${enter.fromX}px`;
    style['--from-y'] = `${enter.fromY}px`;
    style['--enter-delay'] = `${enter.delay}ms`;
  }
  const issue = node.kind === 'request' || node.kind === 'ticket';
  const label = roadmapNodeLabel(t, node);
  return (
    <button
      type="button"
      data-roadmap-id={node.id}
      data-roadmap-kind={node.kind}
      data-status={issue ? (node.status ?? undefined) : undefined}
      data-center={center || undefined}
      data-current={node.current || undefined}
      aria-label={node.runs ? `${label}. ${roadmapRunsLabel(t, lang, node.runs, now)}` : label}
      aria-current={node.current || undefined}
      aria-disabled={node.disabled || undefined}
      title={node.notes?.length ? nodeTooltip(node) : undefined}
      onClick={() => {
        if (!node.disabled) onActivate();
      }}
      style={style}
      className={cn(
        'pointer-events-auto flex cursor-pointer overflow-hidden text-card-foreground transition-[opacity,border-color,box-shadow] duration-300',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        SHAPE[node.kind],
        center && CENTER[node.kind],
        node.current && 'ring-2 ring-primary ring-offset-2 ring-offset-(--roadmap-canvas)',
        node.disabled &&
          'cursor-default border-dashed! bg-transparent! text-muted-foreground opacity-70 shadow-none! before:hidden',
        dimmed && 'pointer-events-none opacity-15',
        enter && 'roadmap-node-enter',
      )}
    >
      <Face node={node} center={center} now={now} />
    </button>
  );
}
