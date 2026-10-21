// clone: ui/src/components/{IssuesList,IssueRow,IssueGroupHeader,IssueColumns,IssueFiltersPopover,CollectionToolbar}.tsx @ v2026.1005.0 (rút gọn cho Crew)
// Bố cục danh sách task của Paperclip (bản streamlined mặc định): thanh công cụ một hàng (nút tạo, ô tìm, các nút
// biểu tượng Cột/Lọc/Sắp xếp/Nhóm bên phải), nhóm có tiêu đề viết hoa thu gọn được, dòng task không kẻ (glyph trạng
// thái, tiêu đề, cột phụ, mã, thời gian), vạch cây cho task con và vạch ngày Hôm nay/Hôm qua. Bỏ mọi control sửa tại
// dòng (đổi trạng thái, người làm) và lưu view trong localStorage; chữ do màn hình truyền vào. Bảng Kanban nằm ở
// `kanban-board.tsx`, nút chuyển Danh sách/Bảng ở đây.
import { ArrowUpDown, Check, ChevronRight, Columns3, Filter, Layers, List, Search, SquareKanban } from 'lucide-react';
import * as React from 'react';
import { cn } from '../cn';
import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/dropdown-menu';
import { Input } from '../components/input';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover';
import { NavAnchor } from './nav-anchor';
import { StatusGlyph } from './status-glyph';

// ---------------------------------------------------------------------------------------------------------------
// Khung trang và thanh công cụ (CollectionToolbar).

/** Tiêu đề trang danh sách, cỡ chữ như breadcrumb "Tasks" trên thanh đầu của Paperclip. */
function CollectionTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-sm font-semibold text-foreground">{children}</h1>;
}

interface CollectionToolbarProps {
  ariaLabel: string;
  /** Bên trái ô tìm: nút tạo mới. */
  context?: React.ReactNode;
  search?: React.ReactNode;
  /** Bên phải: chip, nút biểu tượng. */
  controls?: React.ReactNode;
}

function CollectionToolbar({ ariaLabel, context, search, controls }: CollectionToolbarProps) {
  return (
    <div data-slot="collection-toolbar" role="toolbar" aria-label={ariaLabel} className="flex flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        {context ? <div className="min-w-0 shrink-0">{context}</div> : null}
        {search ? <div className="min-w-0 flex-1">{search}</div> : null}
        {controls ? (
          <div
            data-slot="collection-toolbar-controls"
            className="flex min-w-0 flex-wrap items-center gap-1 sm:ml-auto sm:flex-nowrap"
          >
            {controls}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ToolbarSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** Ô tìm có kính lúp, rộng cố định trên desktop như IssueSearchInput. Enter/Esc bỏ focus. */
function ToolbarSearch({ value, onChange, placeholder }: ToolbarSearchProps) {
  return (
    <div className="relative w-full sm:w-64 md:w-80">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 pl-7 text-xs sm:text-sm"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' || (e.key === 'Escape' && e.currentTarget.value === '')) e.currentTarget.blur();
        }}
      />
    </div>
  );
}

type ToolbarIconButtonProps = React.ComponentProps<typeof Button> & {
  label: string;
  active?: boolean;
  /** Số bộ lọc đang bật, vẽ chấm số ở góc. */
  badge?: number;
};

/** Nút biểu tượng 32px viền mảnh của thanh công cụ (Cột, Lọc, Sắp xếp, Nhóm). */
const ToolbarIconButton = React.forwardRef<HTMLButtonElement, ToolbarIconButtonProps>(function ToolbarIconButton(
  { label, active = false, badge = 0, children, className, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      size="icon"
      title={label}
      aria-label={label}
      className={cn('relative size-8 shrink-0 [&_svg]:size-3.5', active && 'bg-accent', className)}
      {...props}
    >
      {children}
      {badge > 0 ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-primary text-(length:--text-nano) font-bold text-primary-foreground"
        >
          {badge}
        </span>
      ) : null}
    </Button>
  );
});

type ViewMode = 'list' | 'board';

interface ToolbarViewToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  /** Nhãn nhóm nút và từng nút. */
  label: string;
  listLabel: string;
  boardLabel: string;
}

/** Cặp nút Danh sách / Bảng dính liền nhau, đứng đầu nhóm nút bên phải như IssuesList. */
function ToolbarViewToggle({ value, onChange, label, listLabel, boardLabel }: ToolbarViewToggleProps) {
  const options = [
    { mode: 'list' as const, text: listLabel, Icon: List },
    { mode: 'board' as const, text: boardLabel, Icon: SquareKanban },
  ];
  return (
    // biome-ignore lint/a11y/useSemanticElements: cặp nút dính liền như Paperclip, fieldset kéo theo viền và lề mặc định.
    <div
      role="group"
      aria-label={label}
      data-slot="view-toggle"
      className="mr-1 flex shrink-0 items-center overflow-hidden rounded-md border border-border"
    >
      {options.map(({ mode, text, Icon }) => (
        <button
          key={mode}
          type="button"
          title={text}
          aria-label={text}
          aria-pressed={value === mode}
          className={cn(
            'flex size-8 items-center justify-center transition-colors',
            value === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onChange(mode)}
        >
          <Icon aria-hidden className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Bảng chọn của thanh công cụ.

interface ChoiceOption {
  value: string;
  label: string;
}

interface ToolbarChoiceMenuProps {
  kind: 'sort' | 'group';
  label: string;
  options: ChoiceOption[];
  value: string;
  onSelect: (value: string) => void;
}

/** Popover Sắp xếp / Nhóm: danh sách lựa chọn, mục đang chọn có dấu tích. */
function ToolbarChoiceMenu({ kind, label, options, value, onSelect }: ToolbarChoiceMenuProps) {
  const [open, setOpen] = React.useState(false);
  const Icon = kind === 'sort' ? ArrowUpDown : Layers;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ToolbarIconButton label={label}>
          <Icon aria-hidden />
        </ToolbarIconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-0">
        <div role="menu" aria-label={label} className="flex flex-col gap-0.5 p-2">
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={cn(
                  'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm',
                  selected ? 'bg-accent/50 text-foreground' : 'text-muted-foreground hover:bg-accent/50',
                )}
                onClick={() => {
                  onSelect(o.value);
                  setOpen(false);
                }}
              >
                <span>{o.label}</span>
                {selected ? <Check aria-hidden className="size-3.5" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface FilterOption {
  value: string;
  label: string;
  /** Glyph trạng thái đứng trước nhãn. */
  status?: string;
}

interface FilterSection {
  id: string;
  label: string;
  options: FilterOption[];
  /** Giá trị đang chọn; rỗng là không lọc. */
  value: string;
  onChange: (value: string) => void;
}

interface ToolbarFilterMenuProps {
  /** Nhãn nút (gồm số bộ lọc đang bật). */
  label: string;
  title: string;
  clearLabel: string;
  activeCount: number;
  onClear: () => void;
  sections: FilterSection[];
}

/** Popover Lọc (IssueFiltersPopover): tiêu đề + Xóa, các cột lựa chọn có ô tích. Mỗi mục chọn một giá trị. */
function ToolbarFilterMenu({ label, title, clearLabel, activeCount, onClear, sections }: ToolbarFilterMenuProps) {
  const baseId = React.useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarIconButton label={label} badge={activeCount}>
          <Filter aria-hidden />
        </ToolbarIconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={title}
        className="max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-0"
      >
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{title}</span>
            {activeCount > 0 ? (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onClear}>
                {clearLabel}
              </button>
            ) : null}
          </div>
          <div className="border-t border-border" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {sections.map((section) => (
              <fieldset key={section.id} className="flex min-w-0 flex-col gap-1">
                <legend className="mb-1 text-xs text-muted-foreground">{section.label}</legend>
                <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                  {section.options.map((o) => {
                    const id = `${baseId}-${section.id}-${o.value}`;
                    const checked = section.value === o.value;
                    return (
                      <label
                        key={o.value}
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-accent/50"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={() => section.onChange(checked ? '' : o.value)}
                        />
                        {o.status ? <StatusGlyph status={o.status} size="sm" /> : null}
                        <span className="min-w-0 truncate text-sm">{o.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface ColumnOption {
  id: string;
  label: string;
  description: string;
}

interface ToolbarColumnsMenuProps {
  label: string;
  /** Hai dòng đầu menu: dòng nhỏ viết hoa và dòng tiêu đề. */
  eyebrow: string;
  title: string;
  columns: ColumnOption[];
  isVisible: (id: string) => boolean;
  onToggle: (id: string, visible: boolean) => void;
  resetLabel: string;
  onReset: () => void;
}

/** Menu Cột (IssueColumnPicker): mỗi cột một ô tích có mô tả, cuối là Đặt lại mặc định. */
function ToolbarColumnsMenu({
  label,
  eyebrow,
  title,
  columns,
  isVisible,
  onToggle,
  resetLabel,
  onReset,
}: ToolbarColumnsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarIconButton label={label}>
          <Columns3 aria-hidden />
        </ToolbarIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-xl border-border/70 p-1.5 shadow-xl shadow-black/10">
        <DropdownMenuLabel className="px-2 pt-1.5 pb-1">
          <span className="flex flex-col gap-1">
            <span className="text-(length:--text-nano) font-semibold tracking-wider text-muted-foreground uppercase">
              {eyebrow}
            </span>
            <span className="text-sm font-medium text-foreground">{title}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={isVisible(c.id)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => onToggle(c.id, checked === true)}
            className="items-start rounded-lg px-3 py-2.5 pl-8"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{c.label}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{c.description}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset} className="rounded-lg px-3 py-2 text-sm">
          {resetLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Nhóm và vạch ngày.

interface IssueGroupProps {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  /** `data-testid` của tiêu đề nhóm. */
  headingTestId?: string;
  children: React.ReactNode;
}

/** Nhóm (IssueGroupHeader): nút mũi tên + nhãn viết hoa đậm; thu gọn thì ẩn nội dung. */
function IssueGroup({ label, collapsed, onToggle, headingTestId, children }: IssueGroupProps) {
  return (
    <section data-slot="issue-group" aria-label={label}>
      <div className="flex items-center rounded-lg py-1.5 pr-3 pl-1 hover:bg-accent/50 sm:pr-4">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <span className="inline-flex w-4 shrink-0 items-center justify-center sm:ml-3">
            <ChevronRight
              aria-hidden
              className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')}
            />
          </span>
          <span data-testid={headingTestId} className="truncate text-sm font-semibold tracking-wide uppercase">
            {label}
          </span>
        </button>
      </div>
      {collapsed ? null : children}
    </section>
  );
}

/** Vạch ngày giữa các dòng (Hôm nay / Hôm qua / Trước đó). */
function DateSeparator({ label }: { label: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: vạch có nhãn chữ ở giữa như Paperclip, <hr> không chứa được nội dung.
    <div
      role="separator"
      aria-label={label}
      data-slot="date-separator"
      className="flex items-center gap-3 px-3 py-1.5 sm:pr-4 sm:pl-0"
    >
      <span aria-hidden className="h-px min-w-0 flex-1 bg-border/80" />
      <span
        aria-hidden
        className="shrink-0 text-(length:--text-nano) font-medium tracking-wider text-muted-foreground/70 uppercase"
      >
        {label}
      </span>
      <span aria-hidden className="h-px min-w-0 flex-1 bg-border/80" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dòng task (IssueRow presentation="task").

interface IssueListRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: string;
  /** Trang đầy đủ của task (Cmd/Ctrl+click mở tab mới); click thường gọi `onOpen`. */
  href: string;
  onOpen: () => void;
  status: string;
  statusLabel: string;
  /** Số cấp cha: vẽ bấy nhiêu vạch cây. */
  depth?: number;
  /** Dòng có task con và đang mở: vạch cây cấp trong cùng chừa chỗ cho mũi tên. */
  chevronInGuide?: boolean;
  /** Mũi tên mở/thu task con, hoặc `<TreeSpacer/>`. */
  leading?: React.ReactNode;
  titleSuffix?: React.ReactNode;
  /** Cột phụ bên phải (giai đoạn, người làm, project…). */
  metadata?: React.ReactNode;
  identifier?: string | null;
  time?: { text: string; title?: string } | null;
}

function IssueListRow({
  title,
  href,
  onOpen,
  status,
  statusLabel,
  depth = 0,
  chevronInGuide = false,
  leading,
  titleSuffix,
  metadata,
  identifier,
  time,
  className,
  ...rest
}: IssueListRowProps) {
  return (
    <div
      data-slot="task-row"
      className={cn(
        'group relative flex min-w-0 items-start gap-2 rounded-lg py-2.5 pr-2 pl-2 text-sm text-inherit hover:bg-accent/50 sm:items-center sm:py-2 sm:pl-4',
        '[&_button]:relative [&_button]:z-10',
        className,
      )}
      {...rest}
    >
      <NavAnchor
        href={href}
        onOpen={onOpen}
        aria-label={title}
        className="absolute inset-0 rounded-lg text-inherit no-underline focus-visible:z-10 focus-visible:ring-(length:--rad-3) focus-visible:ring-ring focus-visible:outline-none"
      />
      <span data-slot="task-row-leading" className="flex shrink-0 items-center gap-1 self-stretch">
        {Array.from({ length: depth }, (_, i) => i).map((level) => {
          const gap = chevronInGuide && level === depth - 1;
          return (
            <span
              key={level}
              aria-hidden
              data-slot="task-row-tree-guide"
              className="relative block w-4 shrink-0 self-stretch"
            >
              <span className="absolute -inset-y-3 left-7 w-px bg-background">
                {gap ? (
                  <span className="absolute inset-0 flex flex-col">
                    <span className="flex-1 bg-border" />
                    <span className="h-3.5 shrink-0" />
                    <span className="flex-1 bg-border" />
                  </span>
                ) : (
                  <span className="absolute inset-0 bg-border" />
                )}
              </span>
            </span>
          );
        })}
        {leading}
        <StatusGlyph status={status} title={statusLabel} />
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 sm:items-center">
        <span data-slot="task-row-title" className="line-clamp-2 min-w-0 text-sm sm:line-clamp-none sm:truncate">
          {title}
          {titleSuffix}
        </span>
        {time ? (
          <span className="ml-auto shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground sm:hidden">
            {time.text}
          </span>
        ) : null}
      </span>
      <span data-slot="task-row-trailing" className="ml-auto hidden min-w-0 shrink-0 items-center gap-2 sm:flex">
        {metadata}
        {identifier ? (
          <span
            data-slot="task-row-identifier"
            className="w-20 shrink-0 text-right font-mono text-xs text-muted-foreground"
          >
            {identifier}
          </span>
        ) : null}
        {time ? (
          <span
            data-slot="task-row-timestamp"
            title={time.title}
            className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground"
          >
            {time.text}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Mũi tên mở/thu task con, cùng cột với mũi tên của tiêu đề nhóm. */
function TreeToggle({ expanded, label, onToggle }: { expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      className="inline-flex size-4 shrink-0 items-center justify-center self-center text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <ChevronRight aria-hidden className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
    </button>
  );
}

/** Chỗ trống bằng mũi tên cho dòng không có task con. */
function TreeSpacer() {
  return <span aria-hidden data-slot="task-row-disclosure-spacer" className="size-4 shrink-0 self-center" />;
}

/** Ghi chú xám sau tiêu đề ("(2 yêu cầu con)"). */
function RowNote({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 text-xs text-muted-foreground">{children}</span>;
}

const CELL_WIDTH = { sm: 'w-24', md: 'w-28', lg: 'w-32' } as const;

/** Ô cột phụ bên phải dòng, rộng cố định để các dòng thẳng cột. */
function RowCell({
  size = 'md',
  title,
  children,
}: {
  size?: keyof typeof CELL_WIDTH;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      data-slot="task-row-cell"
      title={title}
      className={cn('flex min-w-0 shrink-0 items-center truncate text-xs text-muted-foreground', CELL_WIDTH[size])}
    >
      {children}
    </span>
  );
}

/** Chấm xanh nhấp nháy "Đang chạy" của task có run sống. */
function LiveBadge({ label }: { label: string }) {
  return (
    <span
      data-slot="live-badge"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-violet-500/10 px-2 py-0.5"
    >
      <span aria-hidden className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-pulse rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-violet-500" />
      </span>
      <span className="text-(length:--text-micro) font-medium text-violet-600 dark:text-violet-400">{label}</span>
    </span>
  );
}

/** Nhãn của task: chấm màu + tên. */
function LabelPill({ name, color }: { name: string; color?: string | null }) {
  return (
    <span data-slot="label-pill" className="inline-flex min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color || 'currentColor' }} />
      <span className="truncate text-(length:--text-micro)">{name}</span>
    </span>
  );
}

/** Mục danh sách không có link phủ (mục chờ duyệt): cùng nền và lề với dòng task, nội dung tự dựng. Đặt trong `<ul>`. */
function ListItemRow({ className, ...props }: React.LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li
      data-slot="list-item-row"
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg py-2.5 pr-2 pl-2 text-sm hover:bg-accent/50 sm:py-2 sm:pl-4',
        className,
      )}
      {...props}
    />
  );
}

export type {
  ChoiceOption,
  CollectionToolbarProps,
  ColumnOption,
  FilterOption,
  FilterSection,
  IssueGroupProps,
  IssueListRowProps,
  ToolbarChoiceMenuProps,
  ToolbarColumnsMenuProps,
  ToolbarFilterMenuProps,
  ToolbarSearchProps,
  ToolbarViewToggleProps,
  ViewMode,
};
export {
  CollectionTitle,
  CollectionToolbar,
  DateSeparator,
  IssueGroup,
  IssueListRow,
  LabelPill,
  ListItemRow,
  LiveBadge,
  RowCell,
  RowNote,
  ToolbarChoiceMenu,
  ToolbarColumnsMenu,
  ToolbarFilterMenu,
  ToolbarIconButton,
  ToolbarSearch,
  ToolbarViewToggle,
  TreeSpacer,
  TreeToggle,
};
