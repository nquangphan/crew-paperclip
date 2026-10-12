// crew: tự dựng
// Phần render markdown thật (react-markdown, remark-gfm). Chỉ tải lười qua MarkdownView để thư viện markdown không
// nằm trong chunk khởi đầu của shell.
import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../cn';
import { createSlugger } from './heading-slug';
import type { MarkdownProps } from './markdown-view';

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

/** Phần cây hast mà plugin gắn id heading cần đọc. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const HEADING = /^h[1-6]$/;
const textOf = (node: HastNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('');

/**
 * Gắn id kiểu GitHub cho mọi heading (mục lục và link `#neo` dùng chung). Id chỉ lấy từ chữ của heading, không từ thuộc
 * tính tác giả viết (HTML thô đã bị bỏ). Mỗi lần render một slugger mới để đếm heading trùng từ đầu.
 */
function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const slug = createSlugger();
    const visit = (node: HastNode) => {
      if (node.type === 'element' && node.tagName && HEADING.test(node.tagName)) {
        node.properties = { ...node.properties, id: slug(textOf(node)) };
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

const REMARK = [remarkGfm];
const DOCUMENT_REHYPE = [rehypeHeadingIds];

// Khai báo một lần (không tạo lại mỗi lần render) để React không dựng lại link, ảnh khi trang cha render lại.
const COMPONENTS: Components = {
  a: ({ node: _node, href, children, ...rest }) =>
    href && isExternal(href) ? (
      <a {...rest} href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <a {...rest} href={href}>
        {children}
      </a>
    ),
  img: ({ node: _node, src, alt, ...rest }) => {
    const url = typeof src === 'string' ? src : '';
    if (!url) return null;
    if (isExternal(url)) {
      return (
        <a href={url} target="_blank" rel="noreferrer noopener">
          {alt || url}
        </a>
      );
    }
    return <img {...rest} src={url} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />;
  },
};

/**
 * Không dùng rehype-raw nên HTML thô bị bỏ; react-markdown tự chặn URL `javascript:`. Ảnh ngoài (do agent viết)
 * không tự tải để không lộ IP và trang đang xem; chỉ hiện thành link. Ảnh cùng origin hiện bình thường.
 * `variant="document"`: chữ lớn hơn ở màn rộng, heading có id, bảng và khối code cuộn ngang trong khung riêng.
 */
function MarkdownRenderer({ markdown, className, variant = 'default' }: MarkdownProps) {
  const isDocument = variant === 'document';
  return (
    <div
      data-slot="markdown-view"
      data-ready=""
      className={cn(
        'prose prose-sm max-w-none dark:prose-invert',
        isDocument &&
          'sm:prose-base break-words prose-headings:scroll-mt-6 prose-headings:font-semibold prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto prose-img:rounded-md',
        className,
      )}
    >
      <Markdown remarkPlugins={REMARK} rehypePlugins={isDocument ? DOCUMENT_REHYPE : undefined} components={COMPONENTS}>
        {markdown}
      </Markdown>
    </div>
  );
}

export default memo(MarkdownRenderer);
