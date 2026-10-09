// crew: tự dựng
import { useT } from '@/i18n';
import { Badge } from '../../components/badge';

type ReadinessBadgeState = 'ready' | 'paused' | 'not_ready' | 'terminated' | 'untracked';
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const VARIANT: Record<ReadinessBadgeState, BadgeVariant> = {
  ready: 'default',
  not_ready: 'destructive',
  paused: 'secondary',
  terminated: 'secondary',
  untracked: 'outline',
};

interface ReadinessBadgeProps {
  /** `state` của `AgentReadiness` hoặc `ProjectReadiness` (features/readiness). */
  state: ReadinessBadgeState;
  /** Mã bảng kiểm không đạt (A1–A7, P1–P2); mã lạ hiện nguyên mã. */
  failed: { id: string }[];
}

/** Nhãn trạng thái sẵn sàng, kèm danh sách mục chưa đạt. */
function ReadinessBadge({ state, failed }: ReadinessBadgeProps) {
  const { t } = useT();
  return (
    <span className="inline-flex flex-col items-start gap-1" data-slot="readiness-badge" data-state={state}>
      <Badge variant={VARIANT[state] ?? 'outline'}>{t(`readiness:state.${state}`, { defaultValue: state })}</Badge>
      {failed.length ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {failed.map((item) => (
            <li key={item.id}>{t(`readinessBadge.check.${item.id}`, { defaultValue: item.id })}</li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}

export type { ReadinessBadgeProps, ReadinessBadgeState };
export { ReadinessBadge };
