// Đổi tên, mô tả, màu, biểu tượng project (S8.6): PATCH /projects/:id chỉ có name|description|color|icon.

import type { Project } from '@paperclipai/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
} from '@/ds';
import { useT } from '@/i18n';

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Pick<Project, 'id' | 'name' | 'description' | 'color' | 'icon'>;
  companyId: string;
  onSaved?: (project: Project) => void;
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export function RenameDialog({ open, onOpenChange, project, companyId, onSaved }: RenameDialogProps) {
  const { t } = useT('projects');
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [color, setColor] = useState(project.color ?? '');
  const [icon, setIcon] = useState(project.icon ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.projects.update(
        project.id,
        { name: name.trim(), description: orNull(description), color: orNull(color), icon: orNull(icon) },
        companyId,
      ),
    onSuccess: (saved) => {
      onSaved?.(saved);
      onOpenChange(false);
    },
  });
  const blank = name.trim() === '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('rename.title')}</DialogTitle>
          <DialogDescription>{project.name}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blank) save.mutate();
          }}
        >
          <Field label={t('rename.name')} htmlFor="project-name" error={save.error?.message}>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('rename.description')} htmlFor="project-description">
            <Textarea id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={t('rename.color')} hint={t('rename.colorHint')} htmlFor="project-color">
            <Input id="project-color" value={color} onChange={(e) => setColor(e.target.value)} />
          </Field>
          <Field label={t('rename.icon')} htmlFor="project-icon">
            <Input id="project-icon" value={icon} onChange={(e) => setIcon(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('rename.cancel')}
            </Button>
            <Button type="submit" disabled={blank || save.isPending}>
              {t('rename.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
