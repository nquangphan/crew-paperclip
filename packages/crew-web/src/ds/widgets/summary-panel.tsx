// crew: tự dựng
import type * as React from 'react';

interface SummaryPanelProps {
  title: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  'data-testid'?: string;
}

/**
 * Khối nổi bật cho phần tóm tắt cần đọc hết (vd Tổng kết của Trợ Lý): viền và nền màu nhấn, tiêu đề có icon, tiêu đề
 * `###` của markdown bên trong thu nhỏ in hoa để không to hơn tiêu đề khối.
 */
function SummaryPanel({ title, icon, children, 'data-testid': testId }: SummaryPanelProps) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-primary/5 px-4 py-3"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-primary [&_svg]:size-4">
        {icon}
        {title}
      </h2>
      {children ? (
        <div className="text-sm break-words [&_h3]:mt-3 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-muted-foreground">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export type { SummaryPanelProps };
export { SummaryPanel };
