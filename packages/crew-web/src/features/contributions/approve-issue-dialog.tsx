// crew: tự dựng
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Contribution, queryKeys } from '@/api';
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
import { projectRolesOrNull, useResearchLabelId } from '@/features/issues/new/use-create-request';
import { useSelectableAgents } from '@/features/wizards';
import { useT } from '@/i18n';
import { contributionErrorKey } from './approve-flow';
import { type useApproveContribution, useAuthorNames } from './use-contributions';

type ApproveMutation = ReturnType<typeof useApproveContribution>;

interface ApproveIssueDialogProps {
  contribution: Contribution;
  /** Mutation duyệt của dòng: dòng và dialog cùng thấy trạng thái đang chạy. */
  approve: ApproveMutation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog duyệt yêu cầu góp ý: owner chọn project, loại, agent nhận việc (mặc định Trợ Lý của project) và nháp, rồi
 * chạy ba bước duyệt. Tiêu đề và mô tả đăng nguyên văn, không sửa ở đây. Form chỉ có trong lúc mở.
 * Trong lúc duyệt không đóng được (Esc, bấm ra ngoài, Hủy đều bị chặn), để owner không chuyển sang Từ chối khi bước
 * đăng có thể đã tạo issue cho agent.
 */
export function ApproveIssueDialog({ contribution, approve, open, onOpenChange }: ApproveIssueDialogProps) {
  const { t } = useT('contributions');
  const pending = approve.isPending;
  const change = (next: boolean) => {
    if (!next && pending) return;
    onOpenChange(next);
  };
  const block = (e: Event) => {
    if (pending) e.preventDefault();
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent showCloseButton={!pending} onEscapeKeyDown={block} onInteractOutside={block}>
        <DialogHeader>
          <DialogTitle>{t('approveDialog.title')}</DialogTitle>
          <DialogDescription>{t('approveDialog.description')}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ApproveIssueForm
            contribution={contribution}
            approve={approve}
            onClose={() => change(false)}
            onApproved={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ApproveIssueForm({
  contribution: c,
  approve,
  onClose,
  onApproved,
}: {
  contribution: Contribution;
  approve: ApproveMutation;
  onClose: () => void;
  onApproved: () => void;
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
    queryFn: () => projectRolesOrNull(company.id, projectId),
    enabled: projectId !== '',
  });
  const researchLabel = useResearchLabelId(company.id);

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

      {projects.error ? (
        <ErrorState
          title={t('approveDialog.projectsFailed')}
          message={projects.error.message}
          onRetry={() => void projects.refetch()}
        />
      ) : null}
      {agents.error ? (
        <ErrorState
          title={t('approveDialog.agentsFailed')}
          message={agents.error.message}
          onRetry={() => void agents.refetch()}
        />
      ) : null}
      {roles.error ? <ErrorState title={t('actions.approveFailed')} message={roles.error.message} /> : null}
      {approve.error ? (
        <ErrorState title={t('actions.approveFailed')} message={errorKey ? t(errorKey) : approve.error.message} />
      ) : null}

      <DialogFooter className="items-center">
        <Button type="button" variant="ghost" disabled={approve.isPending} onClick={onClose}>
          {t('approveDialog.cancel')}
        </Button>
        <Button type="submit" disabled={!ready} aria-busy={approve.isPending}>
          {approve.isPending ? (
            <>
              <Spinner decorative />
              {t('approveDialog.submitting')}
            </>
          ) : (
            t('approveDialog.submit')
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}
