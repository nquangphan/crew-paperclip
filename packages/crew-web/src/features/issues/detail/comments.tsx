// crew: tự dựng
import type { IssueComment } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import { api, queryKeys } from '@/api';
import { useMe } from '@/app/hooks';
import {
  Button,
  ChatDivider,
  ChatMessage,
  ErrorState,
  MarkdownView,
  MutedText,
  Skeleton,
  Transcript,
  type TranscriptEntry,
} from '@/ds';
import { ContributionActions } from '@/features/contributions/contribution-actions';
import { ContributionChip, isPendingComment, PendingComment } from '@/features/contributions/pending-comments';
import { useAuthorNames, useIssueContributions } from '@/features/contributions/use-contributions';
import { formatDateTime, useT } from '@/i18n';

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

/**
 * Nội dung bình luận cao quá {@link COLLAPSED_LINES} dòng thì thu gọn, có nút hiện đủ / thu gọn. Đo chiều cao thật
 * sau khi render (markdown có tiêu đề, code, ảnh nên không đếm dòng nguồn được); đổi kích thước thì đo lại.
 */
function CollapsibleBody({ markdown }: { markdown: string }) {
  const { t } = useT('issues');
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Khi đang mở hết thì so với chiều cao giới hạn tính từ line-height, không phải clientHeight.
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
      setOverflows(el.scrollHeight > lineHeight * COLLAPSED_LINES + 1);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const collapsed = overflows && !expanded;
  return (
    <div className="flex flex-col gap-1">
      <div
        ref={ref}
        data-collapsed={collapsed ? '' : undefined}
        className={collapsed ? 'relative max-h-[10lh] overflow-hidden' : undefined}
      >
        <MarkdownView markdown={markdown} />
      </div>
      {overflows ? (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="self-start px-0"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('detail.comments.showLess') : t('detail.comments.showMore')}
        </Button>
      ) : null}
    </div>
  );
}

interface CommentsProps {
  issueId: string;
  agentNames: Record<string, string>;
}

/**
 * Luồng trao đổi kiểu chat của Paperclip (S6.4): bình luận của người nằm phải trong bong bóng, của agent nằm trái
 * có tên; cuối luồng là transcript của run đang chạy. Không có nút like/dislike (BA mục 2: feedbackVote).
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
  const pending = contributions.filter(isPendingComment);
  const contributionByComment = new Map(
    contributions.flatMap((c) => (c.resultCommentId ? [[c.resultCommentId, c]] : [])),
  );

  const author = (c: IssueComment): string => {
    if (c.authorAgentId) return agentNames[c.authorAgentId] ?? t('detail.comments.agent');
    if (c.authorUserId) return c.authorUserId === me.id ? t('detail.comments.you') : t('detail.comments.user');
    return t('detail.comments.agent');
  };

  // Bình luận chờ duyệt xếp xen vào bình luận thật theo giờ gửi; bình luận thật đứng trước khi trùng giờ.
  const thread = [
    ...(list.data ?? []).map((item) => ({ type: 'comment' as const, item })),
    ...pending.map((item) => ({ type: 'pending' as const, item })),
  ].sort((a, b) => new Date(a.item.createdAt).getTime() - new Date(b.item.createdAt).getTime());

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
        const sourceName = source ? (authorName(source.authorUserId) ?? source.authorUserId) : null;
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
            <CollapsibleBody markdown={c.body} />
          </ChatMessage>
        );
      })}
      {(live.data ?? []).map((run) => (
        <LiveRunTranscript key={run.id} run={run} agentName={agentNames[run.agentId] ?? t('detail.comments.agent')} />
      ))}
    </section>
  );
}
