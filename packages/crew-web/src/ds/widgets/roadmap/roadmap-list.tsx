// crew: tự dựng
// Dạng danh sách của bản đồ Roadmap: cùng nội dung tầng đang xem (đủ, không cắt trần) thành <ul> lồng nhau. Vừa là lối
// thoát khi tầng có quá nhiều nút, vừa là bản thay thế cho trình đọc màn hình.
import { BookOpen, Building2, FileText, Folder, FolderOpen } from 'lucide-react';
import { useT } from '@/i18n';
import { StatusGlyph } from '../status-glyph';
import { roadmapNodeLabel, roadmapNodeMeta } from './roadmap-node';
import type { RoadmapNode } from './roadmap-types';

export interface RoadmapListItem {
  node: RoadmapNode;
  children: RoadmapListItem[];
}

interface RoadmapListProps {
  /** Tên vùng (aria-label). */
  label: string;
  /** Nút tâm của tầng: dòng đầu, bấm được như trên bản đồ. */
  center: RoadmapNode;
  items: RoadmapListItem[];
  /** Chữ khi tầng không có mục nào. */
  empty: string;
  onOpen: (node: RoadmapNode) => void;
}

function Icon({ node }: { node: RoadmapNode }) {
  if (node.kind === 'request' || node.kind === 'ticket') return <StatusGlyph status={node.status ?? 'backlog'} />;
  const Glyph =
    node.kind === 'company'
      ? Building2
      : node.kind === 'project'
        ? Folder
        : node.kind === 'docs'
          ? BookOpen
          : node.kind === 'folder'
            ? FolderOpen
            : FileText;
  return <Glyph aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

function Row({ node, onOpen }: { node: RoadmapNode; onOpen: (node: RoadmapNode) => void }) {
  const { t } = useT();
  const label = roadmapNodeLabel(t, node);
  return (
    <button
      type="button"
      data-roadmap-id={node.id}
      aria-label={label}
      aria-disabled={node.disabled || undefined}
      onClick={() => {
        if (!node.disabled) onOpen(node);
      }}
      className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary aria-disabled:cursor-default aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent"
    >
      <Icon node={node} />
      {node.identifier ? <span className="shrink-0 text-xs text-muted-foreground">{node.identifier}</span> : null}
      <span className="min-w-0 flex-1 truncate">
        {node.kind === 'more'
          ? t('roadmap.more', { count: node.extra ?? 0 })
          : node.kind === 'docs'
            ? t('roadmap.docs')
            : node.title}
      </span>
      <span aria-hidden className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block">
        {roadmapNodeMeta(t, node)}
      </span>
    </button>
  );
}

function Items({ items, onOpen }: { items: RoadmapListItem[]; onOpen: (node: RoadmapNode) => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.node.id}>
          <Row node={item.node} onOpen={onOpen} />
          {item.children.length ? (
            <div className="ml-4 border-l pl-2">
              <Items items={item.children} onOpen={onOpen} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RoadmapList({ label, center, items, empty, onOpen }: RoadmapListProps) {
  return (
    <section
      aria-label={label}
      data-slot="roadmap-list"
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground"
    >
      <Row node={center} onOpen={onOpen} />
      <div className="ml-4 border-l pl-2">
        {items.length ? (
          <Items items={items} onOpen={onOpen} />
        ) : (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">{empty}</p>
        )}
      </div>
    </section>
  );
}

export type { RoadmapListProps };
export { RoadmapList };
