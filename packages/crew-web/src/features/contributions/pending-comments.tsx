// crew: tự dựng
import type { ReactNode } from 'react';
import type { Contribution } from '@/api';
import { useMe } from '@/app/hooks';
import { ChatMessage, MarkdownView } from '@/ds';
import { formatDateTime, useT } from '@/i18n';
import { ContributionBadge } from './contribution-badge';

/** Bình luận góp ý còn nằm ở bảng chờ (chưa thành bình luận thật): chờ duyệt, đang duyệt dở hoặc bị từ chối. */
export const isPendingComment = (c: Contribution): boolean =>
  c.kind === 'comment' && c.status !== 'approved' && c.body !== null;

interface PendingCommentProps {
  contribution: Contribution;
  /** Tên hiển thị của tác giả; null thì dùng nhãn chung. */
  authorName: string | null;
  /** Chỗ gắn nút của owner (Duyệt, Từ chối). Khách không bao giờ có. */
  actions?: ReactNode;
}

/** Một bình luận chờ trong luồng bình luận: nền mờ, kèm badge trạng thái. */
export function PendingComment({ contribution, authorName, actions }: PendingCommentProps) {
  const { t, lang } = useT('contributions');
  const me = useMe();
  const mine = contribution.authorUserId === me.id;
  const name = mine ? t('pending.you') : (authorName ?? t('pending.user'));
  return (
    <ChatMessage
      id={`contribution-${contribution.id}`}
      data-testid="pending-comment"
      data-status={contribution.status}
      // Bình luận góp ý luôn do người viết (khách hoặc chính mình), không bao giờ là agent.
      kind="human"
      author={name}
      footer={
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {name} · <time dateTime={contribution.createdAt}>{formatDateTime(contribution.createdAt, lang)}</time>
          </span>
          <ContributionBadge status={contribution.status} />
          {actions}
        </span>
      }
    >
      <MarkdownView markdown={contribution.body ?? ''} />
    </ChatMessage>
  );
}

/** Dòng "Góp ý của <tên>" dưới bình luận thật được sinh ra từ một góp ý đã duyệt. */
export function ContributionChip({ name }: { name: string }) {
  const { t } = useT('contributions');
  return <span data-testid="contribution-chip">{t('chip.from', { name })}</span>;
}
