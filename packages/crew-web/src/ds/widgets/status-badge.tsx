// crew: tự dựng
import { useT } from '@/i18n';
import { Badge } from '../components/badge';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

const VARIANT: Record<string, Variant> = {
  in_progress: 'default',
  running: 'default',
  active: 'default',
  done: 'default',
  succeeded: 'default',
  blocked: 'destructive',
  error: 'destructive',
  failed: 'destructive',
  timed_out: 'destructive',
  in_review: 'outline',
  pending_approval: 'outline',
  scheduled_retry: 'outline',
  interrupted: 'outline',
  todo: 'secondary',
  backlog: 'secondary',
  queued: 'secondary',
  idle: 'secondary',
  paused: 'secondary',
  cancelled: 'secondary',
  terminated: 'secondary',
};

/** Nhãn trạng thái issue, run hoặc agent. Status lạ hiện nguyên giá trị. */
function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  return (
    <Badge variant={VARIANT[status] ?? 'outline'} data-status={status}>
      {t(`status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

export { StatusBadge };
