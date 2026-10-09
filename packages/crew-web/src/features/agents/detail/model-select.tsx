// Đổi model mặc định của agent (S11.5): chỉ chọn trong CREW_MODELS; PATCH merge adapterConfig, không gửi
// replaceAdapterConfig và không gửi khóa nào khác ngoài `model` (command/extraArgs/env giữ nguyên ở server).
import type { Agent } from '@paperclipai/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/api';
import { Button, Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ds';
import { useT } from '@/i18n';
import { CREW_MODELS, isCrewModel } from '@/lib/instructions';

interface ModelSelectProps {
  agent: Pick<Agent, 'id' | 'adapterConfig'>;
  companyId: string;
  onSaved?: (agent: Agent) => void;
}

export function ModelSelect({ agent, companyId, onSaved }: ModelSelectProps) {
  const { t } = useT('agents');
  const queryClient = useQueryClient();
  const current = typeof agent.adapterConfig.model === 'string' ? agent.adapterConfig.model : '';
  const [value, setValue] = useState(isCrewModel(current) ? current : '');
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
        hint={current !== '' && !isCrewModel(current) ? t('model.outside', { model: current }) : undefined}
        error={save.error?.message}
      >
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id="agent-model">
            <SelectValue placeholder={t('model.choose')} />
          </SelectTrigger>
          <SelectContent position="popper">
            {CREW_MODELS.map((model) => (
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
