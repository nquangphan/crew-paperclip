// crew: tự dựng
import type * as React from 'react';

/** Khung nổi ở góc dưới bên phải cho một thông báo còn giữ sau khi dòng liên quan đã rời trang. */
function FloatingNotice({ children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="floating-notice"
      className="fixed right-4 bottom-4 z-40 w-[min(28rem,calc(100vw-2rem))] rounded-lg bg-background shadow-lg"
      {...props}
    >
      {children}
    </div>
  );
}

export { FloatingNotice };
