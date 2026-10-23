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
import type { NewRequestInitial } from './follow-plan';
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
  /** Giá trị điền sẵn lúc mở (ví dụ "Làm theo kế hoạch này"); đóng rồi mở lại thì form dựng lại từ đây. */
  initial?: NewRequestInitial;
}

/** Dialog Yêu cầu mới (S5): form chỉ có trong lúc mở, nên đóng rồi mở lại là form trống. */
export function NewRequestDialog({ open, onOpenChange, companyId, onCreated, initial }: NewRequestDialogProps) {
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
        <RequestForm
          companyId={companyId}
          onClose={() => onOpenChange(false)}
          onCreated={onCreated}
          initial={initial}
        />
      </DialogContent>
    </Dialog>
  );
}

function RequestForm({
  companyId,
  onClose,
  onCreated,
  initial,
}: {
  companyId: string;
  onClose: () => void;
  onCreated?: NewRequestDialogProps['onCreated'];
  initial?: NewRequestInitial;
}) {
  const { t } = useT('issues');
  const [projectId, setProjectId] = useState(initial?.projectId ?? '');
  const [kind, setKind] = useState<RequestKind>(initial?.kind ?? 'code');
  // Chỉ khi loại đã được chọn (owner chọn hay điền sẵn) thì mới gửi `current` cho Jev; mặc định `code` chưa phải
  // lựa chọn của ai.
  const [kindPicked, setKindPicked] = useState(initial?.kind !== undefined);
  const pickKind = (v: string) => {
    if (!isRequestKind(v)) return;
    setKind(v);
    setKindPicked(true);
  };
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
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
  const jevKind = useRequestTypeSuggestion(companyId, title, description, kindPicked ? kind : undefined);

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

  // Project điền sẵn mà chưa sẵn sàng hay owner không thấy thì ô Project trống, nên chưa cho gửi tới khi chọn lại.
  const ready = readyProjects.some((p) => p.id === projectId) && assistantId !== null && title.trim() !== '' && !create.isPending;

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
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Select value={kind} onValueChange={pickKind}>
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
          </div>
          <RequestTypeChip suggestion={jevKind.suggestion} current={kind} allowed={kinds} onPick={pickKind} />
        </div>
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
