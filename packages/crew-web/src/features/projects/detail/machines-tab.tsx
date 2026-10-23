// Tab Máy của project: máy đã ghép và trạng thái dựng project trên từng máy, Thêm máy, origin và repo đi kèm.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type ProjectMachine, type ProjectRepo, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Field,
  Input,
  MutedText,
  Spinner,
} from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { formatDateTime, useT } from '@/i18n';

/** Tự làm mới khi còn máy đang dựng project. */
export const PROJECT_MACHINES_REFRESH_MS = 10_000;

export function MachinesTab({ projectId }: { projectId: string }) {
  const { t } = useT('projects');
  const { company } = useCompany();
  const { isOwner } = useCompanyAccess();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.projectMachines(projectId),
    queryFn: () => api.machinePins.projectMachines(company.id, projectId),
    refetchInterval: (q) =>
      q.state.data?.machines.some((machine) => machine.status === 'provisioning') ? PROJECT_MACHINES_REFRESH_MS : false,
  });
  const add = useMutation({
    mutationFn: (machineId: string) => api.machinePins.addMachine(company.id, projectId, machineId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.projectMachines(projectId) }),
  });
  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <ErrorState title={t('machines.loadFailed')} message={query.error?.message} />;
  const { repo, machines } = query.data;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('machines.title')}</CardTitle>
          <CardDescription>{t('machines.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {machines.length === 0 ? (
            <p>{t('machines.unpaired')}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="project-machines">
              {machines.map((machine) => (
                <MachineRow
                  key={machine.machineId}
                  machine={machine}
                  canAdd={isOwner && machine.online && (machine.status === null || machine.status === 'failed')}
                  busy={add.isPending}
                  onAdd={() => add.mutate(machine.machineId)}
                />
              ))}
            </ul>
          )}
          {add.error ? <ErrorState title={t('machines.addFailed')} message={add.error.message} /> : null}
        </CardContent>
      </Card>
      <RepoCard key={JSON.stringify(repo)} projectId={projectId} repo={repo} canEdit={isOwner} />
    </div>
  );
}

function MachineRow({
  machine,
  canAdd,
  busy,
  onAdd,
}: {
  machine: ProjectMachine;
  canAdd: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const { t, lang } = useT('projects');
  return (
    <li className="flex flex-wrap items-center gap-2">
      <strong>{machine.hostname}</strong>
      <Badge variant={machine.online ? 'secondary' : 'outline'}>
        {t(machine.online ? 'machines.online' : 'machines.offline')}
      </Badge>
      <span>{t(`machines.status.${machine.status ?? 'none'}`)}</span>
      {machine.error ? <Badge variant="destructive">{machine.error}</Badge> : null}
      {machine.repoPath ? <MutedText>{t('machines.repoPath', { path: machine.repoPath })}</MutedText> : null}
      {machine.updatedAt ? (
        <MutedText>{t('machines.updated', { time: formatDateTime(machine.updatedAt, lang) })}</MutedText>
      ) : null}
      {canAdd ? (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onAdd}>
          {t(machine.status === 'failed' ? 'machines.retry' : 'machines.add')}
        </Button>
      ) : null}
    </li>
  );
}

const EMPTY_REPO: ProjectRepo = { originUrl: '', branch: 'main', companions: [] };

function RepoCard({ projectId, repo, canEdit }: { projectId: string; repo: ProjectRepo | null; canEdit: boolean }) {
  const { t } = useT('projects');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  // Component được mount lại (key theo repo từ server) mỗi khi dữ liệu server đổi, nên form luôn khớp lần đọc mới nhất.
  const [form, setForm] = useState<ProjectRepo>(repo ?? EMPTY_REPO);
  const save = useMutation({
    mutationFn: () => api.machinePins.setRepo(company.id, projectId, form),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.projectMachines(projectId) }),
  });
  const setCompanion = (index: number, patch: Partial<ProjectRepo['companions'][number]>) =>
    setForm((prev) => ({ ...prev, companions: prev.companions.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('machines.repo.title')}</CardTitle>
        <CardDescription>{repo ? t('machines.repo.hint') : t('machines.repo.none')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canEdit ? (
          <>
            <Field label={t('machines.repo.origin')} htmlFor="project-repo-origin">
              <Input
                id="project-repo-origin"
                value={form.originUrl}
                onChange={(e) => setForm({ ...form, originUrl: e.target.value.trim() })}
              />
            </Field>
            <Field label={t('machines.repo.branch')} htmlFor="project-repo-branch">
              <Input
                id="project-repo-branch"
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value.trim() })}
              />
            </Field>
            <strong>{t('machines.repo.companions')}</strong>
            {form.companions.map((companion, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: ô nhập có điều khiển, tên còn đang gõ nên không làm khóa được.
              <span key={index} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={t('machines.repo.companionName')}
                  value={companion.name}
                  onChange={(e) => setCompanion(index, { name: e.target.value.trim() })}
                />
                <Input
                  aria-label={t('machines.repo.companionOrigin')}
                  value={companion.originUrl}
                  onChange={(e) => setCompanion(index, { originUrl: e.target.value.trim() })}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setForm({ ...form, companions: form.companions.filter((_, i) => i !== index) })}
                >
                  {t('machines.repo.remove')}
                </Button>
              </span>
            ))}
            <span className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={form.companions.length >= 5}
                onClick={() => setForm({ ...form, companions: [...form.companions, { name: '', originUrl: '' }] })}
              >
                {t('machines.repo.addCompanion')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={form.originUrl === '' || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? t('machines.repo.saving') : t('machines.repo.save')}
              </Button>
            </span>
            {save.isSuccess ? <span role="status">{t('machines.repo.saved')}</span> : null}
            {save.error ? <ErrorState title={t('machines.repo.saveFailed')} message={save.error.message} /> : null}
          </>
        ) : repo ? (
          <ul className="flex flex-col gap-1">
            <li>
              {repo.originUrl} ({repo.branch})
            </li>
            {repo.companions.map((c) => (
              <li key={c.name}>
                {c.name}: {c.originUrl}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
