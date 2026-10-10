// Sửa thông tin skill (S14.5): mô tả, câu giới thiệu ngắn, nhóm. Không đổi tên/slug (slug là khóa trong
// desiredSkills của agent và tên thư mục trên máy); tên đổi bằng `name:` trong SKILL.md.
import type { CompanySkillDetail } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api';
import { useCompany } from '@/app/hooks';
import {
  Alert,
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
import { invalidateSkills } from './use-skill-sync';

/** Giới hạn tagline của server (companySkillUpdateSchema). */
const TAGLINE_MAX = 120;

const parseCategories = (raw: string): string[] => [
  ...new Set(
    raw
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  ),
];

interface EditSkillInfoDialogProps {
  skill: Pick<CompanySkillDetail, 'id' | 'name' | 'description' | 'tagline' | 'categories'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSkillInfoDialog({ skill, open, onOpenChange }: EditSkillInfoDialogProps) {
  const { t } = useT('skills');
  const { company } = useCompany();
  const queryClient = useQueryClient();
  const [description, setDescription] = useState(skill.description ?? '');
  const [tagline, setTagline] = useState(skill.tagline ?? '');
  const [categories, setCategories] = useState((skill.categories ?? []).join(', '));

  const save = useMutation({
    mutationFn: () =>
      api.skills.update(company.id, skill.id, {
        description: description.trim() || null,
        tagline: tagline.trim() || null,
        categories: parseCategories(categories),
      }),
    onSuccess: () => {
      invalidateSkills(queryClient, company.id);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('info.title', { name: skill.name })}</DialogTitle>
          <DialogDescription>{t('info.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
        >
          <Field label={t('info.fieldDescription')} htmlFor="skill-info-description">
            <Textarea
              id="skill-info-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label={t('info.fieldTagline')} htmlFor="skill-info-tagline">
            <Input
              id="skill-info-tagline"
              value={tagline}
              maxLength={TAGLINE_MAX}
              onChange={(e) => setTagline(e.target.value)}
            />
          </Field>
          <Field label={t('info.fieldCategories')} htmlFor="skill-info-categories" hint={t('info.categoriesHint')}>
            <Input id="skill-info-categories" value={categories} onChange={(e) => setCategories(e.target.value)} />
          </Field>
          {save.error ? (
            <Alert variant="destructive" title={t('info.saveFailed')}>
              {save.error.message}
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('info.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
