// Trạng thái đồng bộ một skill theo từng máy (S14.4): "đã có trên <máy>, hash <12 ký tự>", đang chờ, hoặc lỗi
// (đã làm sạch ở server) kèm nút Thử lại. Bản máy đang giữ vẫn hiện khi việc mới chờ hay lỗi. Việc gỡ bản chép
// (`skill-remove`, sau khi xóa skill) hiện riêng; `LeftoverCopies` liệt kê bản chép của skill đã xóa.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CrewMachine, SkillSyncState } from '@/api';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { Alert, Button, EmptyState, MutedText, Section, Spinner } from '@/ds';
import { RefreshCw } from '@/ds/icons';
import { useMachineJobs } from '@/features/machines/use-machines';
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
          if (state?.kind === 'skill-remove') {
            // Việc mới nhất của cặp là gỡ bản chép (skill vừa bị xóa): không hiện như đồng bộ.
            const removeLine: Record<SkillSyncState['status'], string> = {
              queued: t('sync.removeQueued', { host }),
              claimed: t('sync.removeClaimed', { host }),
              done: t('sync.removeClaimed', { host }),
              failed: t('sync.removeFailed', { host, error: state.errorText ?? t('sync.unknownError') }),
              cancelled: t('sync.removeCancelled', { host }),
            };
            line = removeLine[state.status];
            const failedJobId = state.status === 'failed' ? state.jobId : null;
            action = failedJobId ? (
              <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(failedJobId)}>
                <RefreshCw aria-hidden />
                {t('common:action.retry')}
              </Button>
            ) : null;
          } else if (!state) {
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
              {state && state.kind !== 'skill-remove' && state.status !== 'done' && held ? (
                <MutedText>{held}</MutedText>
              ) : null}
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

interface LeftoverCopiesProps {
  /** Id các skill còn tồn tại; trạng thái của skill khác là bản chép của skill đã xóa. */
  skillIds: readonly string[];
  machines: readonly CrewMachine[];
}

/**
 * Bản chép trên máy của skill đã xóa (S14.7): đang chờ/đang gỡ, gỡ lỗi (Thử lại), hoặc còn bản chép vì máy chưa
 * có app nhận việc lúc xóa (chờ app, hoặc nút Gỡ bản chép khi app đã chạy). Không có thì không hiện gì.
 */
export function LeftoverCopies({ skillIds, machines }: LeftoverCopiesProps) {
  const { t } = useT('skills');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const states = useSkillSyncStates(company.id);
  const jobs = useMachineJobs(company.id);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.crew() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.machineJobs(company.id) });
  };
  const retry = useMutation({
    mutationFn: (jobId: string) => api.jobs.retry(company.id, jobId),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (v: { machineId: string; skillId: string; slug: string }) =>
      api.jobs.create({
        companyId: company.id,
        machineId: v.machineId,
        kind: 'skill-remove',
        payload: { kind: 'skill-remove', skillId: v.skillId, slug: v.slug },
      }),
    onSettled: refresh,
  });

  const left = (states.data ?? []).filter((s) => !skillIds.includes(s.skillId));
  if (left.length === 0) return null;
  const slugOf = (state: SkillSyncState): string | null => {
    const payload = (jobs.data ?? []).find((j) => j.id === state.jobId)?.payload;
    return payload && 'slug' in payload ? payload.slug : null;
  };

  return (
    <Section title={t('leftover.title')}>
      <MutedText>{t('leftover.hint')}</MutedText>
      <ul className="flex flex-col gap-2">
        {left.map((state) => {
          const machine = machines.find((m) => m.machineId === state.machineId);
          const host = machine?.hostname ?? state.machineId;
          const slug = slugOf(state);
          const name = slug ?? state.skillId.slice(0, 8);
          let line: string;
          let action: ReactNode = null;
          if (state.kind === 'skill-remove' && state.status === 'failed') {
            line = t('leftover.failed', { name, host, error: state.errorText ?? t('sync.unknownError') });
            const jobId = state.jobId;
            action = jobId ? (
              <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(jobId)}>
                <RefreshCw aria-hidden />
                {t('common:action.retry')}
              </Button>
            ) : null;
          } else if (state.kind === 'skill-remove' && state.status === 'queued') {
            line = t('leftover.queued', { name, host });
          } else if (state.kind === 'skill-remove' && state.status === 'claimed') {
            line = t('leftover.claimed', { name, host });
          } else if (machine && hasJobsAgent(machine) && slug) {
            line = t('leftover.held', { name, host });
            action = (
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ machineId: machine.machineId, skillId: state.skillId, slug })}
              >
                {t('leftover.remove')}
              </Button>
            );
          } else {
            line = t('leftover.waitingApp', { name, host });
          }
          return (
            <li key={`${state.skillId}:${state.machineId}`} className="flex flex-wrap items-center gap-2">
              <span>{line}</span>
              {action}
            </li>
          );
        })}
      </ul>
      {retry.error || remove.error ? (
        <Alert variant="destructive" title={t('leftover.actionFailed')}>
          {(retry.error ?? remove.error)?.message}
        </Alert>
      ) : null}
    </Section>
  );
}
