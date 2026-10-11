// crew: tự dựng
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
  MutedText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
} from '@/ds';
import { useT } from '@/i18n';
import { contributionErrorKey } from './approve-flow';
import { useCreateContribution } from './use-contributions';

/** Độ dài tiêu đề tối đa, khớp luật kiểm của server. */
export const TITLE_MAX = 240;

interface NewContributionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

/** Dialog gửi yêu cầu chờ duyệt của khách góp ý: chỉ project, tiêu đề, mô tả. Form chỉ có trong lúc dialog mở. */
export function NewContributionDialog({ open, onOpenChange, companyId }: NewContributionDialogProps) {
  const { t } = useT('contributions');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>
        <ContributionForm companyId={companyId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ContributionForm({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { t } = useT('contributions');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const projects = useQuery({ queryKey: queryKeys.projects(companyId), queryFn: () => api.projects.list(companyId) });
  const create = useCreateContribution();

  const choices = (projects.data ?? []).filter((p) => !p.archivedAt);
  const trimmed = title.trim();
  const ready = projectId !== '' && trimmed !== '' && trimmed.length <= TITLE_MAX && !create.isPending;
  const errorKey = create.error ? contributionErrorKey(create.error) : null;

  if (create.isSuccess) {
    return (
      <div role="status" className="grid gap-4">
        <strong>{t('dialog.sentTitle')}</strong>
        <MutedText>{t('dialog.sentHint')}</MutedText>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('dialog.close')}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const submit = () => {
    if (!ready) return;
    // Mô tả chỉ trim để kiểm rỗng, gửi nguyên văn (markdown giữ đúng như khách viết).
    create.mutate({
      kind: 'issue',
      projectId,
      title: trimmed,
      ...(description.trim() ? { description } : {}),
    });
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field
        label={t('dialog.project')}
        hint={!projects.isLoading && choices.length === 0 ? t('dialog.noProject') : undefined}
      >
        {projects.isLoading ? (
          <Spinner />
        ) : choices.length === 0 ? null : (
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger aria-label={t('dialog.project')} className="w-full">
              <SelectValue placeholder={t('dialog.projectPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {choices.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field label={t('dialog.titleLabel')} htmlFor="new-contribution-title">
        <Input
          id="new-contribution-title"
          value={title}
          maxLength={TITLE_MAX}
          placeholder={t('dialog.titlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field label={t('dialog.descriptionLabel')} htmlFor="new-contribution-description">
        <Textarea
          id="new-contribution-description"
          value={description}
          placeholder={t('dialog.descriptionPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      {create.error ? (
        <ErrorState title={t('dialog.failed')} message={errorKey ? t(errorKey) : create.error.message} />
      ) : null}

      <DialogFooter className="items-center">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" disabled={!ready}>
          {create.isPending ? t('dialog.submitting') : t('dialog.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
