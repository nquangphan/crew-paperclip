// crew: tự dựng
import * as React from 'react';
import { Button } from '../components/button';
import { ChevronDown, ChevronUp } from '../icons';

interface ExpandableContentProps {
  children: React.ReactNode;
  /** Cao quá số dòng này (theo line-height) thì thu gọn. */
  maxLines: number;
  /** Nhãn nút khi đang thu gọn; nhận số dòng đang ẩn (ước theo chiều cao đo được). */
  showMoreLabel: (hiddenLines: number) => string;
  showLessLabel: string;
  /** Màu nền phía sau nội dung, đáy đoạn bị cắt mờ dần về màu này. Mặc định là nền trang. */
  fadeTo?: string;
}

/**
 * Nội dung cao quá `maxLines` dòng thì thu gọn, có nút hiện đủ / thu gọn. Đo chiều cao thật sau khi render (markdown
 * có tiêu đề, code, ảnh nên không đếm dòng nguồn được); đổi kích thước thì đo lại.
 */
function ExpandableContent({
  children,
  maxLines,
  showMoreLabel,
  showLessLabel,
  fadeTo = 'var(--background)',
}: ExpandableContentProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [hiddenLines, setHiddenLines] = React.useState(0);
  const [expanded, setExpanded] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // So với chiều cao giới hạn tính từ line-height, không phải clientHeight (lúc mở hết thì bằng scrollHeight).
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
      const hidden = el.scrollHeight - lineHeight * maxLines;
      setHiddenLines(hidden > 1 ? Math.ceil(hidden / lineHeight) : 0);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxLines]);
  const overflows = hiddenLines > 0;
  const collapsed = overflows && !expanded;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <div
          ref={ref}
          data-collapsed={collapsed ? '' : undefined}
          className={collapsed ? 'overflow-hidden' : undefined}
          style={collapsed ? { maxHeight: `${maxLines}lh` } : undefined}
        >
          {children}
        </div>
        {collapsed ? (
          <div
            aria-hidden
            data-slot="expandable-fade"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
            style={{ background: `linear-gradient(to bottom, transparent, ${fadeTo})` }}
          />
        ) : null}
      </div>
      {overflows ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          // Chữ theo màu chữ thường, không kế thừa: bong bóng comment của người ép chữ trắng, nền nút outline trắng.
          className="self-center text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          {expanded ? showLessLabel : showMoreLabel(hiddenLines)}
        </Button>
      ) : null}
    </div>
  );
}

export type { ExpandableContentProps };
export { ExpandableContent };
