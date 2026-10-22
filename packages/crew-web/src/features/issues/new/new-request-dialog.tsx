// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@/ds';
import { useCompanyAccess, useVisibleProjects } from '@/features/access';
import { NewContributionDialog } from '@/features/contributions/new-contribution-dialog';
import { RequestTypeChip } from '@/features/jev/request-type-chip';
import { useRequestTypeSuggestion } from '@/features/jev/use-request-type-suggestion';
import { useProjectReadiness } from '@/features/readiness';
import { useT } from '@/i18n';
import { availableKinds, isRequestKind, missingKindLabels, NO_KIND_LABELS, type RequestKind } from './kinds';
import { AttachmentsField, DescriptionField } from './request-fields';
import { projectRolesOrNull, useCreateRequest, useKindLabelIds } from './use-create-request';

export interface CreatedRequest {
  draft: boolean;
  failedUploads: string[];
}

interface NewRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onCreated?: (issue: Issue, info: CreatedRequest) => void;
}

/** Dialog Yêu cầu mới (S5): form chỉ có trong lúc mở, nên đóng rồi mở lại là form trống. */
export function NewRequestDialog({ open, onOpenChange, companyId, onCreated }: NewRequestDialogProps) {
  const { t } = useT('issues');
  const { isContributor, readOnly, loading } = useCompanyAccess();
  // Chờ biết vai trò rồi mới mở, để khách không chớp dialog thường (và không gọi các route chỉ owner đọc).
  if (loading) return null;
  if (isContributor) return <NewContributionDialog open={open} onOpenChange={onOpenChange} companyId={companyId} />;
  // Viewer thuần không tạo được yêu cầu (server trả 403), nên không có dialog nào, kể cả khi mở thẳng `?new=1`.
  if (readOnly) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('new.title')}</DialogTitle>
          <DialogDescription>{t('new.description')}</DialogDescription>
        </DialogHeader>
        <RequestForm companyId={companyId} onClose={() => onOpenChange(false)} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}

function RequestForm({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated?: NewRequestDialogProps['onCreated'];
}) {
  const { t } = useT('issues');
  const [projectId, setProjectId] = useState('');
  const [kind, setKind] = useState<RequestKind>('code');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const readiness = useProjectReadiness(companyId, api);
  const visible = useVisibleProjects();
  const projects = useQuery({
    queryKey: queryKeys.projects(companyId),
    queryFn: () => api.projects.list(companyId),
    select: visible.filterProjects,
  });
  const agents = useQuery({ queryKey: queryKeys.agents(companyId), queryFn: () => api.agents.list(companyId) });
  const roles = useQuery({
    queryKey: queryKeys.roles(projectId),
    queryFn: () => projectRolesOrNull(companyId, projectId),
    enabled: projectId !== '',
  });
  const kindLabels = useKindLabelIds(companyId);
  const create = useCreateRequest(companyId);
  const jevKind = useRequestTypeSuggestion(companyId, title, description, kind);

  const loadingProjects = readiness.isLoading || projects.isLoading;
  const readyIds = new Set((readiness.data ?? []).filter((r) => r.state === 'ready').map((r) => r.projectId));
  const readyProjects = (projects.data ?? []).filter((p) => readyIds.has(p.id));
  const kindLabelIds = kindLabels.data ?? NO_KIND_LABELS;
  const kinds = availableKinds(kindLabelIds);
  const kindHint = missingKindLabels(kindLabelIds)
    .map((k) => t(`new.labelMissing.${k}`))
    .join(' ');
  const assistantId = roles.data?.assistantAgentId ?? null;
  const assistant = agents.data?.find((a) => a.id === assistantId);
  const noRoles = projectId !== '' && roles.isSuccess && assistantId === null;

  const ready = projectId !== '' && assistantId !== null && title.trim() !== '' && !create.isPending;

  const submit = (draft: boolean) => {
    if (!ready || assistantId === null) return;
    create.mutate(
      {
        title,
        description,
        projectId,
        assigneeAgentId: assistantId,
        kind,
        kindLabelIds,
        draft,
        files,
      },
      {
        onSuccess: ({ issue, failedUploads }) => {
          jevKind.recordFinal(kind);
          onCreated?.(issue, { draft, failedUploads });
          onClose();
        },
      },
    );
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <Field
        label={t('new.project')}
        hint={!loadingProjects && readyProjects.length === 0 ? t('new.noReadyProject') : undefined}
      >
        {loadingProjects ? (
          <Spinner />
        ) : readyProjects.length === 0 ? null : (
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger aria-label={t('new.project')} className="w-full">
              <SelectValue placeholder={t('new.projectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {readyProjects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field label={t('new.kind')} hint={kindHint || undefined}>
        <Select value={kind} onValueChange={(v) => isRequestKind(v) && setKind(v)}>
          <SelectTrigger aria-label={t('new.kind')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`new.kinds.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <RequestTypeChip
          suggestion={jevKind.suggestion}
          current={kind}
          allowed={kinds}
          onPick={(k) => isRequestKind(k) && setKind(k)}
        />
      </Field>

      <Field label={t('new.titleLabel')} htmlFor="new-request-title">
        <Input
          id="new-request-title"
          value={title}
          placeholder={t('new.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <DescriptionField
        id="new-request-description"
        value={description}
        onChange={setDescription}
        setFiles={setFiles}
      />

      <Field label={t('new.assignee')} hint={t('new.assigneeHint')} error={noRoles ? t('new.noRoles') : undefined}>
        <p>{assistant?.name ?? assistantId ?? '—'}</p>
      </Field>

      <AttachmentsField files={files} setFiles={setFiles} />

      {create.error ? <ErrorState title={t('new.createFailed')} message={create.error.message} /> : null}

      <DialogFooter className="items-center">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('new.cancel')}
        </Button>
        <Button type="button" variant="outline" disabled={!ready} onClick={() => submit(true)}>
          {t('new.saveDraft')}
        </Button>
        <Button type="submit" disabled={!ready}>
          {create.isPending ? t('new.creating') : t('new.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
