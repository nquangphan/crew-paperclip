// crew: tự dựng
import type * as React from 'react';
import { Button } from '../components/button';

interface TerminalShellProps {
  /** Tên dự án (hoặc tiêu đề trang khi chưa tải xong). */
  title: string;
  /** Dòng phụ cạnh tiêu đề: máy, nhánh. */
  detail?: string;
  /** Huy hiệu trạng thái kết nối. */
  status?: React.ReactNode;
  /** Nút bên phải thanh trên (cỡ chữ, Đóng). */
  actions?: React.ReactNode;
  /** Thông báo dưới thanh trên (lỗi, phiên đã đóng). */
  notices?: React.ReactNode;
  /** Khung xterm gắn vào; padding nhỏ để chữ không dính viền. */
  screenRef: React.Ref<HTMLDivElement>;
  /** Dưới khung xterm, trong cùng viền (hàng phím phụ). */
  footer?: React.ReactNode;
}

/**
 * Trang terminal toàn chiều cao vùng nội dung: thanh trên, thông báo, khung terminal giãn hết phần còn lại.
 * Chiều cao trừ thanh tiêu đề điện thoại (3rem) và padding dọc của khung trang.
 */
function TerminalShell({ title, detail, status, actions, notices, screenRef, footer }: TerminalShellProps) {
  return (
    <div data-slot="terminal-shell" className="flex h-[calc(100dvh-5rem)] flex-col gap-2 md:h-[calc(100dvh-2.5rem)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <h1 className="min-w-0 truncate text-base font-semibold">
          {title}
          {detail ? <span className="ml-2 font-normal text-muted-foreground">{detail}</span> : null}
        </h1>
        {status}
        {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
      </div>
      {notices}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-background">
        <div ref={screenRef} className="min-h-0 flex-1 p-1" />
        {footer}
      </div>
    </div>
  );
}

/** Hàng phím bấm gửi chuỗi vào terminal (điện thoại); không lấy tiêu điểm để bàn phím ảo không cụp. */
function TerminalKeyRow({
  keys,
  onKey,
  label,
}: {
  keys: readonly { label: string; data: string }[];
  onKey: (data: string) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex shrink-0 gap-1 overflow-x-auto border-t bg-muted/40 p-1">
      {keys.map((key) => (
        <Button
          key={key.label}
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 font-mono"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onKey(key.data)}
        >
          {key.label}
        </Button>
      ))}
    </nav>
  );
}

export type { TerminalShellProps };
export { TerminalKeyRow, TerminalShell };
