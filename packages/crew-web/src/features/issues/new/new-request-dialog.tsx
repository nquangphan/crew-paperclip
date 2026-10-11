// crew: tự dựng
import { warnForAttachment } from '@crew/paperclip-plugin/shared/attachment-rules';
import type { Issue } from '@paperclipai/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/api';
import {
  AttachmentPicker,
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
  Textarea,
} from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { NewContributionDialog } from '@/features/contributions/new-contribution-dialog';
import { useProjectReadiness } from '@/features/readiness';
import { useT } from '@/i18n';
import { isRequestKind, REQUEST_KINDS, type RequestKind } from './kinds';
import { projectRolesOrNull, useCreateRequest, useResearchLabelId } from './use-create-request';

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

const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

/** Thêm file mới, bỏ file trùng tên-cỡ-ngày đã chọn. */
const addFiles = (current: File[], picked: File[]): File[] => {
  const seen = new Set(current.map(fileKey));
  return [...current, ...picked.filter((f) => !seen.has(fileKey(f)))];
};

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
  const projects = useQuery({ queryKey: queryKeys.projects(companyId), queryFn: () => api.projects.list(companyId) });
  const agents = useQuery({ queryKey: queryKeys.agents(companyId), queryFn: () => api.agents.list(companyId) });
  const roles = useQuery({
    queryKey: queryKeys.roles(projectId),
    queryFn: () => projectRolesOrNull(companyId, projectId),
    enabled: projectId !== '',
  });
  const researchLabel = useResearchLabelId(companyId);
  const create = useCreateRequest(companyId);

  const loadingProjects = readiness.isLoading || projects.isLoading;
  const readyIds = new Set((readiness.data ?? []).filter((r) => r.state === 'ready').map((r) => r.projectId));
  const readyProjects = (projects.data ?? []).filter((p) => readyIds.has(p.id));
  const researchId = researchLabel.data ?? null;
  const kinds = REQUEST_KINDS.filter((k) => k !== 'research' || researchId !== null);
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
        researchLabelId: researchId,
        draft,
        files,
      },
      {
        onSuccess: ({ issue, failedUploads }) => {
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

      <Field label={t('new.kind')} hint={researchId === null ? t('new.researchMissing') : undefined}>
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
      </Field>

      <Field label={t('new.titleLabel')} htmlFor="new-request-title">
        <Input
          id="new-request-title"
          value={title}
          placeholder={t('new.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field label={t('new.descriptionLabel')} htmlFor="new-request-description">
        <Textarea
          id="new-request-description"
          value={description}
          placeholder={t('new.descriptionPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <Field label={t('new.assignee')} hint={t('new.assigneeHint')} error={noRoles ? t('new.noRoles') : undefined}>
        <p>{assistant?.name ?? assistantId ?? '—'}</p>
      </Field>

      <Field label={t('new.attachments')}>
        <AttachmentPicker
          onFiles={(picked) => setFiles((prev) => addFiles(prev, picked))}
          warnFor={warnForAttachment}
        />
        {files.length > 0 ? (
          <ul className="grid gap-2">
            {files.map((file) => (
              <li key={fileKey(file)} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t('new.remove', { name: file.name })}
                  onClick={() => setFiles((prev) => prev.filter((f) => fileKey(f) !== fileKey(file)))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Field>

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
