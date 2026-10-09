// Form sửa 4 vai trò project (S8.3). Hộp chọn chỉ có agent sẵn sàng, hoặc agent đang giữ đúng ô đó (S13.7).
import { useState } from 'react';
import type { ProjectRoles } from '@/api';
import { Button, ErrorState, Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ds';
import { useT } from '@/i18n';

export interface RoleAgent {
  id: string;
  name: string;
  state: 'ready' | 'paused' | 'not_ready' | 'terminated' | 'untracked';
  /** Đang giữ vai trò ở project khác (server cấm giữ chéo project). */
  holdsElsewhere: boolean;
}

export function roleOptions(agents: readonly RoleAgent[], currentId: string | null): RoleAgent[] {
  return agents.filter((a) => a.id === currentId || (a.state === 'ready' && !a.holdsElsewhere));
}

const NONE = '__none__';

type SlotKey = 'assistant' | 'executor1' | 'executor2' | 'reviewer' | 'integrator';
type Values = Record<SlotKey, string>;

const SLOTS: { key: SlotKey; optional?: boolean }[] = [
  { key: 'assistant' },
  { key: 'executor1' },
  { key: 'executor2', optional: true },
  { key: 'reviewer' },
  { key: 'integrator' },
];

const valuesOf = (roles: ProjectRoles | null): Values => ({
  assistant: roles?.assistantAgentId ?? '',
  executor1: roles?.executorAgentIds[0] ?? '',
  executor2: roles?.executorAgentIds[1] ?? '',
  reviewer: roles?.reviewerAgentId ?? '',
  integrator: roles?.integratorAgentId ?? '',
});

export function rolesOf(values: Values): ProjectRoles {
  return {
    assistantAgentId: values.assistant,
    executorAgentIds: [values.executor1, values.executor2].filter(Boolean),
    reviewerAgentId: values.reviewer,
    integratorAgentId: values.integrator,
  };
}

interface RolesFormProps {
  roles: ProjectRoles | null;
  agents: readonly RoleAgent[];
  saving: boolean;
  /** Lỗi server hiện nguyên văn. */
  error: string | null;
  onSubmit: (roles: ProjectRoles) => void;
  onCancel?: () => void;
}

export function RolesForm({ roles, agents, saving, error, onSubmit, onCancel }: RolesFormProps) {
  const { t } = useT('projects');
  const initial = valuesOf(roles);
  const [values, setValues] = useState<Values>(initial);
  const complete = SLOTS.every((s) => s.optional || values[s.key] !== '');
  const dirty = SLOTS.some((s) => values[s.key] !== initial[s.key]);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete && dirty && !saving) onSubmit(rolesOf(values));
      }}
    >
      {SLOTS.map(({ key, optional }) => {
        const current = initial[key] || null;
        const id = `role-${key}`;
        return (
          <Field key={key} label={t(`roles.slot.${key}`)} htmlFor={id}>
            <Select
              value={values[key] === '' && optional ? NONE : values[key]}
              onValueChange={(v) => setValues({ ...values, [key]: v === NONE ? '' : v })}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue placeholder={t('roles.choose')} />
              </SelectTrigger>
              <SelectContent position="popper">
                {optional ? <SelectItem value={NONE}>{t('roles.none')}</SelectItem> : null}
                {roleOptions(agents, current).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        );
      })}
      {error ? <ErrorState title={t('roles.saveFailed')} message={error} /> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={!complete || !dirty || saving}>
          {saving ? t('roles.saving') : t('roles.save')}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('roles.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
