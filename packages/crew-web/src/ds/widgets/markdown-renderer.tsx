// crew: tự dựng
// Phần render markdown thật (react-markdown, remark-gfm). Chỉ tải lười qua MarkdownView để thư viện markdown không
// nằm trong chunk khởi đầu của shell.
import { ImageOff } from 'lucide-react';
import { type ComponentProps, memo, type ReactNode, useMemo, useState } from 'react';
import Markdown, {
  type Components,
  defaultUrlTransform,
  type ExtraProps,
  type Options,
  type UrlTransform,
} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useT } from '@/i18n';
import { cn } from '../cn';
import { isPlainClick, useAttachmentLinks } from './attachment-link-context';
import { formatBytes } from './attachment-viewer-logic';
import { createSlugger } from './heading-slug';
import { classifyImageSrc, extractLongDataUrls, restoreDataUrls } from './markdown-image-policy';
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

/** Trả URL `data:` dài đã tách trước khi phân tích (xem extractLongDataUrls) về các đoạn chữ, ví dụ trong khối code. */
function rehypeRestoreDataUrls(urls: readonly string[]) {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (node.type === 'text' && node.value) node.value = restoreDataUrls(node.value, urls);
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

const REMARK = [remarkGfm];
type RehypePlugins = NonNullable<Options['rehypePlugins']>;

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

/** Khung ảnh trong cột: rộng tối đa bằng cột, cao có trần, giữ tỉ lệ. */
const IMAGE_CLASS = 'block h-auto max-h-96 w-auto max-w-full rounded-md object-contain';
/** Vỏ quanh ảnh: `not-prose` bỏ lề lớn của prose cho ảnh, chỉ chừa khoảng nhỏ trên dưới. */
const IMAGE_WRAP_CLASS = 'not-prose my-1 inline-block max-w-full align-top';

/**
 * Chỗ của một ảnh không hiện được (bị chặn, lỗi tải, quá lớn): luôn có chữ (alt hoặc tên tạm), không để khoảng trống.
 * Màu chữ theo nền quanh nó (bong bóng xanh của người hay nền thường của agent).
 */
function ImageNote({ label, note, children }: { label: string; note: string; children?: ReactNode }) {
  return (
    <span
      data-slot="markdown-image-note"
      className="not-prose my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-current/30 border-dashed px-2 py-1 align-middle text-xs opacity-80"
    >
      <ImageOff aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      <span className="shrink-0">({note})</span>
      {children}
    </span>
  );
}

/** Ảnh hiện trong trang; lỗi tải thì thay bằng tên ảnh. `onOpen` có thì bấm ảnh mở hộp xem. */
function InlineImage({
  src,
  alt,
  label,
  title,
  onOpen,
}: {
  src: string;
  alt: string;
  label: string;
  title?: string;
  onOpen?: () => void;
}) {
  const { t } = useT();
  // Ghi theo src: nội dung đổi sang ảnh khác thì thử tải lại từ đầu.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <ImageNote label={label} note={t('attachment.image.broken')} />;
  const img = (
    <img
      src={src}
      alt={alt}
      title={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={IMAGE_CLASS}
    />
  );
  if (!onOpen) return <span className={IMAGE_WRAP_CLASS}>{img}</span>;
  return (
    <button
      type="button"
      data-attachment-link=""
      className={cn(
        IMAGE_WRAP_CLASS,
        'cursor-zoom-in rounded-md p-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
      )}
      aria-label={label}
      onClick={(e) => {
        // Ảnh nằm trong link (`[![a](x)](x)`) thì chỉ mở hộp xem, link không chạy.
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
    >
      {img}
    </button>
  );
}

/**
 * Ảnh trong markdown, theo luật ở markdown-image-policy: file đính kèm và ảnh base64 PNG/JPEG/GIF/WebP hiện vừa cột, bấm
 * mở hộp xem; ảnh ở host khác chỉ thành link; `data:` loại khác (SVG…) bị chặn, chỉ hiện alt kèm ghi chú.
 */
function MarkdownImage({ node: _node, src, alt, title }: ImageProps) {
  const { t, lang } = useT();
  const links = useAttachmentLinks();
  const source = classifyImageSrc(typeof src === 'string' ? src : '');
  const altText = alt?.trim() ?? '';
  const label = altText || t('attachment.image.untitled');
  switch (source.kind) {
    case 'none':
      return null;
    case 'blocked':
      return <ImageNote label={label} note={t('attachment.image.blocked')} />;
    case 'external':
      return (
        <a href={source.url} target="_blank" rel="noreferrer noopener">
          {altText || source.url}
        </a>
      );
    case 'inline-too-large':
      return (
        <ImageNote label={label} note={t('attachment.image.tooLarge', { size: formatBytes(source.byteSize, lang) })}>
          <a href={source.url} download={altText || undefined} className="shrink-0 underline">
            {t('attachment.image.download')}
          </a>
        </ImageNote>
      );
    case 'inline':
      return (
        <InlineImage
          src={source.url}
          alt={altText}
          label={label}
          title={title}
          onOpen={
            links
              ? () =>
                  links.openImage(source.url, {
                    name: altText || undefined,
                    contentType: source.contentType,
                    byteSize: source.byteSize,
                  })
              : undefined
          }
        />
      );
    case 'local': {
      const attachmentId = links ? links.match(source.url) : null;
      return (
        <InlineImage
          src={source.url}
          alt={altText}
          label={label}
          title={title}
          onOpen={
            links && attachmentId
              ? () => links.open(attachmentId, { name: altText || undefined, image: true })
              : undefined
          }
        />
      );
    }
  }
}

/**
 * URL trong markdown qua bộ lọc mặc định của react-markdown (bỏ `javascript:`, `data:`…), trừ `src` của ảnh là `data:`:
 * để MarkdownImage tự quyết theo luật ảnh (chỉ ảnh raster được hiện, SVG và loại khác bị chặn). `urls` là URL `data:`
 * dài đã tách ra trước khi phân tích, đặt lại vào đúng chỗ ở đây.
 */
const urlTransformFor =
  (urls: readonly string[]): UrlTransform =>
  (raw, key, node) => {
    const url = restoreDataUrls(raw, urls);
    return key === 'src' && node.tagName === 'img' && /^data:/i.test(url) ? url : defaultUrlTransform(url);
  };

// Khai báo một lần (không tạo lại mỗi lần render) để React không dựng lại link, ảnh khi trang cha render lại.
const COMPONENTS: Components = { a: MarkdownLink, img: MarkdownImage };

/**
 * Không dùng rehype-raw nên HTML thô bị bỏ; URL `javascript:` bị bỏ, `data:` chỉ còn ở ảnh và qua luật ảnh. Ảnh ngoài
 * (do agent viết) không tự tải để không lộ IP và trang đang xem; chỉ hiện thành link. Ảnh cùng origin hiện bình thường.
 * `variant="document"`: chữ lớn hơn ở màn rộng, heading có id, bảng và khối code cuộn ngang trong khung riêng.
 */
function MarkdownRenderer({ markdown, className, variant = 'default' }: MarkdownProps) {
  const isDocument = variant === 'document';
  // Ảnh base64 lớn: tách URL ra trước khi phân tích để bộ phân tích không phải đi qua hàng triệu ký tự (treo trang).
  const source = useMemo(() => extractLongDataUrls(markdown), [markdown]);
  const urlTransform = useMemo(() => urlTransformFor(source.urls), [source]);
  const rehypePlugins = useMemo<RehypePlugins>(
    () => [
      ...(source.urls.length ? [[rehypeRestoreDataUrls, source.urls] satisfies RehypePlugins[number]] : []),
      ...(isDocument ? [rehypeHeadingIds] : []),
    ],
    [source, isDocument],
  );
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
      <Markdown
        remarkPlugins={REMARK}
        rehypePlugins={rehypePlugins}
        components={COMPONENTS}
        urlTransform={urlTransform}
      >
        {source.markdown}
      </Markdown>
    </div>
  );
}

export default memo(MarkdownRenderer);
