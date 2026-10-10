// Sửa nội dung skill sửa được (S14.5): chọn file trong `fileInventory`, sửa text, lưu (PATCH …/files), thêm file,
// xóa file (gõ đúng đường dẫn). Lưu xong xếp `skill-sync` lên mọi máy. Đổi `name:` trong SKILL.md thành tên skill
// Superpowers đã ghim thì chặn trước khi gửi. Server báo 409 thì báo có người vừa sửa, không ghi đè.
import type { CompanySkillDetail } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryKeys } from '@/api';
import { ApiError } from '@/api/http';
import { useCompany } from '@/app/hooks';
import { Alert, Button, ConfirmDialog, Field, Input, MutedText, Spinner, Textarea } from '@/ds';
import { Plus, Trash2 } from '@/ds/icons';
import { useCrewMachines } from '@/features/machines/use-machines';
import { useT } from '@/i18n';
import { skillMarkdownClash } from './frontmatter';
import { invalidateSkills, type QueueAllResult, queueSyncOnAllMachines } from './use-skill-sync';

const SKILL_FILE = 'SKILL.md';

const isConflict = (error: unknown): boolean => error instanceof ApiError && error.status === 409;

interface SavedNotice extends QueueAllResult {
  path: string;
  deleted: boolean;
}

export function SkillFilesEditor({ skill }: { skill: Pick<CompanySkillDetail, 'id' | 'fileInventory'> }) {
  const { t } = useT('skills');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const machines = useCrewMachines(company.id);
  const paths = skill.fileInventory.map((f) => f.path);
  const [path, setPath] = useState(paths.includes(SKILL_FILE) ? SKILL_FILE : (paths[0] ?? SKILL_FILE));
  const [draft, setDraft] = useState<string | null>(null);
  const [newPath, setNewPath] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<SavedNotice | null>(null);

  const file = useQuery({
    queryKey: queryKeys.skillFile(company.id, skill.id, path),
    queryFn: () => api.skills.readFile(company.id, skill.id, path),
  });
  const open = (next: string) => {
    setPath(next);
    setDraft(null);
  };
  const reload = () => {
    setDraft(null);
    invalidateSkills(queryClient, company.id);
  };

  const afterWrite = async (written: string, deleted: boolean): Promise<SavedNotice> => {
    const queued = await queueSyncOnAllMachines(queryClient, company.id, skill.id);
    return { ...queued, path: written, deleted };
  };
  const onWritten = (done: SavedNotice) => {
    setNotice(done);
    setDraft(null);
    invalidateSkills(queryClient, company.id);
  };
  const save = useMutation({
    mutationFn: async (v: { path: string; content: string }) => {
      await api.skills.writeFile(company.id, skill.id, v);
      return afterWrite(v.path, false);
    },
    onSuccess: onWritten,
  });
  const add = useMutation({
    mutationFn: async (target: string) => {
      await api.skills.writeFile(company.id, skill.id, { path: target, content: '' });
      return afterWrite(target, false);
    },
    onSuccess: (done) => {
      setNewPath('');
      open(done.path);
      onWritten(done);
    },
  });
  const remove = useMutation({
    mutationFn: async (target: string) => {
      await api.skills.deleteFile(company.id, skill.id, { path: target, target: 'file' });
      return afterWrite(target, true);
    },
    onSuccess: (done) => {
      open(SKILL_FILE);
      onWritten(done);
    },
  });

  const content = draft ?? file.data?.content ?? '';
  const textFile = file.data ? file.data.editable && file.data.encoding !== 'base64' : false;
  const clash =
    path === SKILL_FILE
      ? skillMarkdownClash(
          content,
          (machines.data ?? []).map((m) => m.latest),
        )
      : null;
  const busy = save.isPending || add.isPending || remove.isPending;
  const failure = save.error ?? add.error ?? remove.error;
  const trimmedNew = newPath.trim();

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2" aria-label={t('editor.files')}>
        {paths.map((p) => (
          <li key={p}>
            <Button
              type="button"
              size="sm"
              variant={p === path ? 'secondary' : 'ghost'}
              aria-pressed={p === path}
              onClick={() => open(p)}
            >
              {p}
            </Button>
          </li>
        ))}
      </ul>

      {file.isLoading ? <Spinner /> : null}
      {file.error ? (
        <Alert variant="destructive" title={t('editor.loadFailed')}>
          {file.error.message}
        </Alert>
      ) : null}
      {file.data && !textFile ? <MutedText>{t('editor.notText')}</MutedText> : null}
      {file.data && textFile ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft !== null && !clash && !busy) save.mutate({ path, content: draft });
          }}
        >
          <Field label={t('editor.contentOf', { path })} htmlFor="skill-file-content">
            <Textarea id="skill-file-content" value={content} rows={16} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          {clash ? <Alert variant="warning">{t('editor.clash', { name: clash })}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={draft === null || clash !== null || busy}>
              {t('editor.save')}
            </Button>
            {path !== SKILL_FILE ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden />
                {t('editor.deleteFile')}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmedNew && !paths.includes(trimmedNew) && !busy) add.mutate(trimmedNew);
        }}
      >
        <Field label={t('editor.newPath')} htmlFor="skill-new-file" hint={t('editor.newPathHint')}>
          <Input id="skill-new-file" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
        </Field>
        <Button type="submit" variant="outline" disabled={!trimmedNew || paths.includes(trimmedNew) || busy}>
          <Plus aria-hidden />
          {t('editor.addFile')}
        </Button>
      </form>

      {failure && isConflict(failure) ? (
        <Alert variant="destructive" title={t('editor.conflict')}>
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            {t('editor.reload')}
          </Button>
        </Alert>
      ) : null}
      {failure && !isConflict(failure) ? (
        <Alert variant="destructive" title={t('editor.saveFailed')}>
          {failure.message}
        </Alert>
      ) : null}
      {notice ? (
        <Alert
          variant="info"
          title={notice.deleted ? t('editor.deleted', { path: notice.path }) : t('editor.saved', { path: notice.path })}
        >
          {notice.queued > 0 ? t('add.queued', { count: notice.queued }) : null}
          {notice.waitingApp ? t('add.waitingAppHint') : null}
          {notice.failures.length ? t('editor.queueFailed', { error: notice.failures.join('; ') }) : null}
        </Alert>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('editor.deleteTitle', { path })}
        body={t('editor.deleteBody')}
        confirmLabel={t('editor.deleteFile')}
        destructive
        requireText={path}
        onConfirm={() => remove.mutate(path)}
      />
    </div>
  );
}
