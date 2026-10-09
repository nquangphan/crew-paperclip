// crew: tự dựng
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../cn';

const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

/**
 * Chỉ render markdown. Không dùng rehype-raw nên HTML thô bị bỏ; react-markdown tự chặn URL `javascript:`.
 */
function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div data-slot="markdown-view" className={cn('prose prose-sm max-w-none dark:prose-invert', className)}>
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
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}

export { MarkdownView };
