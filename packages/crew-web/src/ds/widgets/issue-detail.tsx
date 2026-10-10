// clone: ui/src/pages/IssueDetail.tsx + ui/src/components/{StatusGlyph,Identity,issue-properties/primitives,task-chat/TaskChatBubble}.tsx @ v2026.1005.0 (rút gọn cho Crew)
// Bố cục trang chi tiết task của Paperclip: thanh breadcrumb trên cùng, cột chính (tiêu đề, mô tả, luồng trao đổi,
// ô soạn cố định đáy) và cột Thuộc tính bên phải chia nhóm. Bỏ mọi control sửa của Paperclip; chữ do màn hình truyền vào.
import { ChevronRight, Folder } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../cn';
import { Avatar, AvatarFallback } from '../components/avatar';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog';
import { StatusGlyph } from './status-glyph';

/** Glyph kèm nhãn trạng thái (dòng Trạng thái của cột Thuộc tính). */
function StatusLabel({ status, label }: { status: string; label: string }) {
  return (
    <span data-slot="status-label" data-status={status} className="inline-flex min-w-0 items-center gap-1.5 text-sm">
      <StatusGlyph status={status} />
      <span className="truncate">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Identity (ui/src/components/Identity.tsx): avatar chữ cái đầu + tên.

function initialsOf(name: string): string {
  // Tên agent dạng `p-2ps-landing-integrator`: tách theo khoảng trắng, gạch và gạch dưới, chỉ lấy chữ cái.
  const parts = name
    .trim()
    .split(/[\s_-]+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] ?? name.trim()).slice(0, 2).toUpperCase();
}

function Identity({ name, size = 'xs', strong = false }: { name: string; size?: 'xs' | 'sm'; strong?: boolean }) {
  return (
    <span data-slot="identity" className="inline-flex min-w-0 items-center gap-1.5" title={name}>
      <Avatar size={size}>
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>
      <span className={cn('truncate text-sm', strong && 'font-semibold text-foreground')}>{name}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Cột Thuộc tính (ui/src/components/issue-properties/primitives.tsx): nhóm có nhãn viết hoa, dòng nhãn | giá trị.

function PropertySection({ title, first, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <section data-property-section="true" aria-label={title}>
      <h3
        className={cn(
          'pb-1 font-mono text-(length:--text-nano) font-normal uppercase tracking-wide text-muted-foreground/70',
          first ? 'pt-0' : 'pt-5',
        )}
      >
        {title}
      </h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function PropertyRow({ label, wrap, children }: { label: string; wrap?: boolean; children: React.ReactNode }) {
  return (
    <div
      data-property-row="true"
      className={cn('flex w-full min-w-0 gap-3 py-1', wrap ? 'items-start' : 'items-center')}
    >
      <span className={cn('w-24 shrink-0 truncate text-xs text-muted-foreground', wrap && 'mt-0.5')} title={label}>
        {label}
      </span>
      <div
        data-property-value="true"
        className={cn('flex min-w-0 flex-1 items-center gap-1.5 text-sm', wrap && 'flex-col items-start')}
      >
        {children}
      </div>
    </div>
  );
}

/** Chip viền (yêu cầu cha/con, bị chặn bởi, project): bọc link hoặc chữ. */
function PropertyChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-slot="property-chip"
      className="inline-flex max-w-full min-w-0 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs [&_a]:truncate [&_a]:hover:underline"
    >
      {children}
    </span>
  );
}

/** Giá trị rỗng ("Không có") mờ như Paperclip. */
function PropertyEmpty({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>;
}

// ---------------------------------------------------------------------------------------------------------------
// Khung trang: thanh breadcrumb, cột chính, cột phải.

interface IssueTopBarProps {
  /** Link về danh sách (chữ viết hoa như "TASKS" của Paperclip). */
  root: React.ReactNode;
  status: string;
  title: string;
  identifier: string;
  actions?: React.ReactNode;
}

function IssueTopBar({ root, status, title, identifier, actions }: IssueTopBarProps) {
  return (
    <div
      data-slot="issue-top-bar"
      className="flex min-h-12 items-center gap-2 border-b pb-3 text-sm text-muted-foreground"
    >
      <nav className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-xs font-medium uppercase tracking-wider [&_a]:hover:text-foreground">
          {root}
        </span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0" />
        <StatusGlyph status={status} size="sm" />
        <span className="min-w-0 truncate text-foreground">{title}</span>
        <span className="shrink-0 font-mono text-xs">{identifier}</span>
      </nav>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

interface IssueDetailFrameProps {
  topBar: React.ReactNode;
  /** Cột chính: header, mô tả, luồng trao đổi, ô soạn. */
  children: React.ReactNode;
  /** Cột phải: Thuộc tính (và các khối bổ sung sau này). */
  side: React.ReactNode;
  variant?: 'page' | 'popup';
}

function IssueDetailFrame({ topBar, children, side, variant = 'page' }: IssueDetailFrameProps) {
  return (
    <div
      data-slot="issue-detail"
      data-variant={variant}
      className={cn('flex min-w-0 flex-col', variant === 'popup' && 'px-6 pt-3')}
    >
      {topBar}
      <div className="grid min-w-0 gap-6 pt-5 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">{children}</div>
        <aside
          data-slot="issue-side"
          className="flex min-w-0 flex-col gap-6 border-t pt-5 lg:sticky lg:top-0 lg:self-start lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
        >
          {side}
        </aside>
      </div>
    </div>
  );
}

/** Nhãn đầu cột phải ("Properties" của Paperclip). */
function SidePanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="border-b pb-3 text-sm font-semibold text-foreground">{children}</h2>;
}

interface IssueHeaderProps {
  status: string;
  statusLabel: string;
  /** Tiêu đề (kèm nút sửa) do màn hình dựng. */
  title: React.ReactNode;
  identifier: string;
  /** Dòng phụ dưới tiêu đề: project, người làm. */
  meta?: React.ReactNode;
  /** Nút thao tác bên phải tiêu đề. */
  actions?: React.ReactNode;
}

function IssueHeader({ status, statusLabel, title, identifier, meta, actions }: IssueHeaderProps) {
  return (
    <header data-testid="issue-detail-header" className="flex flex-col gap-2">
      <div className="flex min-w-0 items-start gap-2">
        <span className="pt-1.5">
          <StatusGlyph status={status} size="lg" title={statusLabel} />
        </span>
        <div data-slot="task-detail-title" className="flex min-w-0 flex-1 items-baseline gap-2">
          <div className="min-w-0 flex-1 text-xl leading-normal font-semibold text-balance [&_h2]:text-xl [&_h2]:font-semibold">
            {title}
          </div>
          <span className="hidden shrink-0 font-mono text-sm text-muted-foreground md:inline">{identifier}</span>
        </div>
      </div>
      {meta ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 pl-7 text-sm text-muted-foreground">
          {meta}
        </div>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center gap-2 pl-7">{actions}</div> : null}
    </header>
  );
}

/** Project trên dòng phụ: ô vuông có icon thư mục + tên. */
function ProjectTag({ name }: { name: string }) {
  return (
    <span data-slot="project-tag" className="inline-flex min-w-0 items-center gap-1.5">
      <span className="inline-flex size-5 items-center justify-center rounded-sm border bg-muted/50">
        <Folder aria-hidden className="size-3" />
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Luồng trao đổi (ui/src/components/task-chat/TaskChatBubble.tsx): người nằm phải trong bong bóng xanh, agent nằm
// trái có avatar + tên, mô tả là bong bóng xám đầu luồng.

interface ChatMessageProps extends Omit<React.ComponentProps<'article'>, 'children'> {
  kind: 'agent' | 'human' | 'brief';
  author: string;
  /** Dòng nhỏ dưới tin (giờ, "Bạn · giờ"). */
  footer?: React.ReactNode;
  /** Nút cạnh tên (ví dụ sửa mô tả). */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

function ChatMessage({ kind, author, footer, aside, children, className, ...props }: ChatMessageProps) {
  const human = kind === 'human';
  return (
    <article
      data-slot="chat-message"
      data-kind={kind}
      className={cn('flex w-full scroll-mt-20 flex-col gap-1', human ? 'items-end' : 'items-start', className)}
      {...props}
    >
      {human ? null : (
        <div className="flex w-full min-w-0 items-center gap-2 px-1">
          <Identity name={author} size="sm" strong />
          {aside ? <span className="ml-auto flex shrink-0 items-center">{aside}</span> : null}
        </div>
      )}
      <div
        className={cn(
          'min-w-0 py-2 text-sm break-words',
          human &&
            'max-w-(--pct-85) rounded-2xl rounded-br-sm bg-(--liveness-blue) px-3.5 text-white [&_.prose]:text-white [&_a]:text-white [&_code]:text-white',
          kind === 'agent' && 'w-full px-1 text-foreground',
          kind === 'brief' && 'w-full rounded-2xl rounded-bl-sm bg-(--bubble-agent) px-3.5 text-foreground',
        )}
      >
        {children}
      </div>
      {footer ? <div className="px-1 text-xs text-muted-foreground">{footer}</div> : null}
    </article>
  );
}

/** Dòng hệ thống giữa luồng (run đang chạy, mốc): chữ nhỏ giữa hai đường kẻ. */
function ChatDivider({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="chat-divider" className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Mục phụ trong cột chính (Tài liệu, Đính kèm, Run): nhãn nhỏ, nội dung không khung thẻ. */
function DetailSection({
  title,
  count,
  actions,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title: string;
  count?: number;
  actions?: React.ReactNode;
}) {
  return (
    <section data-slot="detail-section" aria-label={title} className="flex flex-col gap-2" {...props}>
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
        {count !== undefined ? <span className="text-xs text-muted-foreground">{count}</span> : null}
        {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-2 text-sm">{children}</div>
    </section>
  );
}

/** Ô soạn cố định đáy cột chính, khung bo tròn như composer của Paperclip. */
function ComposerDock({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="composer-dock" className="sticky bottom-0 z-10 bg-background pt-2 pb-3">
      <div className="flex flex-col gap-2 rounded-2xl border bg-background p-3 shadow-sm [&_textarea]:min-h-16 [&_textarea]:resize-none [&_textarea]:border-0 [&_textarea]:bg-transparent dark:[&_textarea]:bg-transparent [&_textarea]:shadow-none [&_textarea]:focus-visible:ring-0">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Popup: hộp lớn phủ trang đang xem, nội dung là chính khung chi tiết ở trên.

interface IssuePopupFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tên hộp cho trình đọc màn hình (mã + tiêu đề). */
  title: string;
  description?: string;
  children: React.ReactNode;
}

function IssuePopupFrame({ open, onOpenChange, title, description, children }: IssuePopupFrameProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="issue-popup"
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-y-auto p-0 sm:max-w-[min(1320px,96vw)]"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description ?? title}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export type { ChatMessageProps, IssueDetailFrameProps, IssueHeaderProps, IssuePopupFrameProps, IssueTopBarProps };
export {
  ChatDivider,
  ChatMessage,
  ComposerDock,
  DetailSection,
  Identity,
  IssueDetailFrame,
  IssueHeader,
  IssuePopupFrame,
  IssueTopBar,
  ProjectTag,
  PropertyChip,
  PropertyEmpty,
  PropertyRow,
  PropertySection,
  SidePanelTitle,
  StatusLabel,
};
