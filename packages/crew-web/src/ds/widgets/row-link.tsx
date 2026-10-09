// crew: tự dựng
import type * as React from 'react';
import { cn } from '../cn';

interface RowLinkProps {
  href?: string;
  onOpen?: () => void;
  className?: string;
  children: React.ReactNode;
}

/** Dòng danh sách bấm được: giữ link thật (mở tab mới, copy link) nhưng click thường chạy onOpen cho điều hướng SPA. */
function RowLink({ href, onOpen, className, children }: RowLinkProps) {
  const base = cn(
    'flex items-center gap-3 border-b px-3 py-2 text-sm transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none',
    className,
  );
  if (!href && !onOpen) return <div className={base}>{children}</div>;
  return (
    <a
      href={href}
      className={base}
      onClick={(e) => {
        if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onOpen();
      }}
    >
      {children}
    </a>
  );
}

export { RowLink };
