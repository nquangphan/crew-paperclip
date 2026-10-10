// Đổi model mặc định của agent (S11.5): chỉ chọn trong bảng model của runtime agent chạy (claude_local, codex_local,
// opencode_local; bản chép CREW_RUNTIME_MODELS). Reviewer Codex chạy model cố định nên không đổi được. PATCH merge
// adapterConfig, không gửi replaceAdapterConfig và không gửi khóa nào khác ngoài `model` (command/extraArgs/env giữ
// nguyên ở server).
import type { Agent } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api';
import { Button, Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ds';
import { useT } from '@/i18n';
import { CREW_CODEX_REVIEWER_MODEL, type CrewRuntime, crewModelsOf } from '@/lib/instructions';
import { useAgentHoldings } from '../use-agent-roles';

const RUNTIMES = new Set<string>(['claude_local', 'codex_local', 'opencode_local']);

interface ModelSelectProps {
  agent: Pick<Agent, 'id' | 'adapterConfig'> & { adapterType?: string };
  companyId: string;
  onSaved?: (agent: Agent) => void;
}

export function ModelSelect({ agent, companyId, onSaved }: ModelSelectProps) {
  const { t } = useT('agents');
  const queryClient = useQueryClient();
  const { byAgent } = useAgentHoldings();
  const runtime: CrewRuntime = RUNTIMES.has(agent.adapterType ?? '')
    ? (agent.adapterType as CrewRuntime)
    : 'claude_local';
  const fixed = (byAgent.get(agent.id) ?? []).some((h) => h.slot === 'reviewer-codex');
  const models = fixed ? [CREW_CODEX_REVIEWER_MODEL.model] : crewModelsOf(runtime);
  const current = typeof agent.adapterConfig.model === 'string' ? agent.adapterConfig.model : '';
  const [picked, setValue] = useState<string | null>(null);
  const value = picked !== null && models.includes(picked) ? picked : models.includes(current) ? current : '';
  const save = useMutation({
    mutationFn: () => api.agents.update(agent.id, { adapterConfig: { model: value } }, companyId),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['agent'] });
      void queryClient.invalidateQueries({ queryKey: ['agents', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['crew', 'readiness'] });
      onSaved?.(saved);
    },
  });
  const dirty = value !== '' && value !== current;
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !save.isPending) save.mutate();
      }}
    >
      <Field
        label={t('model.label')}
        htmlFor="agent-model"
        hint={
          current !== '' && !models.includes(current)
            ? t('model.outside', { model: current })
            : fixed
              ? t('model.fixed')
              : undefined
        }
        error={save.error?.message}
      >
        <Select value={value} onValueChange={setValue} disabled={fixed && current === CREW_CODEX_REVIEWER_MODEL.model}>
          <SelectTrigger id="agent-model">
            <SelectValue placeholder={t('model.choose')} />
          </SelectTrigger>
          <SelectContent position="popper">
            {models.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Button type="submit" disabled={!dirty || save.isPending}>
        {t('model.save')}
      </Button>
    </form>
  );
}
