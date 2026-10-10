// Tab Vai trò (S8.2, S8.3): xem 4 vai trò và 3 ô runtime, sửa, lưu; đổi executor hay reviewer Codex thì render lại
// AGENTS.md của Trợ Lý. Ô runtime trống có lối thêm agent bằng wizard Tạo agent.
import type { Agent } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type ProjectRoles, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  CardDescription,
  ErrorState,
  PropertyList,
  ReadinessBadge,
  type ReadinessBadgeState,
  Spinner,
} from '@/ds';
import { useSelectableAgents } from '@/features/wizards';
import { useT } from '@/i18n';
import { agentOfSlot, type CrewRuntimeSlot, slotAgents } from '@/lib/instructions';
import { companyHref } from '../paths';
import { RolesForm } from './roles-form';
import { useRoleAgents } from './use-role-agents';
import { type InstructionsOutcome, InstructionsStepError, useSaveRoles } from './use-save-roles';

/** Ô hiện trên tab (khóa dịch `roles.slot.*`) và ô vai trò tương ứng. */
const SLOTS = [
  ['assistant', 'assistant'],
  ['executor1', 'executor'],
  ['executor2', 'executor-2'],
  ['reviewer', 'reviewer'],
  ['integrator', 'integrator'],
  ['executorCodex', 'executor-codex'],
  ['executorOpencode', 'executor-opencode'],
  ['reviewerCodex', 'reviewer-codex'],
] as const;
const RUNTIME_SLOTS: readonly CrewRuntimeSlot[] = ['executor-codex', 'executor-opencode', 'reviewer-codex'];

export function RolesTab({ projectId }: { projectId: string }) {
  const { t } = useT('projects');
  const { company } = useCompany();
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<InstructionsOutcome | 'failed' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<ProjectRoles | null>(null);
  const rolesQuery = useQuery({
    queryKey: queryKeys.roles(projectId),
    queryFn: async (): Promise<ProjectRoles | null> => {
      try {
        return await api.roles.get(company.id, projectId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  const agentsQuery = useQuery({ queryKey: queryKeys.agents(company.id), queryFn: () => api.agents.list(company.id) });
  const selectable = useSelectableAgents(company.id);
  // Người đang giữ ô vẫn hiện trong hộp chọn của ô đó, kể cả đã gỡ.
  const current = rolesQuery.data;
  const held = current ? slotAgents(current).map(([, id]) => id) : [];
  const { options, stateOf } = useRoleAgents(projectId, selectable(agentsQuery.data as Agent[] | undefined, held));
  const { save, retryInstructions } = useSaveRoles(projectId);

  if (rolesQuery.isLoading || agentsQuery.isLoading) return <Spinner />;
  const loadError = rolesQuery.error ?? agentsQuery.error;
  if (loadError) {
    return (
      <ErrorState
        title={t('roles.loadFailed')}
        message={loadError.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => {
          void rolesQuery.refetch();
          void agentsQuery.refetch();
        }}
      />
    );
  }
  const roles = rolesQuery.data ?? null;
  const nameOf = new Map((agentsQuery.data ?? []).map((a) => [a.id, a.name]));

  const retryAgain = (saved: ProjectRoles) =>
    retryInstructions.mutate(saved, {
      onSuccess: (res) => setOutcome(res),
      onError: (error) => {
        setFailure(error.message);
        setOutcome('failed');
      },
    });

  const submit = (next: ProjectRoles) => {
    setOutcome(null);
    save.mutate(
      { roles: next, previous: roles },
      {
        onSuccess: (res) => {
          setLastSaved(next);
          setOutcome(res.instructions);
          setEditing(false);
        },
        onError: (error) => {
          // POST roles lỗi thì form giữ nguyên và hiện message; lỗi sau khi đã lưu vai trò thì báo riêng.
          if (error instanceof InstructionsStepError) {
            setLastSaved(next);
            setFailure(error.message);
            setOutcome('failed');
            setEditing(false);
          }
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {roles ? null : <CardDescription>{t('roles.fileRoles')}</CardDescription>}
      {editing ? (
        <RolesForm
          roles={roles}
          agents={options}
          saving={save.isPending}
          error={save.error && !(save.error instanceof InstructionsStepError) ? save.error.message : null}
          onSubmit={submit}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {roles ? (
            <PropertyList
              items={SLOTS.map(([label, slot]) => {
                const id = agentOfSlot(roles, slot);
                const state = id ? stateOf(id) : undefined;
                return {
                  label: t(`roles.slot.${label}`),
                  value: id ? (
                    <span className="inline-flex items-center gap-2">
                      {nameOf.get(id) ?? t('roles.unknownAgent', { id })}
                      {state ? <ReadinessBadge state={state as ReadinessBadgeState} failed={[]} /> : null}
                    </span>
                  ) : (
                    t('roles.none')
                  ),
                };
              })}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing(true)}>{t('roles.edit')}</Button>
            {roles && roles.executorAgentIds.length < 2 ? (
              <Button asChild variant="outline">
                <Link
                  to={companyHref(
                    company.issuePrefix,
                    `agents/new?${new URLSearchParams({ project: projectId, slot: 'executor-2' })}`,
                  )}
                >
                  {t('roles.addExecutor')}
                </Link>
              </Button>
            ) : null}
            {roles
              ? RUNTIME_SLOTS.filter((slot) => !agentOfSlot(roles, slot)).map((slot) => (
                  <Button key={slot} asChild variant="outline">
                    <Link
                      to={companyHref(
                        company.issuePrefix,
                        `agents/new?${new URLSearchParams({ project: projectId, slot })}`,
                      )}
                    >
                      {t(`roles.addRuntime.${slot}`)}
                    </Link>
                  </Button>
                ))
              : null}
          </div>
        </>
      )}
      {outcome === 'conflict' ? (
        <ErrorState
          title={t('roles.instructions.conflict')}
          retryLabel={t('roles.instructions.retry')}
          onRetry={lastSaved && !retryInstructions.isPending ? () => retryAgain(lastSaved) : undefined}
        />
      ) : null}
      {outcome === 'failed' ? (
        <ErrorState title={t('roles.instructions.failed')} message={failure ?? undefined} />
      ) : null}
      {outcome === 'ok' || outcome === 'unchanged' ? (
        <p role="status">
          {t('roles.saved')} {t(`roles.instructions.${outcome}`)}
        </p>
      ) : null}
    </div>
  );
}
