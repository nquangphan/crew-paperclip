// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/api';
import { Button, ChatMessage, ErrorState, Input, MarkdownView, MutedText, Textarea } from '@/ds';
import { Pencil } from '@/ds/icons';
import { useT } from '@/i18n';

/** Làm mới mọi khóa cache của issue (theo uuid và theo mã) sau khi sửa. */
function useRefreshIssue(issue: Issue) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.issue(issue.id) });
    if (issue.identifier) void qc.invalidateQueries({ queryKey: queryKeys.issue(issue.identifier) });
    void qc.invalidateQueries({ queryKey: queryKeys.issues(issue.companyId) });
  };
}

interface EditFormProps {
  label: string;
  initial: string;
  multiline: boolean;
  required: boolean;
  failedTitle: string;
  pending: boolean;
  error: unknown;
  onSave: (value: string) => void;
  onCancel: () => void;
}

function EditForm({
  label,
  initial,
  multiline,
  required,
  failedTitle,
  pending,
  error,
  onSave,
  onCancel,
}: EditFormProps) {
  const { t } = useT('issues');
  const [value, setValue] = useState(initial);
  const empty = required && value.trim() === '';
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty && !pending) onSave(required ? value.trim() : value);
      }}
    >
      {multiline ? (
        <Textarea aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <Input aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} />
      )}
      {error ? (
        <ErrorState title={failedTitle} message={error instanceof Error ? error.message : String(error)} />
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={empty || pending}>
          {pending ? t('detail.saving') : t('detail.save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('detail.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** Tiêu đề, sửa bằng PUT /issues/:id/title (S6.12). */
export function TitleEditor({ issue }: { issue: Issue }) {
  const { t } = useT('issues');
  const [editing, setEditing] = useState(false);
  const refresh = useRefreshIssue(issue);
  const save = useMutation({
    mutationFn: (title: string) => api.issues.setTitle(issue.id, title),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  if (editing) {
    return (
      <EditForm
        label={t('detail.title.label')}
        initial={issue.title}
        multiline={false}
        required
        failedTitle={t('detail.title.failed')}
        pending={save.isPending}
        error={save.error}
        onSave={(v) => save.mutate(v)}
        onCancel={() => {
          save.reset();
          setEditing(false);
        }}
      />
    );
  }
  return (
    <div className="flex items-center gap-2">
      <h2 className="min-w-0 flex-1">{issue.title}</h2>
      <Button variant="ghost" size="icon-sm" aria-label={t('detail.title.edit')} onClick={() => setEditing(true)}>
        <Pencil aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Mô tả markdown, sửa bằng PATCH /issues/:id chỉ với `description` (S6.12). Hiện như bong bóng mô tả đầu luồng của
 * Paperclip, có tên người tạo; `author` thiếu thì ghi "Mô tả".
 */
export function DescriptionEditor({ issue, author }: { issue: Issue; author?: string }) {
  const { t } = useT('issues');
  const [editing, setEditing] = useState(false);
  const refresh = useRefreshIssue(issue);
  const save = useMutation({
    mutationFn: (description: string) => api.issues.update(issue.id, { description }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  if (editing) {
    return (
      <EditForm
        label={t('detail.description.label')}
        initial={issue.description ?? ''}
        multiline
        required={false}
        failedTitle={t('detail.description.failed')}
        pending={save.isPending}
        error={save.error}
        onSave={(v) => save.mutate(v)}
        onCancel={() => {
          save.reset();
          setEditing(false);
        }}
      />
    );
  }
  return (
    <ChatMessage
      kind="brief"
      data-testid="issue-description"
      author={author ?? t('detail.description.label')}
      aside={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('detail.description.edit')}
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden />
        </Button>
      }
    >
      {issue.description ? (
        <MarkdownView markdown={issue.description} />
      ) : (
        <MutedText>{t('detail.description.empty')}</MutedText>
      )}
    </ChatMessage>
  );
}
