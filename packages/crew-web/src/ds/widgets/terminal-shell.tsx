// crew: tự dựng
import { Check, ChevronDown, Loader2, Minus, Monitor, Plus, Power, RefreshCw, SquareTerminal, X } from 'lucide-react';
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

interface TerminalScreenProps {
  /** Tab không được chọn: giấu (không gỡ) để phiên giữ kết nối. */
  hidden?: boolean;
  /** Dải báo trên khung (lỗi phiên, dán quá lớn). */
  banner?: React.ReactNode;
  /** Phủ giữa khung terminal (đang khoá, đang nối, đã ngắt); màn hình cũ vẫn mờ phía sau. */
  overlay?: React.ReactNode;
  /** Khung xterm gắn vào; padding để chữ không dính mép. */
  screenRef: React.Ref<HTMLDivElement>;
  /** Dưới khung terminal (hàng phím phụ trên điện thoại). */
  footer?: React.ReactNode;
}

/**
 * Thân một phiên terminal trong khung nổi: khung xterm giãn hết chỗ còn lại, thông báo phủ giữa khung thay vì đẩy khung
 * xuống. Luôn nền tối (token `--terminal-*`).
 */
function TerminalScreen({ hidden, banner, overlay, screenRef, footer }: TerminalScreenProps) {
  return (
    <div data-slot="terminal-screen" hidden={hidden} className="flex min-h-0 flex-1 flex-col">
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

interface TerminalPickerGroup {
  id: string;
  label: string;
  items: { id: string; title: string; detail?: string; active?: boolean }[];
}

/** Nút "+" mở menu chọn dự án theo nhóm máy; mục đã mở có dấu tick. Menu nằm trong portal nên tự gắn class `dark`. */
function TerminalPickerMenu({
  label,
  groups,
  emptyLabel,
  onSelect,
}: {
  label: string;
  groups: readonly TerminalPickerGroup[];
  emptyLabel: string;
  onSelect: (groupId: string, itemId: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          className={cn('shrink-0', TOOL)}
        >
          <Plus />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="dark max-h-[70dvh] min-w-64 overflow-y-auto">
        {groups.length === 0 ? <DropdownMenuLabel>{emptyLabel}</DropdownMenuLabel> : null}
        {groups.map((group, i) => (
          <DropdownMenuGroup key={group.id}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">{group.label}</DropdownMenuLabel>
            {group.items.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => onSelect(group.id, item.id)}>
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

/** Danh sách chọn dự án ngay trong khung khi chưa mở terminal nào. */
function TerminalPickerList({
  title,
  description,
  groups,
  emptyLabel,
  onSelect,
}: {
  title: string;
  description: string;
  groups: readonly TerminalPickerGroup[];
  emptyLabel: string;
  onSelect: (groupId: string, itemId: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex flex-col gap-1 text-center">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-sm text-terminal-muted">{description}</p>
        </div>
        {groups.length === 0 ? <p className="text-center text-sm text-terminal-muted">{emptyLabel}</p> : null}
        {groups.map((group) => (
          <section key={group.id} aria-label={group.label} className="flex flex-col gap-1">
            <h3 className="px-1 text-xs font-medium text-terminal-muted">{group.label}</h3>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(group.id, item.id)}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-terminal-border bg-terminal-surface px-3 py-2 text-left transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <SquareTerminal className="size-4 shrink-0 text-terminal-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{item.title}</span>
                  {item.detail ? (
                    <span className="truncate font-mono text-xs text-terminal-muted">{item.detail}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Thanh trên của khung nổi: tên, dòng tổng (bao nhiêu terminal, bao nhiêu đang nối), nút bên phải. */
function TerminalDockHeader({
  title,
  summary,
  actions,
}: {
  title: string;
  summary?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-terminal-border bg-terminal-surface px-3">
      <SquareTerminal className="size-4 shrink-0 text-terminal-muted" />
      <h2 className="text-sm font-semibold">{title}</h2>
      {summary ? (
        <span role="status" className="min-w-0 truncate text-xs text-terminal-muted">
          {summary}
        </span>
      ) : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}

/** Một tab terminal: tên dự án, máy và trạng thái kết nối của riêng tab đó, nút đóng. */
interface TerminalTabItem {
  id: string;
  title: string;
  detail?: string;
  tone: TerminalStatusTone;
  statusLabel: string;
}

/** Dải tab các terminal đang mở, kèm nút "+" ở cuối; cuộn ngang khi chật. */
function TerminalTabs({
  label,
  tabs,
  activeId,
  closeLabel,
  onSelect,
  onClose,
  add,
}: {
  label: string;
  tabs: readonly TerminalTabItem[];
  activeId: string | null;
  /** Nhãn nút đóng, nhận tên tab. */
  closeLabel: (title: string) => string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Nút "+" (`TerminalPickerMenu`). */
  add?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-stretch border-b border-terminal-border bg-terminal">
      <div role="tablist" aria-label={label} className="flex min-w-0 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex max-w-60 shrink-0 items-center border-r border-terminal-border',
                active ? 'bg-terminal-surface' : 'hover:bg-white/5',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(tab.id)}
                className={cn(
                  'flex min-h-11 min-w-0 cursor-pointer flex-col justify-center py-1.5 pr-1 pl-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                  active ? 'text-terminal-foreground' : 'text-terminal-muted',
                )}
              >
                <span className="truncate text-sm font-medium">{tab.title}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-terminal-muted">
                  <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[tab.tone])} />
                  <span className="truncate">{[tab.detail, tab.statusLabel].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={closeLabel(tab.title)}
                title={closeLabel(tab.title)}
                className={cn('mr-1.5', TOOL)}
                onClick={() => onClose(tab.id)}
              >
                <X />
              </Button>
            </div>
          );
        })}
      </div>
      {add ? <div className="flex shrink-0 items-center px-1.5">{add}</div> : null}
    </div>
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

/** Nút ẩn khung nổi (thanh trên của terminal). */
function TerminalHideButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      className={TOOL}
      onClick={onClick}
    >
      <ChevronDown />
    </Button>
  );
}

/**
 * Nút tròn treo góc dưới bên phải để ẩn hiện khung terminal, như nút mở chat. Có terminal đang mở thì gắn huy hiệu
 * `đang nối/đã mở` (xanh khi có ít nhất một phiên đang nối).
 */
function TerminalLauncher({
  label,
  open,
  opened,
  connected,
  controls,
  onToggle,
}: {
  label: string;
  open: boolean;
  /** Số terminal đang mở; 0 thì không có huy hiệu. */
  opened: number;
  /** Số terminal đang nối. */
  connected: number;
  /** id của khung nổi, cho `aria-controls`. */
  controls: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-slot="terminal-launcher"
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        'fixed right-4 bottom-4 z-50 flex size-14 cursor-pointer items-center justify-center rounded-full border border-terminal-border bg-terminal text-terminal-foreground shadow-xl transition-transform duration-200 hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95 motion-reduce:transition-none [&_svg]:size-6',
        open && 'max-md:hidden',
      )}
    >
      {open ? <ChevronDown /> : <SquareTerminal />}
      {opened > 0 ? (
        <span
          aria-hidden
          className={cn(
            'absolute -top-1 -right-1 min-w-6 rounded-full border-2 border-background px-1.5 text-center font-mono text-[11px] leading-4 font-semibold tabular-nums',
            connected > 0 ? 'bg-emerald-500 text-white' : 'bg-zinc-600 text-white',
          )}
        >
          {connected}/{opened}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Khung nổi chứa terminal, mọc ở góc dưới bên phải trên nút tròn; điện thoại thì phủ cả màn hình. Ẩn bằng `hidden`
 * chứ không gỡ, để phiên terminal giữ nguyên khi ẩn đi rồi mở lại.
 */
function TerminalDockPanel({
  id,
  label,
  open,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      hidden={!open}
      data-slot="terminal-dock"
      className="dark fixed inset-0 z-50 flex flex-col overflow-hidden bg-terminal text-terminal-foreground md:inset-auto md:right-4 md:bottom-22 md:h-[min(36rem,calc(100dvh-7rem))] md:w-[min(56rem,calc(100vw-2rem))] md:rounded-xl md:border md:border-terminal-border md:shadow-2xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
    >
      {children}
    </section>
  );
}

/** Chữ giữa khung nổi khi đang tải hay tải lỗi. */
function TerminalDockEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-terminal-muted">
      {children}
    </div>
  );
}

/** Vùng thân khung nổi giãn hết chỗ còn lại; `hidden` giấu chứ không gỡ (phiên bên trong vẫn nối). */
function TerminalPane({ hidden, children }: { hidden?: boolean; children: React.ReactNode }) {
  return (
    <div hidden={hidden} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}

/** Nút bật/tắt một chế độ xem trên thanh trên (ví dụ "Phiên trên máy"), có số đếm cạnh biểu tượng. */
function TerminalViewToggle({
  label,
  pressed,
  count,
  onClick,
}: {
  label: string;
  pressed: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn('gap-1.5 px-2', TOOL, pressed && 'bg-white/10 text-terminal-foreground')}
      onClick={onClick}
    >
      <Monitor />
      {count !== undefined ? <span className="font-mono text-xs tabular-nums">{count}</span> : null}
    </Button>
  );
}

interface TerminalMachineSessionGroup {
  id: string;
  label: string;
  /** Không hỏi được máy: hiện `errorLabel` thay cho danh sách. */
  ok: boolean;
  items: {
    id: string;
    title: string;
    detail?: string;
    /** Có cửa sổ đang xem (chấm xanh) hay không (chấm xám). */
    viewed: boolean;
    viewersLabel: string;
    activityLabel: string;
    activityTitle?: string;
    /** Đã có tab ở trình duyệt này. */
    openHere: boolean;
    /** Mở được (khóa còn khớp dự án sẵn sàng). */
    canOpen: boolean;
    /** Đang tắt phiên này. */
    killing?: boolean;
  }[];
}

/**
 * Danh sách phiên tmux đang sống trên từng máy, kể cả phiên mở từ nơi khác: người đang xem, lần hoạt động cuối, nút mở
 * tab cho phiên đó.
 */
function TerminalMachineSessions({
  title,
  description,
  groups,
  emptyLabel,
  errorLabel,
  openLabel,
  openHereLabel,
  refreshLabel,
  updatedLabel,
  refreshing,
  onRefresh,
  onOpen,
  killLabel,
  onKill,
  notice,
}: {
  title: string;
  description: string;
  groups: readonly TerminalMachineSessionGroup[];
  emptyLabel: string;
  errorLabel: string;
  openLabel: string;
  openHereLabel: string;
  refreshLabel: string;
  updatedLabel?: string;
  refreshing: boolean;
  onRefresh: () => void;
  onOpen: (groupId: string, itemId: string) => void;
  /** Nhãn nút tắt phiên, nhận tên phiên. */
  killLabel: (title: string) => string;
  onKill: (groupId: string, itemId: string) => void;
  /** Dải báo trên danh sách (lỗi tắt phiên). */
  notice?: React.ReactNode;
}) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="text-sm text-terminal-muted">{description}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={refreshLabel}
            title={refreshLabel}
            disabled={refreshing}
            className={cn('shrink-0 gap-1.5', TOOL)}
            onClick={onRefresh}
          >
            <RefreshCw className={cn(refreshing && 'motion-safe:animate-spin')} />
            {updatedLabel ? <span className="text-xs">{updatedLabel}</span> : null}
          </Button>
        </div>
        {notice}
        {total === 0 && groups.every((g) => g.ok) ? (
          <p className="text-center text-sm text-terminal-muted">{emptyLabel}</p>
        ) : null}
        {groups.map((group) => (
          <section key={group.id} aria-label={group.label} className="flex flex-col gap-1">
            <h3 className="px-1 text-xs font-medium text-terminal-muted">{group.label}</h3>
            {!group.ok ? <p className="px-1 text-sm text-amber-200">{errorLabel}</p> : null}
            {group.items.map((item) => (
              <div
                key={item.id}
                className="flex min-h-12 items-center gap-3 rounded-lg border border-terminal-border bg-terminal-surface px-3 py-2"
              >
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', item.viewed ? 'bg-emerald-400' : 'bg-zinc-500')}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{item.title}</span>
                  <span className="truncate text-xs text-terminal-muted">
                    {[item.detail, item.viewersLabel].filter(Boolean).join(' · ')}
                    {' · '}
                    <time title={item.activityTitle}>{item.activityLabel}</time>
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={killLabel(item.title)}
                  title={killLabel(item.title)}
                  disabled={item.killing}
                  className="shrink-0 text-terminal-muted hover:bg-red-500/10 hover:text-red-300"
                  onClick={() => onKill(group.id, item.id)}
                >
                  {item.killing ? <Loader2 className="motion-safe:animate-spin" /> : <Power />}
                </Button>
                {item.openHere ? (
                  <span className="shrink-0 text-xs text-emerald-300">{openHereLabel}</span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!item.canOpen}
                    className="shrink-0 border-terminal-border bg-transparent text-terminal-foreground hover:bg-white/5"
                    onClick={() => onOpen(group.id, item.id)}
                  >
                    {openLabel}
                  </Button>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export type {
  TerminalMachineSessionGroup,
  TerminalPickerGroup,
  TerminalScreenProps,
  TerminalStatusTone,
  TerminalTabItem,
};
export {
  TerminalBanner,
  TerminalConnecting,
  TerminalDockEmpty,
  TerminalDockHeader,
  TerminalDockPanel,
  TerminalFieldError,
  TerminalFontControl,
  TerminalHideButton,
  TerminalKeyRow,
  TerminalLauncher,
  TerminalMachineSessions,
  TerminalPane,
  TerminalPanel,
  TerminalPanelActions,
  TerminalPickerList,
  TerminalPickerMenu,
  TerminalScreen,
  TerminalTabs,
  TerminalViewToggle,
};
