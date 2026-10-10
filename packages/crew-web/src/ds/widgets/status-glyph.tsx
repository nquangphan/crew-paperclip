// clone: ui/src/components/StatusGlyph.tsx @ v2026.1005.0
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../cn';

type StatusGlyphSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<StatusGlyphSize, number> = { sm: 14, md: 16, lg: 20 };

const TaskProgressSpinner = createLucideIcon('TaskProgressSpinner', [
  ['circle', { cx: '12', cy: '12', r: '10', pathLength: '100', strokeDasharray: '80 20', key: 'progress' }],
]);

const STATUS_ICON: Record<string, LucideIcon> = {
  idle: Circle,
  backlog: CircleDashed,
  todo: Circle,
  in_progress: TaskProgressSpinner,
  in_review: CircleDot,
  done: CircleCheck,
  blocked: CircleMinus,
  cancelled: Ban,
};

const COLOR_VAR: Record<string, string> = {
  idle: '--status-task-icon-backlog',
  backlog: '--status-task-icon-backlog',
  todo: '--status-task-icon-todo',
  in_progress: '--status-task-icon-in_progress',
  in_review: '--status-task-icon-in_review',
  done: '--status-task-icon-done',
  blocked: '--status-task-icon-blocked',
  cancelled: '--status-task-icon-cancelled',
};

interface StatusGlyphProps {
  status: string;
  size?: StatusGlyphSize;
  className?: string;
  /** Nhãn truy cập; có thì SVG là `img`, không thì chỉ để trang trí. */
  title?: string;
}

/** Biểu tượng trạng thái yêu cầu: mỗi trạng thái một hình riêng, màu theo token `--status-task-icon-*`. */
function StatusGlyph({ status, size = 'md', className, title }: StatusGlyphProps) {
  const Icon = STATUS_ICON[status] ?? CircleDashed;
  const a11y = title ? ({ role: 'img', 'aria-label': title } as const) : ({ 'aria-hidden': true } as const);
  return (
    <Icon
      data-slot="status-glyph"
      data-status={status}
      size={SIZE_PX[size]}
      className={cn(
        'inline-block shrink-0 align-middle',
        status === 'in_progress' && 'motion-safe:animate-spin',
        className,
      )}
      style={{ color: `var(${COLOR_VAR[status] ?? '--status-task-icon-backlog'})` }}
      {...a11y}
    />
  );
}

export type { StatusGlyphProps, StatusGlyphSize };
export { StatusGlyph };
