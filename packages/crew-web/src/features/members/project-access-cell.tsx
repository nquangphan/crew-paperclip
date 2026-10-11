// crew: tự dựng
import { useState } from 'react';
import {
  Button,
  Checkbox,
  ErrorState,
  Label,
  MutedText,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/ds';
import { useT } from '@/i18n';
import { memberErrorKey } from './members-model';

export interface ProjectChoice {
  id: string;
  name: string;
}

interface ProjectAccessCellProps {
  name: string;
  projectIds: readonly string[];
  /** Project đang dùng của company (đã bỏ project đã gỡ). */
  projects: readonly ProjectChoice[];
  saving: boolean;
  error: unknown;
  onSave: (projectIds: string[]) => Promise<unknown>;
}

/**
 * Ô "Project được xem" của một thành viên không phải owner: nút mở danh sách hộp chọn project và nút Lưu (thay cả
 * danh sách một lần). Quyền ở project đã gỡ được giữ nguyên khi lưu. Owner không dùng ô này (luôn thấy tất cả).
 */
export function ProjectAccessCell({ name, projectIds, projects, saving, error, onSave }: ProjectAccessCellProps) {
  const { t } = useT('members');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReadonlySet<string>>(new Set(projectIds));
  const names = projects.filter((p) => projectIds.includes(p.id)).map((p) => p.name);
  const label =
    names.length === 0
      ? t('projects.none')
      : names.length <= 2
        ? names.join(', ')
        : t('projects.count', { count: names.length });
  const errorKey = memberErrorKey(error);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(draft);
    if (on) next.add(id);
    else next.delete(id);
    setDraft(next);
  };
  const save = () => {
    void onSave([...draft])
      .then(() => setOpen(false))
      .catch(() => {});
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(new Set(projectIds));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t('projects.edit', { name })}
          data-testid="project-access-trigger"
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <div className="flex flex-col gap-3" data-testid="project-access-editor">
          <PopoverTitle>{t('projects.title', { name })}</PopoverTitle>
          {projects.length === 0 ? <MutedText>{t('projects.empty')}</MutedText> : null}
          {projects.map((p) => {
            const id = `project-access-${p.id}`;
            return (
              <span key={p.id} className="flex items-center gap-2">
                <Checkbox id={id} checked={draft.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />
                <Label htmlFor={id}>{p.name}</Label>
              </span>
            );
          })}
          {error ? (
            <ErrorState
              title={t('projects.failed')}
              message={errorKey ? t(errorKey) : error instanceof Error ? error.message : String(error)}
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('projects.cancel')}
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={save}>
              {saving ? t('projects.saving') : t('projects.save')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
