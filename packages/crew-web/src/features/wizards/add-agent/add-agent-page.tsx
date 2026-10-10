// Wizard Tạo agent (S13): thêm executor thứ 2 hoặc thay agent của một ô vai trò. Ba lối vào:
// - `?project=<id>&slot=<ô>` (hoặc không gì): form bước 1 rồi tạo setup run `add-agent`;
// - `?fix=<agentId>&step=<bước>[&rewrite=1]`: "Làm tiếp" từ trạng thái sẵn sàng cho agent chưa có lần tạo dở (agent do
//   app tạo): bỏ các bước trước, sửa từ bước được chỉ; agent đã có lần tạo dở thì chuyển sang chạy tiếp lần đó.
//   `rewrite=1` (AGENTS.md lệch) mới ghi lại AGENTS.md của agent có sẵn;
// - `?resume=<setupRunId>`: 6 bước theo setup run, chạy tiếp từ bước dở.
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  type AddAgentInput,
  type AddProjectInput,
  api,
  type CrewMachine,
  type CrewRoleSlot,
  type ProjectRoles,
  queryKeys,
  type SetupRun,
} from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Alert,
  Button,
  Card,
  CardContent,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@/ds';
import { useT } from '@/i18n';
import {
  agentOfSlot,
  CREW_MODELS,
  defaultModelOf,
  isRuntimeSlot,
  runtimeOfSlot,
  slotAgents,
  slotModels,
  slotOfAgent,
} from '@/lib/instructions';
import { companyHref, findAgentRun } from '../resume';
import { type RunHooks, SetupProgress } from '../setup-progress';
import { type AddAgentSeed, prepareFixRun, runAddAgent } from './run-step';
import { ADD_AGENT_STEPS, type AddAgentStepId, isAddAgentStep, ROLE_SLOTS } from './steps';
import { type AddAgentForm, type AddAgentFormErrors, validateAddAgent } from './validate';

const resumeSearch = (id: string) => `?resume=${encodeURIComponent(id)}`;

type FixTarget = { agentId: string; step: AddAgentStepId; rewrite: boolean };

export function AddAgentPage() {
  const { t } = useT('wizards');
  const [params] = useSearchParams();
  const resume = params.get('resume');
  const fixId = params.get('fix');
  const step = params.get('step');
  const fix: FixTarget | null = fixId
    ? { agentId: fixId, step: isAddAgentStep(step) ? step : 'agent', rewrite: params.get('rewrite') === '1' }
    : null;
  return (
    <>
      <PageHeader title={t('addAgent.title')} description={t('addAgent.description')} />
      {resume ? (
        <AddAgentProgress key={resume} runId={resume} />
      ) : (
        <AddAgentFormView
          key={fixId ?? 'new'}
          fix={fix}
          initialProject={params.get('project') ?? ''}
          initialSlot={params.get('slot') ?? ''}
        />
      )}
    </>
  );
}

/** Agent đang ở ô (để báo "sẽ thay"). */
function holderOf(roles: ProjectRoles | null | undefined, slot: string): string | null {
  if (!roles || !(ROLE_SLOTS as readonly string[]).includes(slot)) return null;
  return agentOfSlot(roles, slot as CrewRoleSlot);
}

const CHECKOUT_KEY_RE = /\/crew-agents\/([a-z][a-z0-9-]{1,30})\/[^/]+$/;

function AddAgentFormView({
  fix,
  initialProject,
  initialSlot,
}: {
  fix: FixTarget | null;
  initialProject: string;
  initialSlot: string;
}) {
  const { t } = useT('wizards');
  const { company } = useCompany();
  const navigate = useNavigate();
  const [overrides, setOverrides] = useState<Partial<AddAgentForm>>({});
  const [errors, setErrors] = useState<AddAgentFormErrors>({});

  const machines = useQuery({
    queryKey: queryKeys.crew('crew.machines', { companyId: company.id }),
    queryFn: () => api.crew.machines(company.id),
  });
  const projects = useQuery({
    queryKey: queryKeys.projects(company.id),
    queryFn: () => api.projects.list(company.id),
  });
  const agents = useQuery({ queryKey: queryKeys.agents(company.id), queryFn: () => api.agents.list(company.id) });
  const environments = useQuery({
    queryKey: queryKeys.environments(company.id),
    queryFn: () => api.environments.list(company.id),
  });
  const setupRuns = useQuery({
    queryKey: queryKeys.crew('crew.setupRuns', { companyId: company.id }),
    queryFn: () => api.crew.setupRuns(company.id),
  });
  const activeProjects = useMemo(() => (projects.data ?? []).filter((p) => !p.archivedAt), [projects.data]);
  const roles = useQuery({
    queryKey: ['wizards', 'roles', company.id, activeProjects.map((p) => p.id)],
    enabled: projects.isSuccess,
    queryFn: async () => {
      const entries = await Promise.all(
        activeProjects.map(async (p) => {
          try {
            return [p.id, await api.roles.get(company.id, p.id)] as const;
          } catch (error) {
            if ((error as { status?: number }).status === 404) return [p.id, null] as const;
            throw error;
          }
        }),
      );
      return new Map<string, ProjectRoles | null>(entries);
    },
  });

  const fixAgent = fix ? agents.data?.find((a) => a.id === fix.agentId) : undefined;
  const holding = useMemo(() => {
    if (!fix || !roles.data) return null;
    for (const [projectId, r] of roles.data) {
      const slot = r ? slotOfAgent(r, fix.agentId) : null;
      if (slot) return { projectId, slot };
    }
    return null;
  }, [fix, roles.data]);

  // Chế độ sửa: agent đang giữ ô thì project và ô cố định theo vai trò (đổi ô thì một agent nằm hai ô).
  const projectId = holding?.projectId ?? overrides.projectId ?? initialProject;
  const slot = holding?.slot ?? overrides.slot ?? initialSlot;
  const projectRoles = roles.data?.get(projectId);
  const runs = setupRuns.data ?? [];
  const projectRun = runs
    .filter((r) => r.kind === 'add-project' && r.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  // Khóa, folder, máy: lấy từ lần thêm project của project; project do app tạo thì suy khóa từ checkout của agent vai trò.
  const derivedKey = (() => {
    if (projectRun) return projectRun.projectKey;
    if (!projectRoles) return '';
    const ids = new Set(slotAgents(projectRoles).map(([, id]) => id));
    for (const a of agents.data ?? []) {
      if (!ids.has(a.id)) continue;
      const env = environments.data?.find((e) => e.id === a.defaultEnvironmentId);
      const path = env?.config.remoteWorkspacePath;
      const match = typeof path === 'string' ? CHECKOUT_KEY_RE.exec(path) : null;
      if (match?.[1]) return match[1];
    }
    return '';
  })();
  // Suy được khóa thì khóa cố định: checkout, environment và job dựng theo khóa này phải là của chính project.
  const keyLocked = derivedKey !== '';
  const key = keyLocked ? derivedKey : (overrides.key ?? '');
  const derivedFolder =
    projectRun?.steps.inspect?.refs?.root ?? (projectRun ? (projectRun.input as AddProjectInput).folder : '');
  const machineList = machines.data ?? [];
  const derivedMachine = projectRun?.machineId ?? (machineList.length === 1 ? (machineList[0]?.machineId ?? '') : '');
  const taken = (name: string) => (agents.data ?? []).some((a) => a.name === name && a.status !== 'terminated');
  const derivedName = (() => {
    if (fixAgent) return fixAgent.name;
    if (!key || !slot) return '';
    const base = `${key}-${slot}`;
    for (let n = 1; ; n += 1) {
      const name = n === 1 ? base : `${base}-${n}`;
      if (!taken(name)) return name;
    }
  })();
  // Model theo runtime của ô: chọn ô khác thì model đã chọn (của runtime cũ) bỏ, về mặc định của ô.
  const knownSlot = (ROLE_SLOTS as readonly string[]).includes(slot) ? (slot as CrewRoleSlot) : null;
  const models: readonly string[] = knownSlot ? slotModels(knownSlot) : CREW_MODELS;
  const agentModel = fixAgent?.adapterConfig.model;
  const derivedModel =
    typeof agentModel === 'string' && models.includes(agentModel)
      ? agentModel
      : knownSlot
        ? defaultModelOf(knownSlot)
        : '';
  const chosenModel =
    overrides.model !== undefined && models.includes(overrides.model) ? overrides.model : derivedModel;

  const form: AddAgentForm = {
    projectId,
    slot,
    name: fix ? derivedName : (overrides.name ?? derivedName),
    model: fix ? derivedModel : chosenModel,
    machineId: overrides.machineId ?? derivedMachine,
    key,
    folder: overrides.folder ?? derivedFolder,
  };
  const set = <K extends keyof AddAgentForm>(field: K, value: AddAgentForm[K]) =>
    setOverrides((o) => ({ ...o, [field]: value }));

  const create = useMutation({
    mutationFn: async (input: AddAgentInput) => {
      const run = await api.setup.create({
        companyId: company.id,
        kind: 'add-agent',
        projectKey: form.key,
        machineId: form.machineId,
        input,
      });
      const seed: AddAgentSeed = {
        folder: form.folder,
        ...(fix ? { agent: fix.agentId } : {}),
        ...(fix?.rewrite ? { rewrite: 'true' } : {}),
      };
      const translate = (k: string, p?: Record<string, unknown>) => t(k, p);
      if (fix) await prepareFixRun({ api, t: translate, seed }, run, fix);
      return { run, seed };
    },
    onSuccess: ({ run, seed }) => navigate(resumeSearch(run.id), { state: { autostart: true, seed } }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateAddAgent(form, { companyName: company.name, agents: agents.data ?? [], fix: fix !== null });
    if (projectId && projectRoles === null) found.projectId = 'validate.projectNoRoles';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate({
      projectId: form.projectId,
      slot: form.slot as CrewRoleSlot,
      name: form.name.trim(),
      model: form.model,
    });
  };

  const queries = [machines, projects, agents, environments, setupRuns, roles];
  const failed = queries.find((q) => q.error);
  if (failed?.error) {
    return (
      <ErrorState
        title={t('addAgent.loadFailed')}
        message={failed.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => {
          for (const q of queries) void q.refetch();
        }}
      />
    );
  }
  if (queries.some((q) => q.isLoading)) return <Spinner />;

  if (fix) {
    const open = findAgentRun(runs, fix.agentId);
    if (open) return <Navigate replace to={resumeSearch(open.id)} />;
    if (!fixAgent) return <Alert variant="warning" title={t('addAgent.fix.notFound')} />;
  }

  const err = (field: keyof AddAgentForm) => (errors[field] ? t(errors[field]) : undefined);
  const holder = holderOf(projectRoles, slot);
  const holderName = holder ? (agents.data?.find((a) => a.id === holder)?.name ?? holder) : null;
  const holderHint = !slot
    ? undefined
    : holder === fix?.agentId && holder
      ? t('addAgent.form.slotSelf')
      : holderName
        ? t('addAgent.form.slotReplaces', { name: holderName })
        : t('addAgent.form.slotAdds');
  // Ô runtime: nhắc công tắc runtime theo máy (mặc định tắt) ở trang Máy.
  const slotHint =
    holderHint && knownSlot && isRuntimeSlot(knownSlot)
      ? `${holderHint} ${t('addAgent.form.runtimeHint', { runtime: runtimeOfSlot(knownSlot) })}`
      : holderHint;

  return (
    <Card>
      <CardContent>
        <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
          {fix && fixAgent ? (
            <Alert title={t('addAgent.fix.title', { name: fixAgent.name, step: t(`addAgent.steps.${fix.step}`) })}>
              {t('addAgent.fix.description')}
            </Alert>
          ) : null}

          <Field label={t('addAgent.form.project')} htmlFor="add-agent-project" error={err('projectId')}>
            <Select value={projectId} onValueChange={(v) => set('projectId', v)} disabled={holding !== null}>
              <SelectTrigger id="add-agent-project" className="w-full">
                <SelectValue placeholder={t('addAgent.form.projectPlaceholder')} />
              </SelectTrigger>
              <SelectContent position="popper">
                {activeProjects.map((p) => {
                  const noRoles = roles.data?.get(p.id) === null;
                  return (
                    <SelectItem key={p.id} value={p.id} disabled={noRoles}>
                      {noRoles ? t('addAgent.form.projectNoRoles', { name: p.name }) : p.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t('addAgent.form.slot')} htmlFor="add-agent-slot" hint={slotHint} error={err('slot')}>
            <Select value={slot} onValueChange={(v) => set('slot', v)} disabled={holding !== null}>
              <SelectTrigger id="add-agent-slot" className="w-full">
                <SelectValue placeholder={t('addAgent.form.slotPlaceholder')} />
              </SelectTrigger>
              <SelectContent position="popper">
                {ROLE_SLOTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`addAgent.slots.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {fix ? null : (
            <>
              <Field
                label={t('addAgent.form.name')}
                htmlFor="add-agent-name"
                hint={t('addAgent.form.nameHint')}
                error={err('name')}
              >
                <Input id="add-agent-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field
                label={t('addAgent.form.model')}
                htmlFor="add-agent-model"
                hint={
                  knownSlot === 'reviewer-codex'
                    ? t('addAgent.form.modelFixed')
                    : knownSlot && isRuntimeSlot(knownSlot)
                      ? t('addAgent.form.modelHintRuntime', { runtime: runtimeOfSlot(knownSlot) })
                      : t('addAgent.form.modelHint')
                }
                error={err('model')}
              >
                <Select
                  value={form.model}
                  onValueChange={(v) => set('model', v)}
                  disabled={knownSlot === 'reviewer-codex'}
                >
                  <SelectTrigger id="add-agent-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}

          <Field
            label={t('addAgent.form.machine')}
            htmlFor="add-agent-machine"
            hint={machineList.length === 0 ? t('addAgent.form.noMachines') : undefined}
            error={err('machineId')}
          >
            <Select value={form.machineId} onValueChange={(v) => set('machineId', v)}>
              <SelectTrigger id="add-agent-machine" className="w-full">
                <SelectValue placeholder={t('addAgent.form.machinePlaceholder')} />
              </SelectTrigger>
              <SelectContent position="popper">
                {machineList.map((m: CrewMachine) => (
                  <SelectItem key={m.machineId} value={m.machineId}>
                    {m.hostname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={t('addAgent.form.key')}
            htmlFor="add-agent-key"
            hint={keyLocked ? t('addAgent.form.keyLocked') : t('addAgent.form.keyHint')}
            error={err('key')}
          >
            <Input
              id="add-agent-key"
              value={form.key}
              autoComplete="off"
              readOnly={keyLocked}
              onChange={(e) => set('key', e.target.value.trim())}
            />
          </Field>

          <Field
            label={t('addAgent.form.folder')}
            htmlFor="add-agent-folder"
            hint={t('addAgent.form.folderHint')}
            error={err('folder')}
          >
            <Input
              id="add-agent-folder"
              value={form.folder}
              autoComplete="off"
              onChange={(e) => set('folder', e.target.value)}
            />
          </Field>

          {create.error ? (
            <Alert variant="destructive" title={t('addAgent.form.createFailed')}>
              {create.error.message}
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {fix ? t('addAgent.fix.submit') : t('addAgent.form.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const runAgent = (hooks: RunHooks, run: SetupRun, state: unknown) =>
  runAddAgent(
    {
      api,
      t: hooks.t,
      onStep: hooks.onStep,
      onRun: hooks.onRun,
      seed: (state as { seed?: AddAgentSeed } | null)?.seed,
    },
    run,
  );
const agentQueries = (run: SetupRun) => [
  queryKeys.agents(run.companyId),
  queryKeys.environments(run.companyId),
  queryKeys.roles((run.input as AddAgentInput).projectId),
];

function AddAgentProgress({ runId }: { runId: string }) {
  const { t } = useT('wizards');
  return (
    <SetupProgress
      runId={runId}
      kind="add-agent"
      prefix="addAgent"
      steps={ADD_AGENT_STEPS}
      run={runAgent}
      invalidate={agentQueries}
      summary={(run) => {
        const input = run.input as AddAgentInput;
        return t('addAgent.summary', {
          name: input.name,
          slot: t(`addAgent.slots.${input.slot}`),
          key: run.projectKey,
        });
      }}
      done={(run, prefix) => {
        const agentId = run.steps.agent?.refs?.agent;
        return (
          <Alert title={t('addAgent.done')}>
            <div className="flex gap-4">
              {agentId ? <Link to={companyHref(prefix, `agents/${agentId}`)}>{t('addAgent.openAgent')}</Link> : null}
              {run.projectId ? (
                <Link to={companyHref(prefix, `projects/${run.projectId}`)}>{t('addAgent.openProject')}</Link>
              ) : null}
            </div>
          </Alert>
        );
      }}
    />
  );
}
