// crew: tự dựng
import type { IssueComment } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { useMe } from '@/app/hooks';
import {
  ChatDivider,
  ChatMessage,
  ErrorState,
  ExpandableContent,
  MarkdownView,
  MutedText,
  Skeleton,
  Transcript,
  type TranscriptEntry,
} from '@/ds';
import { ContributionActions } from '@/features/contributions/contribution-actions';
import { ContributionChip, isPendingComment, PendingComment } from '@/features/contributions/pending-comments';
import { useAuthorLabel, useAuthorNames, useIssueContributions } from '@/features/contributions/use-contributions';
import { formatDateTime, useT } from '@/i18n';
import { newestFirstThread } from './comment-thread';

/** Một run đang chạy của issue (GET /issues/:id/live-runs). */
interface LiveRun {
  id: string;
  status: string;
  agentId: string;
}

/** Nội dung run trực tiếp, thu gọn mặc định (S6.4). */
function LiveRunTranscript({ run, agentName }: { run: LiveRun; agentName: string }) {
  const { t } = useT('issues');
  const events = useQuery({
    queryKey: queryKeys.runEvents(run.id),
    queryFn: () => api.runs.events(run.id),
    refetchInterval: 5_000,
  });
  const entries: TranscriptEntry[] = (events.data ?? []).map((e) => ({
    id: String(e.id ?? e.seq),
    role: e.stream === 'stderr' || e.stream === 'system' ? 'system' : 'assistant',
    text: e.message ?? e.eventType,
  }));
  return (
    <section data-testid="live-run" className="flex flex-col gap-2">
      <ChatDivider>{t('detail.comments.liveRun', { name: agentName })}</ChatDivider>
      {events.error ? <ErrorState title={t('detail.comments.liveFailed')} message={events.error.message} /> : null}
      <Transcript entries={entries} />
    </section>
  );
}

/** Số dòng tối đa của một bình luận khi thu gọn. */
export const COLLAPSED_LINES = 10;

interface CommentsProps {
  issueId: string;
  agentNames: Record<string, string>;
}

/**
 * Luồng trao đổi kiểu chat của Paperclip (S6.4), mới nhất ở trên cùng (ngay dưới ô soạn): bình luận của người nằm phải
 * trong bong bóng, của agent nằm trái có tên; transcript của run đang chạy đứng đầu luồng vì là việc đang diễn ra.
 * Không có nút like/dislike (BA mục 2: feedbackVote).
 */
export function Comments({ issueId, agentNames }: CommentsProps) {
  const { t, lang } = useT('issues');
  const me = useMe();
  const list = useQuery({
    queryKey: queryKeys.comments(issueId),
    queryFn: () => api.comments.list(issueId, { order: 'asc' }),
  });
  const live = useQuery({
    queryKey: queryKeys.issueLiveRuns(issueId),
    queryFn: async () => (await api.runs.liveForIssue(issueId)) as LiveRun[],
  });

  const contributions = useIssueContributions(issueId);
  const authorName = useAuthorNames();
  const authorLabel = useAuthorLabel();
  const pending = contributions.filter(isPendingComment);
  const contributionByComment = new Map(
    contributions.flatMap((c) => (c.resultCommentId ? [[c.resultCommentId, c]] : [])),
  );

  const author = (c: IssueComment): string => {
    if (c.authorAgentId) return agentNames[c.authorAgentId] ?? t('detail.comments.agent');
    if (c.authorUserId) return c.authorUserId === me.id ? t('detail.comments.you') : t('detail.comments.user');
    return t('detail.comments.agent');
  };

  // Mới nhất ở trên cùng; bình luận chờ duyệt xếp xen vào bình luận thật theo giờ gửi.
  const thread = newestFirstThread(list.data ?? [], pending);

  return (
    <section aria-label={t('detail.comments.heading')} className="flex flex-col gap-5">
      {list.isLoading ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState
          title={t('detail.comments.loadFailed')}
          message={list.error.message}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {list.data?.length === 0 && pending.length === 0 ? <MutedText>{t('detail.comments.empty')}</MutedText> : null}
      {(live.data ?? []).map((run) => (
        <LiveRunTranscript key={run.id} run={run} agentName={agentNames[run.agentId] ?? t('detail.comments.agent')} />
      ))}
      {thread.map((entry) => {
        if (entry.type === 'pending') {
          return (
            <PendingComment
              key={`pending-${entry.item.id}`}
              contribution={entry.item}
              authorName={authorName(entry.item.authorUserId)}
              actions={<ContributionActions contribution={entry.item} />}
            />
          );
        }
        const c = entry.item;
        const human = !c.authorAgentId && !!c.authorUserId;
        const source = contributionByComment.get(c.id);
        const sourceName = source ? authorLabel(source) : null;
        const time = <time dateTime={String(c.createdAt)}>{formatDateTime(c.createdAt, lang)}</time>;
        return (
          <ChatMessage
            key={c.id}
            id={`comment-${c.id}`}
            data-testid="comment"
            kind={human ? 'human' : 'agent'}
            author={author(c)}
            footer={
              <>
                {human ? (
                  <>
                    {author(c)} · {time}
                  </>
                ) : (
                  time
                )}
                {sourceName ? (
                  <>
                    {' · '}
                    <ContributionChip name={sourceName} />
                  </>
                ) : null}
              </>
            }
          >
            <ExpandableContent
              maxLines={COLLAPSED_LINES}
              showMoreLabel={(count) => t('detail.comments.showMore', { count })}
              fadeTo={human ? 'var(--liveness-blue)' : undefined}
              showLessLabel={t('detail.comments.showLess')}
            >
              <MarkdownView markdown={c.body} />
            </ExpandableContent>
          </ChatMessage>
        );
      })}
    </section>
  );
}
