// crew: tự dựng
import * as React from 'react';
import { Button } from '../components/button';

interface ExpandableContentProps {
  children: React.ReactNode;
  /** Cao quá số dòng này (theo line-height) thì thu gọn. */
  maxLines: number;
  showMoreLabel: string;
  showLessLabel: string;
}

/**
 * Nội dung cao quá `maxLines` dòng thì thu gọn, có nút hiện đủ / thu gọn. Đo chiều cao thật sau khi render (markdown
 * có tiêu đề, code, ảnh nên không đếm dòng nguồn được); đổi kích thước thì đo lại.
 */
function ExpandableContent({ children, maxLines, showMoreLabel, showLessLabel }: ExpandableContentProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // So với chiều cao giới hạn tính từ line-height, không phải clientHeight (lúc mở hết thì bằng scrollHeight).
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
      setOverflows(el.scrollHeight > lineHeight * maxLines + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxLines]);
  const collapsed = overflows && !expanded;
  return (
    <div className="flex flex-col gap-1">
      <div
        ref={ref}
        data-collapsed={collapsed ? '' : undefined}
        className={collapsed ? 'overflow-hidden' : undefined}
        style={collapsed ? { maxHeight: `${maxLines}lh` } : undefined}
      >
        {children}
      </div>
      {overflows ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="self-start px-0"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? showLessLabel : showMoreLabel}
        </Button>
      ) : null}
    </div>
  );
}

export type { ExpandableContentProps };
export { ExpandableContent };
