// Form sửa vai trò project (S8.3): 4 vai trò Claude và 3 ô runtime tùy chọn (executor Codex, executor OpenCode, reviewer
// Codex). Hộp chọn chỉ có agent sẵn sàng, hoặc agent đang giữ đúng ô đó (S13.7), và chỉ agent chạy đúng runtime của ô.
import { useState } from 'react';
import type { ProjectRoles } from '@/api';
import { Button, ErrorState, Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ds';
import { useT } from '@/i18n';
import type { CrewRuntime } from '@/lib/instructions';

export interface RoleAgent {
  id: string;
  name: string;
  state: 'ready' | 'paused' | 'not_ready' | 'terminated' | 'untracked';
  /** Đang giữ vai trò ở project khác (server cấm giữ chéo project). */
  holdsElsewhere: boolean;
  /** Adapter của agent; thiếu thì coi là Claude. */
  adapterType?: string;
}

const RUNTIME_ONLY = new Set(['codex_local', 'opencode_local']);

/** Runtime của agent theo adapter: Codex/OpenCode chỉ ngồi ô riêng của mình, adapter khác ngồi ô Claude. */
const runtimeOf = (a: RoleAgent): CrewRuntime =>
  a.adapterType && RUNTIME_ONLY.has(a.adapterType) ? (a.adapterType as CrewRuntime) : 'claude_local';

export function roleOptions(
  agents: readonly RoleAgent[],
  currentId: string | null,
  runtime: CrewRuntime = 'claude_local',
): RoleAgent[] {
  return agents.filter(
    (a) => a.id === currentId || (a.state === 'ready' && !a.holdsElsewhere && runtimeOf(a) === runtime),
  );
}

const NONE = '__none__';

type SlotKey =
  | 'assistant'
  | 'executor1'
  | 'executor2'
  | 'reviewer'
  | 'integrator'
  | 'executorCodex'
  | 'executorOpencode'
  | 'reviewerCodex';
type Values = Record<SlotKey, string>;

const SLOTS: { key: SlotKey; optional?: boolean; runtime?: CrewRuntime }[] = [
  { key: 'assistant' },
  { key: 'executor1' },
  { key: 'executor2', optional: true },
  { key: 'reviewer' },
  { key: 'integrator' },
  { key: 'executorCodex', optional: true, runtime: 'codex_local' },
  { key: 'executorOpencode', optional: true, runtime: 'opencode_local' },
  { key: 'reviewerCodex', optional: true, runtime: 'codex_local' },
];

const valuesOf = (roles: ProjectRoles | null): Values => ({
  assistant: roles?.assistantAgentId ?? '',
  executor1: roles?.executorAgentIds[0] ?? '',
  executor2: roles?.executorAgentIds[1] ?? '',
  reviewer: roles?.reviewerAgentId ?? '',
  integrator: roles?.integratorAgentId ?? '',
  executorCodex: roles?.codexExecutorAgentId ?? '',
  executorOpencode: roles?.opencodeExecutorAgentId ?? '',
  reviewerCodex: roles?.codexReviewerAgentId ?? '',
});

/** Vai trò gửi lên; ô runtime trống gửi `null` để plugin xóa agent đang giữ ô. */
export function rolesOf(values: Values): ProjectRoles {
  return {
    assistantAgentId: values.assistant,
    executorAgentIds: [values.executor1, values.executor2].filter(Boolean),
    reviewerAgentId: values.reviewer,
    integratorAgentId: values.integrator,
    codexExecutorAgentId: values.executorCodex || null,
    opencodeExecutorAgentId: values.executorOpencode || null,
    codexReviewerAgentId: values.reviewerCodex || null,
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
      {SLOTS.map(({ key, optional, runtime }) => {
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
                {roleOptions(agents, current, runtime).map((a) => (
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
