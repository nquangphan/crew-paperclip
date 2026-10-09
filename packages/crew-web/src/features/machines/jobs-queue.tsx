// Hàng đợi việc trên máy (S15.2): việc đang chờ, đang làm và lỗi; việc lỗi thử lại được (jobs.retry).
// Việc chờ quá 60 giây mà máy chưa có app 2P Crew nhận việc thì báo đang chờ app.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CrewMachine, MachineJob, MachineJobStatus } from '@/api';
import { api, queryKeys } from '@/api';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  MutedText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds';
import { RefreshCw } from '@/ds/icons';
import { Section } from '@/features/settings/section';
import { formatRelative, useT } from '@/i18n';

/** Việc chờ lâu hơn ngưỡng này mà máy chưa có app nhận việc thì báo "Chờ app 2P Crew". */
export const WAITING_APP_AFTER_MS = 60_000;

const SHOWN: readonly MachineJobStatus[] = ['queued', 'claimed', 'failed'];
const BADGE: Record<string, 'secondary' | 'default' | 'destructive'> = {
  queued: 'secondary',
  claimed: 'default',
  failed: 'destructive',
};

interface JobsQueueProps {
  companyId: string;
  jobs: readonly MachineJob[];
  machines: readonly CrewMachine[];
  now: number;
}

/** Mục kiểm của việc `check` (có cả khi việc lỗi). */
function checkItems(job: MachineJob): { id: string; status: string; title: string }[] {
  const result = job.result;
  return result && result.kind === 'check' ? result.items : [];
}

export function JobsQueue({ companyId, jobs, machines, now }: JobsQueueProps) {
  const { t, lang } = useT('machines');
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: (job: MachineJob) => api.jobs.retry(companyId, job.id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.machineJobs(companyId) });
    },
  });
  const rows = jobs.filter((j) => SHOWN.includes(j.status));
  const machineOf = (id: string) => machines.find((m) => m.machineId === id);

  return (
    <Section title={t('queue.title')}>
      {retry.error ? (
        <Alert variant="destructive" title={t('queue.retryFailed')}>
          {retry.error.message}
        </Alert>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={t('queue.empty')} description={t('queue.emptyHint')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('queue.col.machine')}</TableHead>
              <TableHead>{t('queue.col.kind')}</TableHead>
              <TableHead>{t('queue.col.status')}</TableHead>
              <TableHead>{t('queue.col.created')}</TableHead>
              <TableHead>{t('queue.col.detail')}</TableHead>
              <TableHead>{t('queue.col.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((job) => {
              const machine = machineOf(job.machineId);
              const host = machine?.hostname ?? job.machineId.slice(0, 8);
              const waitingApp =
                job.status === 'queued' &&
                now - Date.parse(job.createdAt) > WAITING_APP_AFTER_MS &&
                !machine?.latest.jobsAgent;
              const items = checkItems(job);
              return (
                <TableRow key={job.id}>
                  <TableCell>{host}</TableCell>
                  <TableCell>{t(`queue.kind.${job.kind}`)}</TableCell>
                  <TableCell>
                    <Badge variant={BADGE[job.status]}>{t(`queue.status.${job.status}`)}</Badge>
                  </TableCell>
                  <TableCell>{formatRelative(job.createdAt, lang, new Date(now))}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {waitingApp ? <MutedText>{t('queue.waitingApp', { host })}</MutedText> : null}
                      {job.status === 'failed' && job.errorText ? <span>{job.errorText}</span> : null}
                      {items.length ? (
                        <ul>
                          {items.map((item) => (
                            <li key={item.id}>{item.title}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {job.status === 'failed' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={retry.isPending}
                        aria-label={t('common:action.retry')}
                        onClick={() => retry.mutate(job)}
                      >
                        <RefreshCw aria-hidden />
                        {t('common:action.retry')}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
