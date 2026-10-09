// crew: tự dựng
import type { HeartbeatRun } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CodeBlock,
  ConfirmDialog,
  ErrorState,
  IssueRow,
  MutedText,
  PageHeader,
  PropertyList,
  Skeleton,
  StatusBadge,
  Transcript,
  type TranscriptEntry,
} from '@/ds';
import { formatDateTime, useT } from '@/i18n';
import { formatRunLog, type RunAction, type RunActionId, runActionsFor, wakeupOutcome } from './run-actions';

const ACTIVE = new Set(['queued', 'running']);

/** Một dòng của GET /heartbeat-runs/:id/issues (server/src/services/activity.ts issuesForRun). */
interface TouchedIssue {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
}

function RunTranscript({ runId, active }: { runId: string; active: boolean }) {
  const { t } = useT('runs');
  const events = useQuery({
    queryKey: queryKeys.runEvents(runId),
    queryFn: () => api.runs.events(runId),
    refetchInterval: active ? 5_000 : false,
  });
  const entries: TranscriptEntry[] = (events.data ?? []).map((e) => ({
    id: String(e.id ?? e.seq),
    role: e.stream === 'stderr' || e.stream === 'system' ? 'system' : 'assistant',
    text: e.message ?? e.eventType,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('transcript.heading')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {events.error ? <ErrorState title={t('transcript.loadFailed')} message={events.error.message} /> : null}
        <Transcript entries={entries} defaultOpen />
      </CardContent>
    </Card>
  );
}

function RunLog({ runId, active }: { runId: string; active: boolean }) {
  const { t } = useT('runs');
  const log = useQuery({
    queryKey: queryKeys.runLog(runId),
    queryFn: () => api.runs.log(runId),
    refetchInterval: active ? 5_000 : false,
  });
  const missing = log.error instanceof ApiError && log.error.status === 404;
  const text = formatRunLog(log.data?.content);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('log.heading')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {log.error && !missing ? <ErrorState title={t('log.loadFailed')} message={log.error.message} /> : null}
        {missing || (!log.isLoading && !log.error && !text) ? <MutedText>{t('log.empty')}</MutedText> : null}
        {text ? <CodeBlock label={t('log.heading')} code={text} /> : null}
      </CardContent>
    </Card>
  );
}

function TouchedIssues({ runId, prefix }: { runId: string; prefix: string }) {
  const { t } = useT('runs');
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: queryKeys.runIssues(runId),
    queryFn: async () => (await api.runs.issues(runId)) as TouchedIssue[],
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('issues.heading')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col">
        {list.error ? <ErrorState title={t('issues.loadFailed')} message={list.error.message} /> : null}
        {list.data?.length === 0 ? <MutedText>{t('issues.empty')}</MutedText> : null}
        {(list.data ?? []).map((issue) => {
          const href = `/${prefix}/issues/${issue.identifier ?? issue.issueId}`;
          return (
            <IssueRow
              key={issue.issueId}
              identifier={issue.identifier ?? issue.issueId.slice(0, 8)}
              title={issue.title}
              status={issue.status}
              href={href}
              onOpen={() => navigate(href)}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Chi tiết run (S12): nội dung, log, yêu cầu liên quan; Dừng / Chạy lại / Tiếp tục đều qua hộp xác nhận. */
export function RunPage() {
  const { t, lang } = useT('runs');
  const { runId = '' } = useParams();
  const { company } = useCompany();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [asking, setAsking] = useState<RunActionId | null>(null);
  /** Server đã nhận yêu cầu chạy lại nhưng run mới chưa có: khóa nút để không gửi trùng. */
  const [queuedFor, setQueuedFor] = useState<string | null>(null);
  const queued = queuedFor === runId;

  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => api.runs.get(runId),
    refetchInterval: (query) => (ACTIVE.has(query.state.data?.status ?? '') ? 5_000 : false),
  });
  const agentId = run.data?.agentId;
  const agent = useQuery({
    queryKey: queryKeys.agent(agentId ?? ''),
    queryFn: () => api.agents.get(agentId as string, company.id),
    enabled: !!agentId,
  });

  const refresh = () => {
    for (const queryKey of [queryKeys.run(runId), queryKeys.runs(company.id), queryKeys.liveRuns(company.id)]) {
      void qc.invalidateQueries({ queryKey });
    }
  };
  const act = useMutation({
    mutationFn: async (action: RunAction): Promise<string | null> => {
      if (action.id === 'cancel') {
        await api.runs.cancel(runId);
        return null;
      }
      const outcome = wakeupOutcome(
        await api.agents.wakeup(run.data?.agentId as string, action.body as never, company.id),
      );
      if (outcome.kind === 'rejected') throw new Error(outcome.message ?? t('actions.skipped'));
      if (outcome.kind === 'queued') setQueuedFor(runId);
      return outcome.kind === 'created' ? outcome.runId : null;
    },
    onSuccess: (createdRunId) => {
      setAsking(null);
      refresh();
      if (createdRunId) navigate(`/${company.issuePrefix}/runs/${createdRunId}`);
    },
  });

  if (run.isLoading) return <Skeleton />;
  if (run.error) {
    const missing = run.error instanceof ApiError && run.error.status === 404;
    return (
      <ErrorState
        title={missing ? t('notFound') : t('loadFailed')}
        message={run.error.message}
        onRetry={() => void run.refetch()}
      />
    );
  }
  const data = run.data as HeartbeatRun & { contextSnapshot?: Record<string, unknown> | null };
  const actions = runActionsFor(data);
  const active = ACTIVE.has(data.status);
  const shortId = data.id.slice(0, 8);
  const none = t('meta.none');
  const pending = actions.find((a) => a.id === asking);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('title', { id: shortId })}
        description={t('description')}
        actions={actions.map((a) => (
          <Button
            key={a.id}
            variant={a.id === 'cancel' ? 'outline' : 'default'}
            size="sm"
            disabled={act.isPending || (queued && a.id !== 'cancel')}
            onClick={() => {
              act.reset();
              setAsking(a.id);
            }}
          >
            {t(`actions.${a.id}`)}
          </Button>
        ))}
      />
      {act.error && !asking ? <ErrorState title={t('actions.failed')} message={act.error.message} /> : null}
      {queued ? <Alert variant="info" title={t('actions.queued')} /> : null}
      <Card>
        <CardContent>
          <PropertyList
            items={[
              { label: t('meta.agent'), value: agent.data?.name ?? data.agentId },
              { label: t('meta.status'), value: <StatusBadge status={data.status} /> },
              { label: t('meta.started'), value: data.startedAt ? formatDateTime(String(data.startedAt), lang) : none },
              {
                label: t('meta.finished'),
                value: data.finishedAt ? formatDateTime(String(data.finishedAt), lang) : none,
              },
              ...(data.exitCode !== null && data.exitCode !== undefined
                ? [{ label: t('meta.exitCode'), value: String(data.exitCode) }]
                : []),
              ...(data.error || data.errorCode
                ? [{ label: t('meta.error'), value: [data.errorCode, data.error].filter(Boolean).join(': ') }]
                : []),
            ]}
          />
        </CardContent>
      </Card>
      <RunTranscript runId={data.id} active={active} />
      <RunLog runId={data.id} active={active} />
      <TouchedIssues runId={data.id} prefix={company.issuePrefix} />
      {asking ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          title={t(`confirm.${asking}Title`)}
          body={t(`confirm.${asking}Body`, { id: shortId })}
          confirmLabel={t(`actions.${asking}`)}
          destructive={asking === 'cancel'}
          onConfirm={() => pending && act.mutate(pending)}
        />
      ) : null}
    </div>
  );
}
