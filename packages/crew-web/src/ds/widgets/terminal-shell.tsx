// crew: tự dựng
import { ArrowLeft, Check, ChevronsUpDown, Loader2, Minus, Plus, SquareTerminal } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../cn';
import { Button } from '../components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/dropdown-menu';

interface TerminalShellProps {
  /** Nút về, đầu thanh trên. */
  back: React.ReactNode;
  /** Tiêu đề: thường là nút chọn dự án/máy. */
  title: React.ReactNode;
  /** Trạng thái kết nối cạnh tiêu đề (`TerminalStatus`). */
  status?: React.ReactNode;
  /** Nút bên phải thanh trên (cỡ chữ). */
  actions?: React.ReactNode;
  /** Dải báo ngay dưới thanh trên (lỗi phiên, dán quá lớn). */
  banner?: React.ReactNode;
  /** Phủ giữa khung terminal (đang khoá, đang nối, đã ngắt); màn hình cũ vẫn mờ phía sau. */
  overlay?: React.ReactNode;
  /** Khung xterm gắn vào; padding để chữ không dính mép. */
  screenRef: React.Ref<HTMLDivElement>;
  /** Dưới khung terminal (hàng phím phụ trên điện thoại). */
  footer?: React.ReactNode;
}

/**
 * Trang terminal toàn màn hình, luôn nền tối (token `--terminal-*`, class `dark` cho component bên trong): thanh trên
 * gọn, khung terminal giãn hết phần còn lại, thông báo phủ giữa khung thay vì đẩy khung xuống.
 */
function TerminalShell({ back, title, status, actions, banner, overlay, screenRef, footer }: TerminalShellProps) {
  return (
    <div data-slot="terminal-shell" className="dark flex h-dvh flex-col bg-terminal text-terminal-foreground">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-terminal-border bg-terminal-surface px-2 sm:gap-2 sm:px-3">
        {back}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {title}
          {status}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      {banner}
      <div className="relative min-h-0 flex-1">
        <div ref={screenRef} className="absolute inset-0 py-2 pr-1 pl-3" />
        {overlay ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-terminal/75 p-4 backdrop-blur-[2px]">
            {overlay}
          </div>
        ) : null}
      </div>
      {footer}
    </div>
  );
}

type TerminalStatusTone = 'connecting' | 'open' | 'closed' | 'locked';

const DOT: Record<TerminalStatusTone, string> = {
  connecting: 'bg-amber-400 motion-safe:animate-pulse',
  open: 'bg-emerald-400',
  closed: 'bg-zinc-500',
  locked: 'bg-amber-400',
};

/** Chấm màu kèm chữ trạng thái; màn hẹp chỉ còn chấm, chữ vẫn đọc được bằng trình đọc màn hình. */
function TerminalStatus({ tone, label }: { tone: TerminalStatusTone; label: string }) {
  return (
    <span
      role="status"
      data-tone={tone}
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-terminal-muted"
    >
      <span aria-hidden className={cn('size-2 rounded-full', DOT[tone])} />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </span>
  );
}

/** Thẻ giữa khung terminal: biểu tượng, tiêu đề, mô tả, rồi nút hoặc form. */
function TerminalPanel({
  icon,
  title,
  description,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-terminal-border bg-terminal-surface p-5 text-terminal-foreground shadow-2xl"
    >
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-terminal-muted [&_svg]:size-5">
            {icon}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <p className="text-sm text-terminal-muted">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Dải báo dưới thanh trên. */
function TerminalBanner({ tone, children }: { tone: 'warning' | 'error'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'shrink-0 border-b px-3 py-2 text-sm',
        tone === 'error'
          ? 'border-red-500/30 bg-red-500/10 text-red-200'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-200',
      )}
    >
      {children}
    </div>
  );
}

/** Hàng phím bấm gửi chuỗi vào terminal (điện thoại); không lấy tiêu điểm để bàn phím ảo không cụp. */
function TerminalKeyRow({
  keys,
  onKey,
  label,
}: {
  keys: readonly { label: string; data: string }[];
  onKey: (data: string) => void;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className="flex shrink-0 gap-1.5 overflow-x-auto [scrollbar-width:none] border-t border-terminal-border bg-terminal-surface px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]"
    >
      {keys.map((key) => (
        <Button
          key={key.label}
          type="button"
          variant="outline"
          className="h-10 min-w-11 shrink-0 touch-manipulation border-terminal-border bg-white/5 px-3 font-mono text-sm text-terminal-foreground"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onKey(key.data)}
        >
          {key.label}
        </Button>
      ))}
    </nav>
  );
}

/** Nút trên thanh tối: chữ phụ, sáng lên khi rê. */
const TOOL = 'text-terminal-muted hover:bg-white/5 hover:text-terminal-foreground';

/** Nút về đầu thanh trên; màn hẹp chỉ còn mũi tên (nhãn vẫn đọc được qua `aria-label`). */
function TerminalBackButton({
  label,
  shortLabel,
  onClick,
}: {
  label: string;
  shortLabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      className={cn('shrink-0', TOOL)}
      onClick={onClick}
    >
      <ArrowLeft />
      <span className="hidden md:inline">{shortLabel}</span>
    </Button>
  );
}

interface TerminalSwitcherGroup {
  id: string;
  label: string;
  items: { id: string; title: string; detail?: string; active?: boolean }[];
}

/**
 * Nút tiêu đề: tên mục đang mở kèm dòng phụ; bấm ra danh sách theo nhóm để đổi sang mục khác. Menu nằm trong portal
 * ngoài khung nên tự gắn class `dark`.
 */
function TerminalSwitcher({
  label,
  title,
  detail,
  groups,
  emptyLabel,
  onSelect,
}: {
  /** Nhãn cho trình đọc màn hình của nút. */
  label: string;
  title: string;
  detail?: string;
  groups: readonly TerminalSwitcherGroup[];
  emptyLabel: string;
  onSelect: (groupId: string, itemId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          className="min-w-0 max-w-full justify-start gap-2 px-2 text-terminal-foreground hover:bg-white/5"
        >
          <SquareTerminal className="text-terminal-muted" />
          <span className="truncate font-semibold">{title}</span>
          {detail ? <span className="hidden truncate font-normal text-terminal-muted sm:inline">{detail}</span> : null}
          <ChevronsUpDown className="text-terminal-muted" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="dark max-h-[70dvh] min-w-64 overflow-y-auto">
        {groups.length === 0 ? <DropdownMenuLabel>{emptyLabel}</DropdownMenuLabel> : null}
        {groups.map((group, i) => (
          <DropdownMenuGroup key={group.id}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{group.label}</DropdownMenuLabel>
            {group.items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                aria-current={item.active ? 'page' : undefined}
                onSelect={() => {
                  if (!item.active) onSelect(group.id, item.id);
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.title}</span>
                  {item.detail ? (
                    <span className="truncate font-mono text-xs text-muted-foreground">{item.detail}</span>
                  ) : null}
                </span>
                {item.active ? <Check className="text-emerald-400" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Nhóm A−/cỡ/A+; màn hẹp ẩn con số. */
function TerminalFontControl({
  size,
  label,
  smallerLabel,
  largerLabel,
  canSmaller,
  canLarger,
  onSmaller,
  onLarger,
}: {
  size: number;
  label: string;
  smallerLabel: string;
  largerLabel: string;
  canSmaller: boolean;
  canLarger: boolean;
  onSmaller: () => void;
  onLarger: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: nhóm hai nút cỡ chữ, fieldset kéo theo viền và lề mặc định.
    <div role="group" aria-label={label} className="flex items-center rounded-md border border-terminal-border">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={smallerLabel}
        title={smallerLabel}
        disabled={!canSmaller}
        className={cn('rounded-r-none', TOOL)}
        onClick={onSmaller}
      >
        <Minus />
      </Button>
      <span className="hidden w-9 text-center font-mono text-xs tabular-nums text-terminal-muted sm:inline">
        {size}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={largerLabel}
        title={largerLabel}
        disabled={!canLarger}
        className={cn('rounded-l-none', TOOL)}
        onClick={onLarger}
      >
        <Plus />
      </Button>
    </div>
  );
}

/** Dòng "đang nối" giữa khung. */
function TerminalConnecting({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-terminal-muted">
      <Loader2 className="size-4 motion-safe:animate-spin" />
      {label}
    </p>
  );
}

/** Hàng nút cuối thẻ: màn hẹp xếp dọc, nút chính ở trên. */
function TerminalPanelActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

/** Lỗi ngay dưới ô nhập trong thẻ. */
function TerminalFieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="-mt-2 text-sm text-red-300">
      {children}
    </p>
  );
}

export type { TerminalShellProps, TerminalStatusTone, TerminalSwitcherGroup };
export {
  TerminalBackButton,
  TerminalBanner,
  TerminalConnecting,
  TerminalFieldError,
  TerminalFontControl,
  TerminalKeyRow,
  TerminalPanel,
  TerminalPanelActions,
  TerminalShell,
  TerminalStatus,
  TerminalSwitcher,
};
