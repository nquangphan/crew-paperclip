// crew: tự dựng
import { ChevronRight, Menu } from 'lucide-react';
import * as React from 'react';
import { useT } from '@/i18n';
import { Logo } from '../brand/Logo';
import { cn } from '../cn';
import { Button } from './button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from './sheet';

/** Mốc `md` của Tailwind (48rem): từ đây trở lên sidebar cố định. */
const DESKTOP_QUERY = '(min-width: 48rem)';

interface AppFrameProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  /** Chữ cạnh logo trên thanh trên cùng ở màn hẹp (tên company). */
  mobileTitle?: string;
  /** Ngăn kéo menu ở màn hẹp: truyền cả hai để điều khiển từ ngoài (vd đóng khi đổi route), không thì tự giữ. */
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
}

/**
 * Khung trang trong: từ `md` trở lên sidebar cố định bên trái, nội dung cuộn bên phải. Dưới `md` sidebar ẩn; thanh
 * trên cùng có nút ☰ mở chính nội dung sidebar thành ngăn kéo trượt từ trái (hộp thoại có nền mờ, Escape để đóng,
 * đóng xong focus về nút ☰).
 */
function AppFrame({ sidebar, children, mobileTitle, menuOpen, onMenuOpenChange }: AppFrameProps) {
  const { t } = useT();
  const [innerOpen, setInnerOpen] = React.useState(false);
  const open = menuOpen ?? innerOpen;
  const setOpen = onMenuOpenChange ?? setInnerOpen;
  // Kéo cửa sổ rộng qua `md` khi ngăn kéo đang mở: đóng luôn, không để nền mờ phủ giao diện desktop.
  React.useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia(DESKTOP_QUERY);
    const close = () => {
      if (wide.matches) setOpen(false);
    };
    close();
    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, [open, setOpen]);
  return (
    <div data-slot="app-frame" className="flex h-dvh flex-col bg-background text-foreground md:flex-row">
      <Sheet open={open} onOpenChange={setOpen}>
        <header
          data-slot="app-frame-topbar"
          className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 text-sidebar-foreground md:hidden"
        >
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('nav.openMenu')}>
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <Logo className="h-6 shrink-0" />
          {mobileTitle ? (
            <span className="min-w-0 flex-1 truncate text-(length:--text-compact) font-medium text-muted-foreground">
              {mobileTitle}
            </span>
          ) : null}
        </header>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          data-slot="app-frame-drawer"
          className="w-72 max-w-[85vw] gap-0 bg-sidebar text-sidebar-foreground sm:max-w-72 md:hidden"
        >
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        {sidebar}
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-5">{children}</div>
      </main>
    </div>
  );
}

/** Vùng trên cùng của sidebar (logo, chọn company). */
function SidebarHeader({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 border-b border-sidebar-border p-3">{children}</div>;
}

/** Danh sách link điều hướng, cuộn khi dài. */
function SidebarBody({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label} className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-3 py-2">
      {children}
    </nav>
  );
}

function SidebarFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 border-t border-sidebar-border p-2">{children}</div>;
}

/**
 * Nhóm mục điều hướng như sidebar Paperclip: không có `label` thì là nhóm trơn (đầu thanh), có `label` thì có tiêu đề
 * chữ nhỏ viết hoa, bấm để thu gọn (mặc định mở, nhớ trong phiên). Mũi tên chỉ hiện khi rê chuột hoặc có focus.
 */
function SidebarGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true);
  if (!label) return <div className="flex flex-col gap-0.5">{children}</div>;
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-slot="sidebar-group" className="group/sidebar-group">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-6 w-full items-center gap-1 rounded-md px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="font-mono text-(length:--text-nano) font-medium tracking-widest text-muted-foreground/60 uppercase">
            {label}
          </span>
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 shrink-0 text-muted-foreground/60 opacity-0 transition-all group-hover/sidebar-group:opacity-100 group-focus-within/sidebar-group:opacity-100',
              open && 'rotate-90',
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-0.5 flex flex-col gap-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Ô vuông nhỏ màu của project (đứng thay icon ở mục project trong sidebar). */
function SidebarProjectTile({ color }: { color?: string | null }) {
  return (
    <span
      aria-hidden
      data-slot="sidebar-project-tile"
      className="size-4 shrink-0 rounded-[4px] bg-muted-foreground/40"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

interface SidebarItemProps {
  href: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number | null;
  active?: boolean;
  /** Mục con (vd project gắn sao dưới "Project"): lùi vào một bậc. */
  nested?: boolean;
  /** Click thường chạy onNavigate (SPA), vẫn giữ link thật để mở tab mới. */
  onNavigate?: () => void;
  /** Link ra ngoài: mở tab mới, không dùng onNavigate. */
  external?: boolean;
}

function SidebarItem({ href, label, icon, badge, active, nested, onNavigate, external }: SidebarItemProps) {
  return (
    <a
      href={href}
      data-slot="sidebar-item"
      aria-current={active ? 'page' : undefined}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={cn(
        'mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-(length:--text-compact) font-medium text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0',
        nested && 'pl-6',
        active && 'bg-sidebar-accent text-sidebar-accent-foreground',
      )}
      onClick={(e) => {
        if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onNavigate();
      }}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="rounded-full bg-primary px-1.5 text-(length:--text-nano) font-medium text-primary-foreground tabular-nums">
          {badge}
        </span>
      ) : null}
    </a>
  );
}

/** Trang đứng riêng giữa màn hình (đăng nhập, duyệt CLI, 404 ngoài company). */
function CenteredPage({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-slot="centered-page"
      className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground"
    >
      <div className="flex w-full max-w-md flex-col gap-4">{children}</div>
    </div>
  );
}

/** Phím tắt hiển thị (⌘K). */
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

export type { AppFrameProps, SidebarItemProps };
export {
  AppFrame,
  CenteredPage,
  Kbd,
  SidebarBody,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarItem,
  SidebarProjectTile,
};
