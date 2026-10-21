// crew: tự dựng
import type { ComponentProps } from 'react';
import { cn } from '../cn';
import { StatusGlyph, statusColorVar } from './status-glyph';

interface StatusPillProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Trạng thái theo bảng của StatusGlyph (vd. `qc_awaiting`, `qc_verified`): quyết định biểu tượng và màu token. */
  status: string;
  label: string;
}

/** Nhãn trạng thái dạng viên: biểu tượng và chữ cùng màu token `--status-task-icon-*`, viền nhạt cùng sắc. */
function StatusPill({ status, label, className, style, ...props }: StatusPillProps) {
  const color = statusColorVar(status);
  return (
    <span
      data-slot="status-pill"
      data-status={status}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={{ color, borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, ...style }}
      {...props}
    >
      <StatusGlyph status={status} size="sm" />
      {label}
    </span>
  );
}

export type { StatusPillProps };
export { StatusPill };
