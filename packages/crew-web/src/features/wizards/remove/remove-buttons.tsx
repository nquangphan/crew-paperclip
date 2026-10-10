// Nút Gỡ project (S8.7) và Gỡ agent (S11.9) cho trang project/agent gắn vào header. Hộp xác nhận bắt gõ đúng tên, liệt
// kê những gì sẽ dừng/giữ; xác nhận thì tạo setup run gỡ (đã có lần gỡ dở thì plugin trả 409 kèm id → mở lần đó) rồi
// sang trang tiến độ. Lần gỡ dở thì nút thành "Chạy tiếp"; lần gỡ không bỏ được.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  api,
  type CrewMachine,
  type CrewRoleSlot,
  queryKeys,
  type RemoveAgentInput,
  type RemoveProjectInput,
  type SetupRun,
} from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Alert,
  Button,
  ConfirmDialog,
  MutedText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@/ds';
import { formatDateTime, type Lang, useT } from '@/i18n';
import { companyHref } from '../resume';
import { removeAgentEligibility } from './eligibility';
import { removalState } from './removal-state';
import { agentRunKey } from './remove-agent';
import {
  checkoutsOf,
  machineOf,
  projectKeyOf,
  projectRunOf,
  roleAgentIds,
  useAllRoles,
  useRemovalBase,
  useRemovalImpact,
} from './use-removal-data';

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Tạo setup run gỡ; 409 kèm `setupRunId` (lần gỡ dở cùng project/agent) → dùng lần đó. */
async function createRemoval(body: Parameters<typeof api.setup.create>[0]): Promise<string> {
  try {
    return (await api.setup.create(body)).id;
  } catch (error) {
    const dup = error instanceof ApiError ? (error.body as { setupRunId?: unknown } | null) : null;
    if (error instanceof ApiError && error.status === 409 && typeof dup?.setupRunId === 'string') return dup.setupRunId;
    throw error;
  }
}

function useStartRemoval(path: 'projects/remove' | 'agents/remove') {
  const { company } = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRemoval,
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew('crew.setupRuns') });
      navigate(companyHref(company.issuePrefix, `${path}?resume=${encodeURIComponent(id)}`), {
        state: { autostart: true },
      });
    },
  });
}

function ResumeLink({ run, path, label }: { run: SetupRun; path: string; label: string }) {
  const { company } = useCompany();
  return (
    <Button asChild variant="destructive">
      <Link to={companyHref(company.issuePrefix, `${path}?resume=${encodeURIComponent(run.id)}`)}>{label}</Link>
    </Button>
  );
}

function DisabledButton({ label, reason, children }: { label: string; reason?: string; children?: ReactNode }) {
  const reasonId = useId();
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button variant="destructive" disabled title={reason} aria-describedby={reason ? reasonId : undefined}>
          {label}
        </Button>
      </div>
      {reason ? <MutedText id={reasonId}>{reason}</MutedText> : null}
      {children}
    </div>
  );
}

function CheckoutLines({
  t,
  lang,
  checkouts,
}: {
  t: Translate;
  lang: Lang;
  checkouts: { path: string; clean: boolean | null; reportedAt: string }[];
}) {
  if (checkouts.length === 0) return <p>{t('remove.confirm.noCheckouts')}</p>;
  // Trạng thái sạch/bẩn lấy từ bản tin máy gần nhất, có thể cũ ~1 phút: ghi rõ mốc giờ, app kiểm lại khi gỡ.
  const at = formatDateTime(checkouts.map((c) => c.reportedAt).sort()[checkouts.length - 1], lang);
  return (
    <div className="flex flex-col gap-1">
      <p>{t('remove.confirm.checkouts')}</p>
      <MutedText>{t('remove.confirm.checkoutsReportedAt', { at })}</MutedText>
      <ul>
        {checkouts.map((c) => (
          <li key={c.path}>
            {t(
              c.clean === true
                ? 'remove.confirm.checkoutClean'
                : c.clean === false
                  ? 'remove.confirm.checkoutDirty'
                  : 'remove.confirm.checkoutUnknown',
              { path: c.path },
            )}
          </li>
        ))}
      </ul>
      <MutedText>{t('remove.confirm.checkoutsRecheck')}</MutedText>
    </div>
  );
}

function ImpactLines({ t, impact }: { t: Translate; impact: ReturnType<typeof useRemovalImpact> }) {
  if (impact.loading) return <Spinner />;
  if (impact.error) return <p>{t('remove.confirm.impactFailed', { message: impact.error.message })}</p>;
  return (
    <>
      <p>{t('remove.confirm.openIssues', { count: impact.openIssues })}</p>
      <p>{t('remove.confirm.activeRuns', { count: impact.activeRuns })}</p>
    </>
  );
}

function MachinePicker(props: {
  t: Translate;
  machines: readonly CrewMachine[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p>{props.t('remove.confirm.machine')}</p>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger aria-label={props.t('remove.confirm.machine')} className="w-full">
          <SelectValue placeholder={props.t('remove.confirm.machinePlaceholder')} />
        </SelectTrigger>
        <SelectContent position="popper">
          {props.machines.map((m) => (
            <SelectItem key={m.machineId} value={m.machineId}>
              {m.hostname}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function RemoveProjectButton({ project }: { project: { id: string; name: string } }) {
  const { t, lang } = useT('wizards');
  const { company } = useCompany();
  const base = useRemovalBase(company.id);
  const { roles } = useAllRoles(company.id);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const [missingMachine, setMissingMachine] = useState(false);
  const start = useStartRemoval('projects/remove');
  const projectRoles = roles.data?.get(project.id);
  const scope = projectRoles ? [...new Set(roleAgentIds(projectRoles))] : [];
  const impact = useRemovalImpact(company.id, open, { projectId: project.id }, scope);
  const label = t('removeProject.button');

  const queries = [base.setupRuns, base.agents, base.environments, base.machines, roles];
  if (queries.some((q) => q.isLoading)) return <DisabledButton label={label} />;
  const failed = queries.find((q) => q.error);
  if (failed?.error)
    return <DisabledButton label={label} reason={t('remove.loadFailed', { message: failed.error.message })} />;

  const runs = base.setupRuns.data ?? [];
  const state = removalState(runs, { projectId: project.id });
  if (state.status === 'removed') return null;
  if (state.run && state.status !== 'none') {
    return <ResumeLink run={state.run} path="projects/remove" label={t('removeProject.resume')} />;
  }

  const machines = base.machines.data ?? [];
  const key = projectKeyOf(project.id, {
    runs,
    roles: projectRoles,
    agents: base.agents.data ?? [],
    environments: base.environments.data ?? [],
  });
  if (!key) return <DisabledButton label={label} reason={t('remove.blocked.noKey')} />;
  if (machines.length === 0) return <DisabledButton label={label} reason={t('remove.blocked.noMachine')} />;
  const derived = machineOf(machines, projectRunOf(runs, project.id), key);
  const machineId = derived || picked;
  const agentNames = scope.map((id) => base.agents.data?.find((a) => a.id === id)?.name ?? id);

  const confirm = () => {
    if (!machineId) {
      setMissingMachine(true);
      return;
    }
    const input: RemoveProjectInput = { projectId: project.id, projectName: project.name };
    start.mutate({ companyId: company.id, kind: 'remove-project', projectKey: key, machineId, input });
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="destructive" disabled={start.isPending} onClick={() => setOpen(true)}>
          {label}
        </Button>
      </div>
      {missingMachine && !machineId ? <Alert variant="warning" title={t('remove.confirm.machineMissing')} /> : null}
      {start.error ? (
        <Alert variant="destructive" title={t('remove.createFailed')}>
          {start.error.message}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('removeProject.confirm.title', { name: project.name })}
        confirmLabel={label}
        destructive
        requireText={project.name}
        onConfirm={confirm}
        body={
          <div className="flex flex-col gap-2">
            <p>
              {agentNames.length > 0
                ? t('removeProject.confirm.agents', { names: agentNames.join(', ') })
                : t('removeProject.confirm.noAgents')}
            </p>
            <ImpactLines t={t} impact={impact} />
            <CheckoutLines t={t} lang={lang} checkouts={checkoutsOf(machines, key)} />
            {derived ? null : <MachinePicker t={t} machines={machines} value={picked} onChange={setPicked} />}
            <p>{t('removeProject.confirm.keeps')}</p>
          </div>
        }
      />
    </div>
  );
}

export function RemoveAgentButton({ agent }: { agent: { id: string; name: string; status: string } }) {
  const { t, lang } = useT('wizards');
  const { company } = useCompany();
  const base = useRemovalBase(company.id);
  const { projects, roles } = useAllRoles(company.id, agent.status !== 'terminated');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const [missingMachine, setMissingMachine] = useState(false);
  const start = useStartRemoval('agents/remove');
  const impact = useRemovalImpact(company.id, open, { assigneeAgentId: agent.id }, [agent.id]);
  const label = t('removeAgent.button');

  if (agent.status === 'terminated') return null;
  const queries = [base.setupRuns, base.agents, base.environments, base.machines, projects, roles];
  if (queries.some((q) => q.isLoading)) return <DisabledButton label={label} />;
  const failed = queries.find((q) => q.error);
  if (failed?.error)
    return <DisabledButton label={label} reason={t('remove.loadFailed', { message: failed.error.message })} />;

  const runs = base.setupRuns.data ?? [];
  const state = removalState(runs, { agentId: agent.id, agentStatus: agent.status });
  if (state.status === 'removed') return null;
  if (state.run && state.status !== 'none') {
    return <ResumeLink run={state.run} path="agents/remove" label={t('removeAgent.resume')} />;
  }

  const eligibility = removeAgentEligibility(agent, roles.data ?? new Map());
  if (eligibility.kind === 'hidden') return null;
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? id;
  if (eligibility.kind === 'blocked') {
    const { projectId } = eligibility;
    return (
      <DisabledButton
        label={label}
        reason={t(`removeAgent.blocked.${eligibility.reason}`, { project: projectName(projectId) })}
      >
        <div className="flex gap-4">
          <Link to={companyHref(company.issuePrefix, `projects/${projectId}?tab=roles`)}>
            {t('removeAgent.changeRoles')}
          </Link>
          <Link to={companyHref(company.issuePrefix, `projects/${projectId}`)}>{t('removeAgent.removeProject')}</Link>
        </div>
      </DisabledButton>
    );
  }

  const machines = base.machines.data ?? [];
  const { projectId, role } = eligibility;
  const key = projectId
    ? projectKeyOf(projectId, {
        runs,
        roles: roles.data?.get(projectId),
        agents: base.agents.data ?? [],
        environments: base.environments.data ?? [],
      })
    : agentRunKey(agent.id);
  if (!key) return <DisabledButton label={label} reason={t('remove.blocked.noKey')} />;
  if (machines.length === 0) return <DisabledButton label={label} reason={t('remove.blocked.noMachine')} />;
  // Agent không vai trò không có việc máy; plugin vẫn cần một máy cho run.
  const derived = projectId ? machineOf(machines, projectRunOf(runs, projectId), key) : (machines[0]?.machineId ?? '');
  const machineId = derived || picked;

  const confirm = () => {
    if (!machineId) {
      setMissingMachine(true);
      return;
    }
    const input: RemoveAgentInput = { agentId: agent.id, agentName: agent.name, projectId, role };
    start.mutate({ companyId: company.id, kind: 'remove-agent', projectKey: key, machineId, input });
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="destructive" disabled={start.isPending} onClick={() => setOpen(true)}>
          {label}
        </Button>
      </div>
      {missingMachine && !machineId ? <Alert variant="warning" title={t('remove.confirm.machineMissing')} /> : null}
      {start.error ? (
        <Alert variant="destructive" title={t('remove.createFailed')}>
          {start.error.message}
        </Alert>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('removeAgent.confirm.title', { name: agent.name })}
        confirmLabel={label}
        destructive
        requireText={agent.name}
        onConfirm={confirm}
        body={
          <div className="flex flex-col gap-2">
            <p>
              {projectId && role
                ? t('removeAgent.confirm.role', {
                    slot: t(`addAgent.slots.${role as CrewRoleSlot}`),
                    project: projectName(projectId),
                  })
                : t('removeAgent.confirm.noRole')}
            </p>
            <ImpactLines t={t} impact={impact} />
            {projectId && role ? (
              <CheckoutLines t={t} lang={lang} checkouts={checkoutsOf(machines, key, role)} />
            ) : null}
            {derived ? null : <MachinePicker t={t} machines={machines} value={picked} onChange={setPicked} />}
            <p>{t('removeAgent.confirm.keeps')}</p>
          </div>
        }
      />
    </div>
  );
}
