// crew: tự dựng
// Mặt nút của bản đồ Roadmap: cùng kiểu thẻ với bản đồ yêu cầu Crew (bo góc, viền, nền thẻ, bóng nhẹ), màu trạng thái
// lấy từ cùng bảng với danh sách/bảng Kanban (`statusColorVar`). Mỗi nút là một <button> có aria-label đủ nghĩa.
import { BookOpen, Building2, FileText, Folder, FolderOpen } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useT } from '@/i18n';
import { cn } from '../../cn';
import { StatusGlyph, statusColorVar } from '../status-glyph';
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

const Meta = ({ children }: { children: ReactNode }) => (
  <span className="block truncate text-xs text-muted-foreground">{children}</span>
);

function IssueHead({ node }: { node: RoadmapNode }) {
  const { t } = useT();
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <StatusGlyph status={node.status ?? 'backlog'} size="sm" />
      <span className="truncate">{[node.identifier, statusText(t, node.status)].filter(Boolean).join(' · ')}</span>
    </span>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useT();
  if (!total) return <Meta>{t('roadmap.meta.noChildren')}</Meta>;
  return (
    <>
      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.round((done / total) * 100)}%`, background: statusColorVar('done') }}
        />
      </span>
      <Meta>{t('roadmap.meta.progress', { done, total })}</Meta>
    </>
  );
}

/** Nội dung bên trong nút theo loại. */
function Face({ node, center }: { node: RoadmapNode; center: boolean }) {
  const { t } = useT();
  switch (node.kind) {
    case 'company':
      return (
        <>
          <Building2 aria-hidden className="size-5 text-primary" />
          <strong className="line-clamp-2 text-sm font-semibold">{node.title}</strong>
          <span className="text-xs text-muted-foreground">
            {t('roadmap.meta.company', { projects: node.total ?? 0, open: node.open ?? 0 })}
          </span>
        </>
      );
    case 'project':
      return (
        <>
          <Folder aria-hidden className="size-4 text-muted-foreground" />
          <strong className="line-clamp-2 text-sm font-semibold">{node.title}</strong>
          <span className="text-xs text-muted-foreground">
            {t('roadmap.meta.requests', { count: node.total ?? 0 })}
          </span>
          <span className="text-xs text-muted-foreground">{t('roadmap.meta.open', { count: node.open ?? 0 })}</span>
        </>
      );
    case 'request':
      return (
        <>
          <IssueHead node={node} />
          <strong className={cn('block font-semibold', center ? 'line-clamp-2' : 'truncate')}>{node.title}</strong>
          <Progress done={node.done ?? 0} total={node.total ?? 0} />
          {node.detail ? <Meta>{node.detail}</Meta> : null}
        </>
      );
    case 'ticket':
      return (
        <>
          <IssueHead node={node} />
          <strong className="block truncate font-semibold">{node.title}</strong>
          <Meta>
            {[
              node.assignee ?? t('roadmap.meta.unassigned'),
              node.children ? t('roadmap.meta.children', { count: node.children }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Meta>
          {node.detail ? <Meta>{node.detail}</Meta> : null}
        </>
      );
    case 'docs':
      return (
        <>
          <span className="flex items-center gap-1.5">
            <BookOpen aria-hidden className="size-4 text-primary" />
            <strong className="font-semibold">{t('roadmap.docs')}</strong>
          </span>
          <Meta>{node.disabled ? t('roadmap.meta.noDocs') : t('roadmap.meta.pages', { count: node.total ?? 0 })}</Meta>
        </>
      );
    case 'folder':
      return (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            <FolderOpen aria-hidden className="size-4 shrink-0 text-primary" />
            <strong className="truncate font-semibold">{node.title}</strong>
          </span>
          <Meta>{t('roadmap.meta.pages', { count: node.total ?? 0 })}</Meta>
        </>
      );
    case 'page':
      return (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <strong className="truncate font-semibold">{node.title}</strong>
          </span>
          {node.subtitle ? <Meta>{node.subtitle}</Meta> : null}
        </>
      );
    default:
      return <span className="font-medium">{t('roadmap.more', { count: node.extra ?? 0 })}</span>;
  }
}

const SHAPE: Record<RoadmapNode['kind'], string> = {
  company: 'size-40 flex-col items-center justify-center gap-1 rounded-full border-2 border-primary p-4 text-center',
  project: 'size-34 flex-col items-center justify-center gap-0.5 rounded-full border-[3px] p-3 text-center',
  request: 'w-[200px] flex-col rounded-lg border border-l-4 px-3 py-2 text-left text-sm',
  ticket: 'w-[180px] flex-col rounded-lg border border-l-4 px-3 py-2 text-left text-sm',
  docs: 'w-[180px] flex-col rounded-lg border-2 border-primary/60 px-3 py-2 text-left text-sm',
  folder: 'w-[180px] flex-col rounded-lg border px-3 py-2 text-left text-sm',
  page: 'w-[180px] flex-col rounded-lg border px-3 py-2 text-left text-sm',
  more: 'min-w-28 items-center justify-center rounded-full border border-dashed px-3 py-2 text-sm text-primary',
};

const CENTER: Partial<Record<RoadmapNode['kind'], string>> = {
  project: 'size-40',
  request: 'w-[232px] border-2 border-l-[6px] py-3',
  folder: 'w-[200px] border-2 border-primary/60',
  docs: 'w-[200px]',
};

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
  const { t } = useT();
  const style: CSSProperties & Record<string, string> = {};
  if (node.kind === 'project') style.borderColor = node.color || 'var(--primary)';
  if ((node.kind === 'request' || node.kind === 'ticket') && node.status) {
    style.borderLeftColor = statusColorVar(node.status);
  }
  if (enter) {
    style['--from-x'] = `${enter.fromX}px`;
    style['--from-y'] = `${enter.fromY}px`;
    style['--enter-delay'] = `${enter.delay}ms`;
  }
  return (
    <button
      type="button"
      data-roadmap-id={node.id}
      data-roadmap-kind={node.kind}
      data-center={center || undefined}
      data-current={node.current || undefined}
      aria-label={roadmapNodeLabel(t, node)}
      aria-current={node.current || undefined}
      aria-disabled={node.disabled || undefined}
      title={node.notes?.length ? nodeTooltip(node) : undefined}
      onClick={() => {
        if (!node.disabled) onActivate();
      }}
      style={style}
      className={cn(
        'pointer-events-auto flex cursor-pointer bg-card text-card-foreground shadow-sm transition-[opacity,border-color,box-shadow] duration-300',
        'hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        SHAPE[node.kind],
        center && CENTER[node.kind],
        center && 'shadow-md',
        node.current && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        node.disabled && 'cursor-default border-dashed border-border bg-muted/40 text-muted-foreground shadow-none',
        dimmed && 'pointer-events-none opacity-15',
        enter && 'roadmap-node-enter',
      )}
    >
      <Face node={node} center={center} />
    </button>
  );
}
