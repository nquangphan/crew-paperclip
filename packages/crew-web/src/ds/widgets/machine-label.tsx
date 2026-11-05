// crew: tự dựng
// Nhãn máy của cây yêu cầu trên danh sách, thẻ Bảng và bộ lọc (mockup TPS-751, docs/design/mockups/tps-750-machine-label).
// Chữ 12px màu muted như RowCell, chỉ báo 12px trước tên: online chấm xanh, offline icon WifiOff xám, đã gỡ ghép icon
// Unlink hổ phách và tên gạch ngang, chưa ghim chỉ có chữ. Ba trạng thái khác cả hình lẫn màu (token
// `--status-task-icon-*`), không chỉ dựa vào màu. Chữ do màn hình truyền vào.
import { Unlink, WifiOff } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../cn';
import { Skeleton } from '../components/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/tooltip';

type MachineLabelState = 'online' | 'offline' | 'unpaired' | 'unpinned';

interface MachineLabelProps {
  state: MachineLabelState;
  /** Chữ chính: tên máy gọn, hoặc chữ thay tên ("Chưa ghim", "Đã gỡ ghép"). */
  name: string;
  /** Gạch ngang tên (máy đã gỡ ghép còn tên). */
  strike?: boolean;
  /** Chữ trạng thái sau tên ("· mất liên lạc"), cho chỗ không có tooltip (màn hẹp, thẻ Bảng, bộ lọc). */
  stateText?: string;
  /** `option`: chữ cỡ thường màu chữ chính, chữ trạng thái xuống dòng dưới tên (mục bộ lọc). */
  layout?: 'inline' | 'option';
  /** Nhãn đọc màn hình ("Máy demo-mac-01, mất liên lạc"); mặc định là `name`. */
  ariaLabel?: string;
  /** Nội dung tooltip (cột Máy trên desktop). */
  tooltip?: React.ReactNode;
}

const INDICATOR: Record<Exclude<MachineLabelState, 'unpinned'>, React.ReactNode> = {
  online: <span className="size-2 rounded-full bg-(--status-task-icon-done)" />,
  offline: <WifiOff className="size-3 text-(--status-task-icon-backlog)" />,
  unpaired: <Unlink className="size-3 text-(--status-task-icon-todo)" />,
};

function MachineLabel({
  state,
  name,
  strike = false,
  stateText,
  layout = 'inline',
  ariaLabel,
  tooltip,
}: MachineLabelProps) {
  const option = layout === 'option';
  const label = (
    <span
      data-slot="machine-label"
      data-state={state}
      role="img"
      aria-label={ariaLabel ?? name}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 whitespace-nowrap',
        option ? 'flex-wrap text-sm text-foreground' : 'text-xs text-muted-foreground',
        tooltip ? 'relative z-10' : null,
      )}
    >
      {state === 'unpinned' ? null : (
        <span
          aria-hidden
          data-slot="machine-label-indicator"
          className="inline-flex size-3 shrink-0 items-center justify-center"
        >
          {INDICATOR[state]}
        </span>
      )}
      <span
        aria-hidden
        className={cn(
          'min-w-0 truncate',
          strike && 'line-through decoration-muted-foreground/70',
          option && strike && 'text-muted-foreground',
        )}
      >
        {name}
      </span>
      {stateText ? (
        <>
          {' '}
          <span
            aria-hidden
            className={cn('shrink-0 font-medium text-foreground', option && 'basis-full pl-4.5 text-xs')}
          >
            {option ? stateText : `· ${stateText}`}
          </span>
        </>
      ) : null}
    </span>
  );
  if (!tooltip) return label;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{label}</TooltipTrigger>
        <TooltipContent className="max-w-64 text-left">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Ô máy đang chờ route lô trả về. */
function MachineLabelPending({ label }: { label: string }) {
  return <Skeleton data-slot="machine-label-pending" aria-label={label} className="h-2.5 w-20" />;
}

/** Ô máy khi tải máy lỗi: gạch ngang xám, lý do trong `title`. */
function MachineLabelMissing({ title }: { title: string }) {
  return (
    <span data-slot="machine-label-missing" title={title} className="text-xs text-muted-foreground">
      —
    </span>
  );
}

export type { MachineLabelProps, MachineLabelState };
export { MachineLabel, MachineLabelMissing, MachineLabelPending };
