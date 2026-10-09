// Trạng thái đồng bộ một skill theo từng máy (S14.4): "đã có trên <máy>, hash <12 ký tự>", đang chờ, hoặc lỗi
// (đã làm sạch ở server) kèm nút Thử lại. Bản máy đang giữ vẫn hiện khi việc mới chờ hay lỗi.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CrewMachine, SkillSyncState } from '@/api';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { Alert, Button, EmptyState, MutedText, Spinner } from '@/ds';
import { RefreshCw } from '@/ds/icons';
import { formatDateTime, useT } from '@/i18n';
import { hasJobsAgent, queueSkillSync, type SyncSkill, useSkillSyncStates } from './use-skill-sync';

const HASH_LENGTH = 12;

interface SyncStatusProps {
  skill: SyncSkill;
  machines: readonly CrewMachine[];
}

export function SyncStatus({ skill, machines }: SyncStatusProps) {
  const { t, lang } = useT('skills');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const states = useSkillSyncStates(company.id);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.crew() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.machineJobs(company.id) });
  };
  const retry = useMutation({
    mutationFn: (jobId: string) => api.jobs.retry(company.id, jobId),
    onSettled: refresh,
  });
  const sync = useMutation({
    mutationFn: (machineId: string) => queueSkillSync(company.id, machineId, skill),
    onSettled: refresh,
  });

  if (states.isLoading) return <Spinner label={t('sync.loading')} />;
  if (machines.length === 0) return <EmptyState title={t('sync.noMachines')} />;
  const stateOf = (machineId: string): SkillSyncState | undefined =>
    states.data?.find((s) => s.skillId === skill.id && s.machineId === machineId);

  return (
    <div className="flex flex-col gap-2">
      {states.error ? (
        <Alert variant="destructive" title={t('sync.loadFailed')}>
          {states.error.message}
        </Alert>
      ) : null}
      <ul className="flex flex-col gap-2">
        {machines.map((machine) => {
          const host = machine.hostname;
          const state = stateOf(machine.machineId);
          const held = state?.sha256 ? t('sync.held', { hash: state.sha256.slice(0, HASH_LENGTH) }) : null;
          const canQueue = hasJobsAgent(machine);
          const syncButton = (label: string) =>
            canQueue ? (
              <Button
                variant="outline"
                size="sm"
                disabled={sync.isPending}
                onClick={() => sync.mutate(machine.machineId)}
              >
                <RefreshCw aria-hidden />
                {label}
              </Button>
            ) : null;
          let line: string;
          let action: ReactNode = null;
          if (!state) {
            line = canQueue ? t('sync.none', { host }) : t('sync.waitingApp', { host });
            action = syncButton(t('sync.syncNow'));
          } else if (state.status === 'done') {
            line = state.sha256
              ? t('sync.done', { host, hash: state.sha256.slice(0, HASH_LENGTH) })
              : t('sync.doneNoHash', { host });
            action = syncButton(t('sync.resync'));
          } else if (state.status === 'queued') {
            line = t('sync.queued', { host });
          } else if (state.status === 'claimed') {
            line = t('sync.claimed', { host });
          } else if (state.status === 'failed') {
            line = t('sync.failed', { host, error: state.errorText ?? t('sync.unknownError') });
            const failedJobId = state.jobId;
            action = failedJobId ? (
              <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(failedJobId)}>
                <RefreshCw aria-hidden />
                {t('common:action.retry')}
              </Button>
            ) : (
              syncButton(t('sync.syncNow'))
            );
          } else {
            line = t('sync.cancelled', { host });
            action = syncButton(t('sync.syncNow'));
          }
          return (
            <li key={machine.machineId} className="flex flex-wrap items-center gap-2">
              <span>{line}</span>
              {state?.status === 'done' && state.finishedAt ? (
                <MutedText>{formatDateTime(state.finishedAt, lang)}</MutedText>
              ) : null}
              {state && state.status !== 'done' && held ? <MutedText>{held}</MutedText> : null}
              {action}
            </li>
          );
        })}
      </ul>
      {retry.error ? (
        <Alert variant="destructive" title={t('sync.retryFailed')}>
          {retry.error.message}
        </Alert>
      ) : null}
      {sync.error ? (
        <Alert variant="destructive" title={t('sync.syncFailed')}>
          {sync.error.message}
        </Alert>
      ) : null}
    </div>
  );
}
