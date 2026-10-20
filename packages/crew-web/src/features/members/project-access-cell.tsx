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

/**
 * Nhãn một danh sách project: không có thì "Chưa có project", từ 2 project trở xuống thì liệt kê tên, nhiều hơn thì
 * "N project". Chỉ đếm project đang dùng (project đã gỡ không hiện).
 */
export function ProjectNames({
  projectIds,
  projects,
}: {
  projectIds: readonly string[];
  projects: readonly ProjectChoice[];
}) {
  const { t } = useT('members');
  const names = projects.filter((p) => projectIds.includes(p.id)).map((p) => p.name);
  if (names.length === 0) return <>{t('projects.none')}</>;
  return <>{names.length <= 2 ? names.join(', ') : t('projects.count', { count: names.length })}</>;
}

interface ProjectChecklistProps {
  /** Tiền tố id của hộp chọn, để hai danh sách trên cùng trang không trùng id. */
  idPrefix: string;
  projects: readonly ProjectChoice[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}

/** Danh sách hộp chọn project đang dùng; company chưa có project thì báo trống. */
export function ProjectChecklist({ idPrefix, projects, selected, onChange }: ProjectChecklistProps) {
  const { t } = useT('members');
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <>
      {projects.length === 0 ? <MutedText>{t('projects.empty')}</MutedText> : null}
      {projects.map((p) => {
        const id = `${idPrefix}-${p.id}`;
        return (
          <span key={p.id} className="flex items-center gap-2">
            <Checkbox id={id} checked={selected.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />
            <Label htmlFor={id}>{p.name}</Label>
          </span>
        );
      })}
    </>
  );
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
  const errorKey = memberErrorKey(error);
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
          <ProjectNames projectIds={projectIds} projects={projects} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <div className="flex flex-col gap-3" data-testid="project-access-editor">
          <PopoverTitle>{t('projects.title', { name })}</PopoverTitle>
          <ProjectChecklist idPrefix="project-access" projects={projects} selected={draft} onChange={setDraft} />
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
