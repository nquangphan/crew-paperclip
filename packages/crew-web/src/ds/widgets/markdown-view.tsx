// crew: tự dựng
import { type ComponentType, lazy, Suspense } from 'react';
import { cn } from '../cn';

interface MarkdownProps {
  markdown: string;
  className?: string;
}

// Tải lười: react-markdown và micromark chỉ tải khi trang thật sự hiện markdown, không nằm trong chunk khởi đầu.
let Loaded: ComponentType<MarkdownProps> | null = null;
const load = () =>
  import('./markdown-renderer').then((m) => {
    Loaded = m.default;
    return m;
  });
const LazyRenderer = lazy(load);

// Test (vitest) nạp sẵn để markdown render đồng bộ như trước; bản build bỏ hẳn nhánh này.
if (import.meta.env.MODE === 'test') await load();

/** Render markdown (xem markdown-renderer). Lần đầu, trong lúc tải thư viện, hiện chữ thô để nội dung không trống. */
function MarkdownView({ markdown, className }: MarkdownProps) {
  if (Loaded) return <Loaded markdown={markdown} className={className} />;
  return (
    <Suspense
      fallback={
        <div data-slot="markdown-view" className={cn('prose prose-sm max-w-none whitespace-pre-wrap', className)}>
          {markdown}
        </div>
      }
    >
      <LazyRenderer markdown={markdown} className={className} />
    </Suspense>
  );
}

export { MarkdownView };
