// crew: tự dựng
// Mảnh hiển thị của tab Bug Finding trên ticket tổng code-bf (mockup TPS-643 số 2, 3, 4): thanh tiến độ lane, nhãn mức
// finding, verdict, trạng thái finding, mã commit. Chỉ token và Badge có sẵn; chữ do màn hình truyền vào (đã qua t()).
import type * as React from 'react';
import { cn } from '../../cn';
import { Badge } from '../../components/badge';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** Thanh tiến độ lane (`lanesDone/lanesTotal` do app Bug Finding báo về) kèm dòng chữ bên phải. */
function LaneProgress({
  done,
  total,
  label,
  caption,
}: {
  done: number;
  total: number;
  label: string;
  caption: React.ReactNode;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <span data-slot="lane-progress" className="flex min-w-0 items-center gap-2">
      <span
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 min-w-0 max-w-40 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">{caption}</span>
    </span>
  );
}

const SEVERITY: Record<string, BadgeVariant> = {
  CRITICAL: 'destructive',
  HIGH: 'destructive',
  MEDIUM: 'secondary',
};

/** Mức finding (`CRITICAL`/`HIGH` nổi bật, `MEDIUM` vừa, `LOW`/`INFO` viền). */
function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant={SEVERITY[severity] ?? 'outline'} data-severity={severity}>
      {severity}
    </Badge>
  );
}

const VERDICT: Record<string, BadgeVariant> = {
  APPROVE: 'default',
  'APPROVE WITH CONDITIONS': 'secondary',
  BLOCK: 'destructive',
};

function VerdictBadge({ verdict }: { verdict: string }) {
  return (
    <Badge variant={VERDICT[verdict] ?? 'outline'} data-verdict={verdict}>
      {verdict}
    </Badge>
  );
}

/** Trạng thái finding sau lượt chạy (`OPEN`, `FIX_VERIFIED`, `REVIEWER_DISMISSED`…); finding còn mở thì nổi bật hơn. */
function FindingStatusBadge({ status, open }: { status: string; open: boolean }) {
  return (
    <Badge variant={open ? 'secondary' : 'outline'} data-status={status}>
      {status}
    </Badge>
  );
}

/** Mã máy (commit, khóa tài liệu) bằng font mono. */
function MonoText({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="mono-text" className={cn('font-mono text-xs', className)} {...props} />;
}

/** Dòng phụ dưới tiêu đề finding (certainty · action · quan hệ với PR). */
function FindingMeta({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs text-muted-foreground">{children}</span>;
}

export { FindingMeta, FindingStatusBadge, LaneProgress, MonoText, SeverityBadge, VerdictBadge };
