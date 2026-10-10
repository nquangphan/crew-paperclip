// crew: tự dựng
import type * as React from 'react';

interface NavAnchorProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> {
  /** Trang đầy đủ: Cmd/Ctrl/Shift+click và chuột giữa để trình duyệt tự mở tab mới tới đây. */
  href: string;
  /** Click thường chạy hàm này (điều hướng SPA hoặc mở popup) thay vì tải trang. */
  onOpen: () => void;
}

/** Liên kết thật (copy link, mở tab mới được) nhưng click thường không rời trang. */
function NavAnchor({ href, onOpen, children, ...rest }: NavAnchorProps) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpen();
      }}
    >
      {children}
    </a>
  );
}

export type { NavAnchorProps };
export { NavAnchor };
