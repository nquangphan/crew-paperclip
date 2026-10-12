// crew: tự dựng
// Cây trang tài liệu (thư mục thu gọn/mở được, trang đang xem tô đậm) và danh sách trang phẳng (kết quả tìm). Mỗi trang
// là link thật (`hrefOf`) để chép link, mở tab mới được; click thường gọi `onOpen` để mở trong trang.
import { useEffect, useState } from 'react';
import { cn } from '../cn';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from '../icons';
import { NavAnchor } from './nav-anchor';

interface DocTreeNode {
  path: string;
  name: string;
  type: 'directory' | 'page';
  title?: string;
  children: DocTreeNode[];
}

interface DocLinkProps {
  current: string | null;
  hrefOf: (path: string) => string;
  onOpen: (path: string) => void;
}

const ROW =
  'flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground';
const ACTIVE = 'bg-accent font-medium text-accent-foreground hover:bg-accent';

/** Các thư mục chứa `path` (`a`, `a/b` cho `a/b/c.md`). */
const ancestorsOf = (path: string): string[] => {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
};

function PageRow({ node, current, hrefOf, onOpen }: { node: DocTreeNode } & DocLinkProps) {
  const active = node.path === current;
  return (
    <NavAnchor
      href={hrefOf(node.path)}
      onOpen={() => onOpen(node.path)}
      aria-current={active ? 'page' : undefined}
      title={node.path}
      className={cn(ROW, active && ACTIVE)}
    >
      <span aria-hidden className="size-3.5 shrink-0" />
      <FileText aria-hidden className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0 truncate">{node.title || node.name}</span>
    </NavAnchor>
  );
}

function Branch({
  nodes,
  collapsed,
  toggle,
  nested,
  ...links
}: {
  nodes: DocTreeNode[];
  collapsed: ReadonlySet<string>;
  toggle: (path: string) => void;
  nested: boolean;
} & DocLinkProps) {
  return (
    <ul className={cn('flex flex-col gap-px', nested && 'ml-3.5 border-l border-border pl-1.5')}>
      {nodes.map((node) => {
        if (node.type === 'page') {
          return (
            <li key={node.path}>
              <PageRow node={node} {...links} />
            </li>
          );
        }
        const open = !collapsed.has(node.path);
        const Chevron = open ? ChevronDown : ChevronRight;
        const Icon = open ? FolderOpen : Folder;
        return (
          <li key={node.path}>
            <button
              type="button"
              aria-expanded={open}
              title={node.path}
              onClick={() => toggle(node.path)}
              className={cn(ROW, 'font-medium text-foreground')}
            >
              <Chevron aria-hidden className="size-3.5 shrink-0" />
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{node.name}</span>
            </button>
            {open ? <Branch nodes={node.children} collapsed={collapsed} toggle={toggle} nested {...links} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Cây trang. Thư mục mở sẵn; bấm để thu gọn. Mở một trang nằm trong thư mục đang thu gọn (link trong bài, tìm kiếm)
 * thì thư mục đó tự mở lại. Màn hẹp: cây cao tối đa nửa màn hình và cuộn riêng để bài đọc không bị đẩy quá xa.
 */
function DocTree({ label, nodes, ...links }: { label: string; nodes: DocTreeNode[] } & DocLinkProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const { current } = links;

  useEffect(() => {
    if (!current) return;
    setCollapsed((prev) => {
      const hidden = ancestorsOf(current).filter((dir) => prev.has(dir));
      if (!hidden.length) return prev;
      const next = new Set(prev);
      for (const dir of hidden) next.delete(dir);
      return next;
    });
  }, [current]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <nav
      aria-label={label}
      data-slot="doc-tree"
      className="max-h-[45vh] overflow-y-auto lg:max-h-none lg:overflow-visible"
    >
      <Branch nodes={nodes} collapsed={collapsed} toggle={toggle} nested={false} {...links} />
    </nav>
  );
}

/** Danh sách trang phẳng (kết quả tìm): tiêu đề và đường dẫn file. */
function DocPageList({
  label,
  items,
  ...links
}: { label: string; items: readonly { path: string; title: string }[] } & DocLinkProps) {
  return (
    <ul aria-label={label} data-slot="doc-page-list" className="flex flex-col gap-px">
      {items.map((item) => {
        const active = item.path === links.current;
        return (
          <li key={item.path}>
            <NavAnchor
              href={links.hrefOf(item.path)}
              onOpen={() => links.onOpen(item.path)}
              aria-current={active ? 'page' : undefined}
              className={cn(ROW, 'flex-col items-start gap-0', active && ACTIVE)}
            >
              <span className="w-full truncate font-medium text-foreground">{item.title || item.path}</span>
              <span className="w-full truncate text-xs">{item.path}</span>
            </NavAnchor>
          </li>
        );
      })}
    </ul>
  );
}

export type { DocTreeNode };
export { DocPageList, DocTree };
