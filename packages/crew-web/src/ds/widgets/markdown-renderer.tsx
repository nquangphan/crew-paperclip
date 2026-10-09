// crew: tự dựng
// Phần render markdown thật (react-markdown, remark-gfm). Chỉ tải lười qua MarkdownView để thư viện markdown không
// nằm trong chunk khởi đầu của shell.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../cn';

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

/**
 * Không dùng rehype-raw nên HTML thô bị bỏ; react-markdown tự chặn URL `javascript:`. Ảnh ngoài (do agent viết)
 * không tự tải để không lộ IP và trang đang xem; chỉ hiện thành link. Ảnh cùng origin hiện bình thường.
 */
export default function MarkdownRenderer({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div
      data-slot="markdown-view"
      data-ready=""
      className={cn('prose prose-sm max-w-none dark:prose-invert', className)}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
