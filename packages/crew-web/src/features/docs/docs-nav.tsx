// Cây thư mục tài liệu (từ đường dẫn file) và danh sách kết quả tìm. Trang là nút bấm, thư mục là nhãn.
import { buildDocsTree, type DocsNode } from '@crew/paperclip-plugin/shared/docs-tree';
import { Button, MutedText } from '@/ds';

interface DocsTreeProps {
  pages: readonly { path: string; title: string }[];
  current: string | null;
  onOpen: (path: string) => void;
}

/** Thụt lề theo độ sâu bằng ký tự: feature chỉ được dùng class bố cục, không có class padding. */
const indent = (depth: number): string => '– '.repeat(depth);

function Nodes({
  nodes,
  current,
  onOpen,
  depth,
}: {
  nodes: DocsNode[];
  current: string | null;
  onOpen: (path: string) => void;
  depth: number;
}) {
  return (
    <ul className="flex flex-col">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === 'directory' ? (
            <>
              <MutedText>{`${indent(depth)}${node.name}`}</MutedText>
              <Nodes nodes={node.children} current={current} onOpen={onOpen} depth={depth + 1} />
            </>
          ) : (
            <Button
              variant={node.path === current ? 'secondary' : 'ghost'}
              size="sm"
              className="justify-start"
              onClick={() => onOpen(node.path)}
            >
              {`${indent(depth)}${node.title || node.name}`}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DocsTree({ pages, current, onOpen }: DocsTreeProps) {
  return <Nodes nodes={buildDocsTree([...pages])} current={current} onOpen={onOpen} depth={0} />;
}
