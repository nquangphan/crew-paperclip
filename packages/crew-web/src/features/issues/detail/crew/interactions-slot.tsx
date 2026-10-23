// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { useMe } from '@/app/hooks';
import { ErrorState } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';
import { pendingQuestions } from './comment-questions';
import { awaitingMyApproval } from './gate-actions';
import { CARD_KINDS, type CardInteraction, CommentQuestionsCard, InteractionCard } from './interaction-card';

const CLOSED = new Set(['done', 'cancelled']);

/**
 * Thẻ câu hỏi/xác nhận đang chờ của Trợ Lý, nằm trên ô soạn bình luận (S6.9). Yêu cầu đã done/cancelled thì không
 * hiện (trả lời câu hỏi của việc đã đóng không còn tác dụng, ví dụ sau Ép Done). Không có thẻ nào đang chờ mà bình
 * luận agent mới nhất (hay tổng kết trong mô tả) còn điểm cần owner chốt chưa ai trả lời thì dựng thẻ chọn từ đó.
 */
export function InteractionsSlot({ issue, agentNames = {} }: { issue: Issue; agentNames?: Record<string, string> }) {
  const { t } = useT('issues');
  const { readOnly } = useCompanyAccess();
  const me = useMe();
  // Trả lời câu hỏi của Trợ Lý là thao tác ghi, nên viewer không thấy thẻ.
  const closed = CLOSED.has(issue.status) || readOnly;
  const list = useQuery({
    queryKey: queryKeys.interactions(issue.id),
    queryFn: () => api.interactions.list(issue.id),
    enabled: !closed,
  });
  const comments = useQuery({
    queryKey: queryKeys.comments(issue.id),
    queryFn: () => api.comments.list(issue.id, { order: 'asc' }),
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
  if (pending.length === 0) {
    // Chờ danh sách thẻ tải xong, kẻo thẻ dựng từ bình luận hiện chồng lên thẻ thật trong chốc lát.
    if (!list.data || !comments.data) return null;
    const cards = list.data.filter((i) => CARD_KINDS.has(i.kind));
    const found = pendingQuestions(comments.data, cards, issue.description);
    const agentId = found?.comment.authorAgentId ?? '';
    const approval = awaitingMyApproval(issue, me);
    // Trả lời phải tới được người hỏi: lúc owner duyệt thì đi cùng quyết định duyệt; ngoài ra là bình luận, chỉ đánh
    // thức agent đang giữ issue, nên chỉ dựng thẻ khi chính agent đó hỏi.
    if (!found || (!approval && (found.fromSummary || issue.assigneeAgentId !== agentId))) return null;
    return (
      <CommentQuestionsCard
        key={found.comment.id}
        issue={issue}
        found={found}
        approval={approval}
        authorName={agentNames[agentId] ?? t('interactions.agent')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {pending.map((i) => (
        <InteractionCard key={i.id} issue={issue} interaction={i} />
      ))}
    </div>
  );
}
