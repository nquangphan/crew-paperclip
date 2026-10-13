// crew: tự dựng
// Phần render markdown thật (react-markdown, remark-gfm). Chỉ tải lười qua MarkdownView để thư viện markdown không
// nằm trong chunk khởi đầu của shell.
import { type ComponentProps, memo, type ReactNode } from 'react';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../cn';
import { isPlainClick, useAttachmentLinks } from './attachment-link-context';
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

/** Chữ thuần của nội dung link (làm tên file khi file không có trong danh sách đính kèm). */
const plainText = (node: ReactNode): string =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : Array.isArray(node)
      ? node.map(plainText).join('')
      : '';

type AnchorProps = ComponentProps<'a'> & ExtraProps;
type ImageProps = ComponentProps<'img'> & ExtraProps;

/**
 * Link trong markdown. Link tới file đính kèm (khi trang có hộp xem) mở hộp xem tại chỗ, Cmd/Ctrl+click vẫn theo link;
 * link ngoài mở tab mới; link nội bộ khác giữ nguyên.
 */
function MarkdownLink({ node: _node, href, children, ...rest }: AnchorProps) {
  const links = useAttachmentLinks();
  const attachmentId = href && links ? links.match(href) : null;
  if (href && links && attachmentId) {
    return (
      <a
        {...rest}
        href={href}
        data-attachment-link=""
        onClick={(e) => {
          if (!isPlainClick(e)) return;
          e.preventDefault();
          links.open(attachmentId, { name: plainText(children) });
        }}
      >
        {children}
      </a>
    );
  }
  return href && isExternal(href) ? (
    <a {...rest} href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ) : (
    <a {...rest} href={href}>
      {children}
    </a>
  );
}

/** Ảnh trong markdown: ảnh ngoài chỉ hiện thành link; ảnh là file đính kèm bấm được để xem lớn trong hộp xem. */
function MarkdownImage({ node: _node, src, alt, ...rest }: ImageProps) {
  const links = useAttachmentLinks();
  const url = typeof src === 'string' ? src : '';
  if (!url) return null;
  const attachmentId = links ? links.match(url) : null;
  if (links && attachmentId) {
    return (
      <button
        type="button"
        data-attachment-link=""
        className="cursor-zoom-in rounded-md p-0 align-top focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={alt || undefined}
        onClick={(e) => {
          // Ảnh nằm trong link (`[![a](x)](x)`) thì chỉ mở hộp xem, link không chạy.
          e.preventDefault();
          e.stopPropagation();
          links.open(attachmentId, { name: alt ?? undefined, image: true });
        }}
      >
        <img {...rest} src={url} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
      </button>
    );
  }
  if (isExternal(url)) {
    return (
      <a href={url} target="_blank" rel="noreferrer noopener">
        {alt || url}
      </a>
    );
  }
  return <img {...rest} src={url} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />;
}

// Khai báo một lần (không tạo lại mỗi lần render) để React không dựng lại link, ảnh khi trang cha render lại.
const COMPONENTS: Components = { a: MarkdownLink, img: MarkdownImage };

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
