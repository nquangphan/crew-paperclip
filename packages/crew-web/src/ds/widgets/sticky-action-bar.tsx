// crew: tự dựng
import type * as React from 'react';

interface StickyActionBarProps {
  /** Thông báo kết quả hoặc lỗi hiện ngay trên hàng nút. */
  notice?: React.ReactNode;
  children: React.ReactNode;
}

/** Thanh nút dính đáy vùng cuộn của trang (Lưu / Hoàn tác), có chỗ cho thông báo ngay phía trên nút. */
function StickyActionBar({ notice, children }: StickyActionBarProps) {
  return (
    <div
      data-slot="sticky-action-bar"
      className="sticky bottom-0 z-30 mt-6 flex flex-col gap-2 border-t bg-background py-3"
    >
      {notice}
      <div className="flex items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export type { StickyActionBarProps };
export { StickyActionBar };
