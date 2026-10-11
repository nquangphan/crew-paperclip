// crew: tự dựng
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api, type Contribution, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Label,
  MarkdownView,
  MutedText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@/ds';
import { isRequestKind, REQUEST_KINDS, type RequestKind } from '@/features/issues/new/kinds';
import { useResearchLabelId } from '@/features/issues/new/use-create-request';
import { useSelectableAgents } from '@/features/wizards';
import { useT } from '@/i18n';
import { contributionErrorKey } from './approve-flow';
import { useApproveContribution, useAuthorNames } from './use-contributions';

interface ApproveIssueDialogProps {
  contribution: Contribution;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved?: (done: Contribution) => void;
}

/** Vai trò project; 404 nghĩa là project chưa có dòng vai trò (chưa có Trợ Lý). */
const rolesOrNull = async (companyId: string, projectId: string) => {
  try {
    return await api.roles.get(companyId, projectId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
};

/**
 * Dialog duyệt yêu cầu góp ý: owner chọn project, loại, agent nhận việc (mặc định Trợ Lý của project) và nháp, rồi
 * chạy ba bước duyệt. Tiêu đề và mô tả đăng nguyên văn, không sửa ở đây. Form chỉ có trong lúc mở.
 */
export function ApproveIssueDialog({ contribution, open, onOpenChange, onApproved }: ApproveIssueDialogProps) {
  const { t } = useT('contributions');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('approveDialog.title')}</DialogTitle>
          <DialogDescription>{t('approveDialog.description')}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ApproveIssueForm
            contribution={contribution}
            onClose={() => onOpenChange(false)}
            onApproved={(done) => {
              onOpenChange(false);
              onApproved?.(done);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ApproveIssueForm({
  contribution: c,
  onClose,
  onApproved,
}: {
  contribution: Contribution;
  onClose: () => void;
  onApproved: (done: Contribution) => void;
}) {
  const { t } = useT('contributions');
  const { t: ti } = useT('issues');
  const { company } = useCompany();
  const authorName = useAuthorNames();
  const [projectId, setProjectId] = useState(c.projectId ?? '');
  const [kind, setKind] = useState<RequestKind>('code');
  // null: theo Trợ Lý của project đang chọn; đổi project thì về lại mặc định.
  const [assigneeChoice, setAssigneeChoice] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);

  const projects = useQuery({ queryKey: queryKeys.projects(company.id), queryFn: () => api.projects.list(company.id) });
  const agents = useQuery({ queryKey: queryKeys.agents(company.id), queryFn: () => api.agents.list(company.id) });
  const selectable = useSelectableAgents(company.id);
  const roles = useQuery({
    queryKey: queryKeys.roles(projectId),
    queryFn: () => rolesOrNull(company.id, projectId),
    enabled: projectId !== '',
  });
  const researchLabel = useResearchLabelId(company.id);
  const approve = useApproveContribution();

  const projectChoices = (projects.data ?? []).filter((p) => !p.archivedAt || p.id === c.projectId);
  const researchId = researchLabel.data ?? null;
  const kinds = REQUEST_KINDS.filter((k) => k !== 'research' || researchId !== null);
  const assistantId = roles.data?.assistantAgentId ?? null;
  const assigneeId = assigneeChoice ?? assistantId;
  const agentChoices = selectable(agents.data, [assigneeId]);
  const noAssistant = projectId !== '' && roles.isSuccess && assistantId === null;

  const ready = projectId !== '' && assigneeId !== null && assigneeId !== '' && !approve.isPending;

  const submit = () => {
    if (!ready || assigneeId === null) return;
    approve.mutate(
      {
        contribution: c,
        choices: { projectId, assigneeAgentId: assigneeId, kind, researchLabelId: researchId, draft },
      },
      { onSuccess: onApproved },
    );
  };

  const errorKey = approve.error ? contributionErrorKey(approve.error) : null;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label={t('approveDialog.content')}>
        <strong>{c.title}</strong>
        {c.body ? <MarkdownView markdown={c.body} /> : null}
        <MutedText>
          {t('approveDialog.author')}: {authorName(c.authorUserId) ?? c.authorUserId}
        </MutedText>
      </Field>

      <Field label={t('approveDialog.project')}>
        {projects.isLoading ? (
          <Spinner />
        ) : (
          <Select
            value={projectId}
            onValueChange={(v) => {
              setProjectId(v);
              setAssigneeChoice(null);
            }}
          >
            <SelectTrigger aria-label={t('approveDialog.project')} className="w-full">
              <SelectValue placeholder={t('approveDialog.projectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {projectChoices.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field
        label={t('approveDialog.kind')}
        hint={researchId === null ? t('approveDialog.researchMissing') : undefined}
      >
        <Select value={kind} onValueChange={(v) => isRequestKind(v) && setKind(v)}>
          <SelectTrigger aria-label={t('approveDialog.kind')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((k) => (
              <SelectItem key={k} value={k}>
                {ti(`new.kinds.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label={t('approveDialog.assignee')}
        hint={t('approveDialog.assigneeHint')}
        error={noAssistant && assigneeChoice === null ? t('approveDialog.noAssistant') : undefined}
      >
        {agents.isLoading || (projectId !== '' && roles.isLoading) ? (
          <Spinner />
        ) : (
          <Select value={assigneeId ?? ''} onValueChange={setAssigneeChoice}>
            <SelectTrigger aria-label={t('approveDialog.assignee')} className="w-full">
              <SelectValue placeholder={t('approveDialog.assigneePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {agentChoices.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <span className="flex items-center gap-2">
        <Checkbox id="approve-draft" checked={draft} onCheckedChange={(v) => setDraft(v === true)} />
        <Label htmlFor="approve-draft">{t('approveDialog.draft')}</Label>
      </span>

      {roles.error ? <ErrorState title={t('actions.approveFailed')} message={roles.error.message} /> : null}
      {approve.error ? (
        <ErrorState title={t('actions.approveFailed')} message={errorKey ? t(errorKey) : approve.error.message} />
      ) : null}

      <DialogFooter className="items-center">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('approveDialog.cancel')}
        </Button>
        <Button type="submit" disabled={!ready}>
          {approve.isPending ? t('approveDialog.submitting') : t('approveDialog.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
