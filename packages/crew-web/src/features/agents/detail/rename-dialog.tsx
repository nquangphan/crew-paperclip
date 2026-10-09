// Đổi tên hiển thị và biểu tượng agent (S11.7): PATCH /agents/:id chỉ có name và icon.
import type { Agent } from '@paperclipai/shared';
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
} from '@/ds';
import { useT } from '@/i18n';

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: Pick<Agent, 'id' | 'name' | 'icon'>;
  companyId: string;
  onSaved?: (agent: Agent) => void;
}

export function RenameDialog({ open, onOpenChange, agent, companyId, onSaved }: RenameDialogProps) {
  const { t } = useT('agents');
  const [name, setName] = useState(agent.name);
  const [icon, setIcon] = useState(agent.icon ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.agents.update(agent.id, { name: name.trim(), icon: icon.trim() === '' ? null : icon.trim() }, companyId),
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
          <DialogDescription>{agent.name}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blank && !save.isPending) save.mutate();
          }}
        >
          <Field label={t('rename.name')} htmlFor="agent-name" error={save.error?.message}>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('rename.icon')} hint={t('rename.iconHint')} htmlFor="agent-icon">
            <Input id="agent-icon" value={icon} onChange={(e) => setIcon(e.target.value)} />
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
