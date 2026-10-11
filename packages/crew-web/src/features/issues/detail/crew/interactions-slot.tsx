// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { ErrorState } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';
import { CARD_KINDS, type CardInteraction, InteractionCard } from './interaction-card';

const CLOSED = new Set(['done', 'cancelled']);

/**
 * Thẻ câu hỏi/xác nhận đang chờ của Trợ Lý, nằm trên ô soạn bình luận (S6.9). Yêu cầu đã done/cancelled thì không
 * hiện (trả lời câu hỏi của việc đã đóng không còn tác dụng, ví dụ sau Ép Done).
 */
export function InteractionsSlot({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const { readOnly } = useCompanyAccess();
  // Trả lời câu hỏi của Trợ Lý là thao tác ghi, nên viewer không thấy thẻ.
  const closed = CLOSED.has(issue.status) || readOnly;
  const list = useQuery({
    queryKey: queryKeys.interactions(issue.id),
    queryFn: () => api.interactions.list(issue.id),
    enabled: !closed,
  });
  if (closed) return null;
  if (list.error) {
    return (
      <ErrorState
        title={t('interactions.loadFailed')}
        message={list.error.message}
        onRetry={() => void list.refetch()}
      />
    );
  }
  const pending = (list.data ?? []).filter(
    (i): i is CardInteraction => i.status === 'pending' && CARD_KINDS.has(i.kind),
  );
  if (pending.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {pending.map((i) => (
        <InteractionCard key={i.id} issue={issue} interaction={i} />
      ))}
    </div>
  );
}
