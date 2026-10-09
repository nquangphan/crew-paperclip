// crew: tự dựng
import type { IssueComment } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { useMe } from '@/app/hooks';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  MarkdownView,
  Skeleton,
  Transcript,
  type TranscriptEntry,
} from '@/ds';
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
      <h3>{t('detail.comments.liveRun', { name: agentName })}</h3>
      {events.error ? <ErrorState title={t('detail.comments.liveFailed')} message={events.error.message} /> : null}
      <Transcript entries={entries} />
    </section>
  );
}

interface CommentsProps {
  issueId: string;
  agentNames: Record<string, string>;
}

/** Luồng bình luận kèm transcript của run đang chạy (S6.4). */
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

  const author = (c: IssueComment): string => {
    if (c.authorAgentId) return agentNames[c.authorAgentId] ?? t('detail.comments.agent');
    if (c.authorUserId) return c.authorUserId === me.id ? t('detail.comments.you') : t('detail.comments.user');
    return t('detail.comments.agent');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.comments.heading')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {list.isLoading ? <Skeleton /> : null}
        {list.error ? (
          <ErrorState
            title={t('detail.comments.loadFailed')}
            message={list.error.message}
            onRetry={() => void list.refetch()}
          />
        ) : null}
        {list.data?.length === 0 ? <p>{t('detail.comments.empty')}</p> : null}
        {(list.data ?? []).map((c) => (
          <article key={c.id} data-testid="comment" className="flex flex-col gap-1">
            <header className="flex items-center gap-2">
              <strong>{author(c)}</strong>
              <time dateTime={String(c.createdAt)}>{formatDateTime(c.createdAt, lang)}</time>
            </header>
            <MarkdownView markdown={c.body} />
          </article>
        ))}
        {(live.data ?? []).map((run) => (
          <LiveRunTranscript key={run.id} run={run} agentName={agentNames[run.agentId] ?? t('detail.comments.agent')} />
        ))}
      </CardContent>
    </Card>
  );
}
