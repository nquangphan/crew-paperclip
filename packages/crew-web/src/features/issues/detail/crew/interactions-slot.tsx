// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { ErrorState } from '@/ds';
import { useT } from '@/i18n';
import { CARD_KINDS, type CardInteraction, InteractionCard } from './interaction-card';

/** Thẻ câu hỏi/xác nhận đang chờ của Trợ Lý, nằm trên ô soạn bình luận (S6.9). */
export function InteractionsSlot({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const list = useQuery({
    queryKey: queryKeys.interactions(issue.id),
    queryFn: () => api.interactions.list(issue.id),
  });
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
