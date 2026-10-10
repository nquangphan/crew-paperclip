// Wizard Thêm project (S9). Không có `?resume=`: form bước 1 (máy, folder, khóa, tên, số executor) rồi tạo setup run.
// Có `?resume=<setupRunId>`: danh sách 7 bước theo setup run, chạy tiếp từ bước dở; lỗi hiện kèm nút "Chạy tiếp".
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { type AddProjectInput, ApiError, api, type CrewMachine, queryKeys, type SetupRun } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Alert,
  Button,
  Card,
  CardContent,
  ErrorState,
  Field,
  Input,
  MutedText,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@/ds';
import { useT } from '@/i18n';
import { companyHref } from '../resume';
import { type RunHooks, SetupProgress } from '../setup-progress';
import { runAddProject } from './run-step';
import { ADD_PROJECT_STEPS } from './steps';
import { type AddProjectForm, type AddProjectFormErrors, validateAddProject } from './validate';

const resumeSearch = (id: string) => `?resume=${encodeURIComponent(id)}`;

export function AddProjectPage() {
  const { t } = useT('wizards');
  const [params] = useSearchParams();
  const resume = params.get('resume');
  return (
    <>
      <PageHeader title={t('addProject.title')} description={t('addProject.description')} />
      {resume ? <AddProjectProgress key={resume} runId={resume} /> : <AddProjectFormView />}
    </>
  );
}

function hasJobsAgent(machine: CrewMachine): boolean {
  return Boolean((machine.latest as { jobsAgent?: unknown } | null)?.jobsAgent);
}

/** Folder đã kiểm thành công trên máy (việc inspect-folder done), mới nhất trước, không trùng. */
function inspectedFolders(jobs: { kind: string; status: string; result: unknown }[] | undefined): string[] {
  const roots = (jobs ?? []).flatMap((job) => {
    const result = job.result as { kind?: string; root?: unknown } | null;
    return job.kind === 'inspect-folder' && job.status === 'done' && typeof result?.root === 'string'
      ? [result.root]
      : [];
  });
  return [...new Set(roots)];
}

function AddProjectFormView() {
  const { t } = useT('wizards');
  const { company } = useCompany();
  const navigate = useNavigate();
  const [form, setForm] = useState<AddProjectForm>({ machineId: '', folder: '', key: '', name: '', executors: 1 });
  const [errors, setErrors] = useState<AddProjectFormErrors>({});
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const machines = useQuery({
    queryKey: queryKeys.crew('crew.machines', { companyId: company.id }),
    queryFn: () => api.crew.machines(company.id),
  });
  // Kể cả project đã gỡ và environment đã lưu trữ: khóa của chúng không dùng lại được (validate.ts).
  const projects = useQuery({
    queryKey: [...queryKeys.projects(company.id), 'archived'],
    queryFn: () => api.projects.list(company.id, { includeArchived: true }),
  });
  const environments = useQuery({
    queryKey: queryKeys.environments(company.id),
    queryFn: () => api.environments.list(company.id),
  });
  const jobs = useQuery({
    queryKey: queryKeys.crew('crew.machineJobs', { companyId: company.id, machineId: form.machineId, status: 'done' }),
    queryFn: () => api.crew.machineJobs(company.id, { machineId: form.machineId, status: 'done' }),
    enabled: form.machineId !== '',
  });

  const create = useMutation({
    mutationFn: (input: AddProjectInput) =>
      api.setup.create({
        companyId: company.id,
        kind: 'add-project',
        projectKey: input.key,
        machineId: form.machineId,
        input,
      }),
    onSuccess: (run) => navigate(resumeSearch(run.id), { state: { autostart: true } }),
    onError: (error) => {
      const body = error instanceof ApiError ? (error.body as { setupRunId?: unknown } | null) : null;
      setOpenRunId(
        error instanceof ApiError && error.status === 409 && typeof body?.setupRunId === 'string'
          ? body.setupRunId
          : null,
      );
    },
  });

  const set = <K extends keyof AddProjectForm>(key: K, value: AddProjectForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateAddProject(form, {
      companyName: company.name,
      projects: projects.data ?? [],
      environments: environments.data ?? [],
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate({
      name: form.name.trim(),
      key: form.key,
      folder: form.folder,
      executors: form.executors === 2 ? 2 : 1,
    });
  };

  const err = (key: keyof AddProjectForm) => (errors[key] ? t(errors[key]) : undefined);
  const machineList = machines.data ?? [];
  const suggestions = inspectedFolders(jobs.data);

  if (machines.isLoading) return <Spinner />;
  if (machines.error) {
    return (
      <ErrorState
        title={t('addProject.loadFailed')}
        message={machines.error.message}
        retryLabel={t('common:action.retry')}
        onRetry={() => void machines.refetch()}
      />
    );
  }

  return (
    <Card>
      <CardContent>
        <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
          <Field
            label={t('addProject.form.machine')}
            htmlFor="add-project-machine"
            hint={machineList.length === 0 ? t('addProject.form.noMachines') : t('addProject.form.machineHint')}
            error={err('machineId')}
          >
            <Select value={form.machineId} onValueChange={(v) => set('machineId', v)}>
              <SelectTrigger id="add-project-machine" className="w-full">
                <SelectValue placeholder={t('addProject.form.machinePlaceholder')} />
              </SelectTrigger>
              <SelectContent position="popper">
                {machineList.map((m) => (
                  <SelectItem key={m.machineId} value={m.machineId}>
                    {hasJobsAgent(m) ? m.hostname : t('addProject.form.machineNoApp', { name: m.hostname })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={t('addProject.form.folder')}
            htmlFor="add-project-folder"
            hint={t('addProject.form.folderHint')}
            error={err('folder')}
          >
            <Input
              id="add-project-folder"
              value={form.folder}
              autoComplete="off"
              onChange={(e) => set('folder', e.target.value)}
            />
          </Field>
          {suggestions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <MutedText>{t('addProject.form.suggestions')}</MutedText>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((root) => (
                  <Button key={root} type="button" variant="outline" size="sm" onClick={() => set('folder', root)}>
                    {root}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <Field
            label={t('addProject.form.key')}
            htmlFor="add-project-key"
            hint={t('addProject.form.keyHint')}
            error={err('key')}
          >
            <Input
              id="add-project-key"
              value={form.key}
              autoComplete="off"
              onChange={(e) => set('key', e.target.value.trim())}
            />
          </Field>

          <Field label={t('addProject.form.name')} htmlFor="add-project-name" error={err('name')}>
            <Input id="add-project-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>

          <Field label={t('addProject.form.executors')} htmlFor="add-project-executors" error={err('executors')}>
            <Select value={String(form.executors)} onValueChange={(v) => set('executors', Number(v))}>
              <SelectTrigger id="add-project-executors" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {create.error ? (
            <Alert variant="destructive" title={t('addProject.form.createFailed')}>
              <div className="flex flex-col gap-2">
                <span>{create.error.message}</span>
                {openRunId ? <Link to={resumeSearch(openRunId)}>{t('addProject.form.openRun')}</Link> : null}
              </div>
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending || projects.isLoading || environments.isLoading}>
              {t('addProject.form.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const runProject = (hooks: RunHooks, run: SetupRun) =>
  runAddProject({ api, t: hooks.t, onStep: hooks.onStep, onRun: hooks.onRun }, run);
const projectQueries = (run: SetupRun) => [queryKeys.projects(run.companyId)];

function AddProjectProgress({ runId }: { runId: string }) {
  const { t } = useT('wizards');
  return (
    <SetupProgress
      runId={runId}
      kind="add-project"
      prefix="addProject"
      steps={ADD_PROJECT_STEPS}
      run={runProject}
      invalidate={projectQueries}
      restartPath="projects/new"
      summary={(run) => {
        const input = run.input as AddProjectInput;
        return t('addProject.summary', { name: input.name, key: input.key, executors: input.executors });
      }}
      done={(run, prefix) => (
        <Alert title={t('addProject.done')}>
          {run.projectId ? (
            <Link to={companyHref(prefix, `projects/${run.projectId}`)}>{t('addProject.openProject')}</Link>
          ) : null}
        </Alert>
      )}
    />
  );
}
