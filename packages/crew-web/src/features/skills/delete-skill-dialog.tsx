// Xóa skill (S14.7): xác nhận gõ đúng slug, liệt kê agent đang bật và máy đã có bản chép; chạy các bước ở
// delete-skill.ts. Lỗi giữa chừng thì báo nguyên văn và có "Chạy tiếp" (không làm lại bước đã xong). Xong về danh
// sách skill, nơi hiện việc gỡ bản chép trên từng máy.
import type { CompanySkillDetail } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { type CrewMachine, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { companyPath } from '@/app/routes-util';
import { Alert, Button, ConfirmDialog, MutedText } from '@/ds';
import { RefreshCw } from '@/ds/icons';
import { useT } from '@/i18n';
import {
  type DeleteSkillProgress,
  deleteSkillDeps,
  newDeleteProgress,
  removalTargets,
  runDeleteSkill,
} from './delete-skill';
import { hasJobsAgent, invalidateSkills, useSkillSyncStates } from './use-skill-sync';

type DeletableSkill = Pick<CompanySkillDetail, 'id' | 'key' | 'slug' | 'name' | 'metadata' | 'usedByAgents'>;

const metaString = (meta: Record<string, unknown> | null, key: string): string | null =>
  typeof meta?.[key] === 'string' && meta[key] ? (meta[key] as string) : null;

/** Trạng thái và thao tác xóa một skill; trang chi tiết gắn dialog và khối báo lỗi vào chỗ của nó. */
export function useDeleteSkill(skill: DeletableSkill, machines: readonly CrewMachine[]) {
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const states = useSkillSyncStates(company.id);
  const progress = useRef<DeleteSkillProgress>(newDeleteProgress());
  const targets = removalTargets(
    skill.id,
    states.data ?? [],
    machines.map((m) => ({ machineId: m.machineId, hostname: m.hostname, canQueue: hasJobsAgent(m) })),
  );
  const agents = skill.usedByAgents.filter((a) => a.desired);

  const run = useMutation({
    mutationFn: () =>
      runDeleteSkill({
        target: {
          id: skill.id,
          key: skill.key,
          slug: skill.slug,
          agentIds: agents.map((a) => a.id),
          skillSourceId: metaString(skill.metadata, 'skillSourceId'),
          skillSourcePath: metaString(skill.metadata, 'skillSourcePath'),
        },
        queueMachineIds: targets.queue,
        deps: deleteSkillDeps(company.id, skill),
        progress: progress.current,
      }),
    // Lỗi giữa chừng: chỉ làm mới trạng thái máy; skill có thể đã bị xóa, đọc lại sẽ mất "Chạy tiếp".
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.crew() }),
    onSuccess: () => {
      invalidateSkills(queryClient, company.id);
      navigate(companyPath(company.issuePrefix, 'skills'), { state: { deletedSkill: skill.name } });
    },
  });
  return { run, agents, targets };
}

type DeleteState = ReturnType<typeof useDeleteSkill>;

interface DeleteSkillDialogProps {
  skill: DeletableSkill;
  state: DeleteState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteSkillDialog({ skill, state, open, onOpenChange }: DeleteSkillDialogProps) {
  const { t } = useT('skills');
  const { agents, targets } = state;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('delete.title', { name: skill.name })}
      confirmLabel={t('delete.confirm')}
      destructive
      requireText={skill.slug}
      onConfirm={() => state.run.mutate()}
      body={
        <div className="flex flex-col gap-2">
          <span>{t('delete.body')}</span>
          <span>{agents.length ? t('delete.agents') : t('delete.noAgents')}</span>
          {agents.length ? (
            <ul className="flex flex-col gap-1">
              {agents.map((a) => (
                <li key={a.id}>{a.name}</li>
              ))}
            </ul>
          ) : null}
          <span>{targets.hosts.length ? t('delete.machines') : t('delete.noMachines')}</span>
          {targets.hosts.length ? (
            <ul className="flex flex-col gap-1">
              {targets.hosts.map((host) => (
                <li key={host}>{host}</li>
              ))}
            </ul>
          ) : null}
          {targets.waiting.length ? <span>{t('delete.waitingApp', { hosts: targets.waiting.join(', ') })}</span> : null}
        </div>
      }
    />
  );
}

/** Đang xóa, hoặc lỗi giữa chừng kèm "Chạy tiếp". */
export function DeleteSkillStatus({ state }: { state: DeleteState }) {
  const { t } = useT('skills');
  const { run } = state;
  if (run.isPending) return <MutedText>{t('delete.running')}</MutedText>;
  if (!run.error) return null;
  return (
    <Alert variant="destructive" title={t('delete.failed')}>
      <div className="flex flex-col gap-2">
        <span>{run.error.message}</span>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => run.mutate()}>
            <RefreshCw aria-hidden />
            {t('delete.resume')}
          </Button>
        </div>
      </div>
    </Alert>
  );
}
