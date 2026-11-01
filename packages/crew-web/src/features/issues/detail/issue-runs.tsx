// crew: tự dựng
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { Button, ConfirmDialog, DetailSection, ErrorState, MutedText, RunRow, Skeleton } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';

/** Một dòng của GET /issues/:id/runs (server/src/services/activity.ts runsForIssue). */
interface IssueRun {
  runId: string;
  status: string;
  agentId: string;
  startedAt: string | null;
  createdAt?: string | null;
}

const ACTIVE = new Set(['running', 'queued']);

/** Số run hiện sẵn (mới nhất trước); phần còn lại mở bằng nút Hiện thêm. Run đang chạy/xếp hàng luôn hiện. */
export const RUNS_COLLAPSED = 5;

/** Run của issue (S6.15): mở trang run, dừng run đang chạy/xếp hàng sau khi xác nhận; dài quá thì thu gọn còn 5. */
export function IssueRuns({ issueId, agentNames }: { issueId: string; agentNames: Record<string, string> }) {
  const { t } = useT('issues');
  const { company } = useCompany();
  const navigate = useNavigate();
  const { readOnly } = useCompanyAccess();
  const qc = useQueryClient();
  const [toStop, setToStop] = useState<IssueRun | null>(null);
  const [expanded, setExpanded] = useState(false);
  const list = useQuery({
    queryKey: queryKeys.issueRuns(issueId),
    queryFn: async () => (await api.runs.forIssue(issueId)) as IssueRun[],
  });
  const stop = useMutation({
    mutationFn: (runId: string) => api.runs.cancel(runId),
    onSuccess: () => {
      setToStop(null);
      void qc.invalidateQueries({ queryKey: queryKeys.issueRuns(issueId) });
      void qc.invalidateQueries({ queryKey: queryKeys.issueLiveRuns(issueId) });
      void qc.invalidateQueries({ queryKey: queryKeys.issue(issueId) });
    },
  });

  const runs = list.data ?? [];
  const shown = expanded ? runs : runs.filter((run, i) => i < RUNS_COLLAPSED || ACTIVE.has(run.status));
  const hidden = runs.length - shown.length;

  return (
    <DetailSection title={t('detail.runs.heading')} count={list.data?.length}>
      {list.isLoading ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState
          title={t('detail.runs.loadFailed')}
          message={list.error.message}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {list.data?.length === 0 ? <MutedText>{t('detail.runs.empty')}</MutedText> : null}
      {shown.map((run) => {
        const href = `/${company.issuePrefix}/runs/${run.runId}`;
        return (
          <div key={run.runId} data-testid="issue-run" className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <RunRow
                id={run.runId}
                status={run.status}
                agentName={agentNames[run.agentId] ?? t('detail.runs.unknownAgent')}
                startedAt={run.startedAt ?? run.createdAt}
                href={href}
                onOpen={() => navigate(href)}
              />
            </div>
            {ACTIVE.has(run.status) && !readOnly ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  stop.reset();
                  setToStop(run);
                }}
              >
                {t('detail.runs.stop')}
              </Button>
            ) : null}
          </div>
        );
      })}
      {hidden > 0 || (expanded && runs.length > RUNS_COLLAPSED) ? (
        <div className="flex">
          <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('detail.runs.showLess') : t('detail.runs.showMore', { count: hidden })}
          </Button>
        </div>
      ) : null}
      {stop.error ? <ErrorState title={t('detail.runs.stopFailed')} message={stop.error.message} /> : null}
      <ConfirmDialog
        open={toStop !== null}
        onOpenChange={(open) => {
          if (!open) setToStop(null);
        }}
        title={t('detail.runs.stopTitle')}
        body={t('detail.runs.stopBody', { id: toStop?.runId.slice(0, 8) ?? '' })}
        confirmLabel={t('detail.runs.stop')}
        destructive
        onConfirm={() => toStop && stop.mutate(toStop.runId)}
      />
    </DetailSection>
  );
}
