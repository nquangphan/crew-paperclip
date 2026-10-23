// crew: tự dựng
import type { Issue } from '@paperclipai/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type IssueMachine, queryKeys } from '@/api';
import { Button, ErrorState, PropertyRow, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ds';
import { useCompanyAccess } from '@/features/access';
import { useT } from '@/i18n';
import { formatMachineNumber, machineOptionLabel } from '../../new/machine-field';

type Translate = ReturnType<typeof useT>['t'];

/** "Mac mini · tự chọn (2 run, load 3,9, RAM trống 54%)", "· Đại Ca chọn", hoặc chưa chọn. */
export function machineLine(t: Translate, lang: string, view: IssueMachine): string {
  const pin = view.pin;
  if (!pin) return t('crew.machine.none');
  if (pin.source === 'owner') return t('crew.machine.owner', { host: pin.hostname });
  if (pin.reason.backfill === true) return t('crew.machine.backfill', { host: pin.hostname });
  return t('crew.machine.auto', {
    host: pin.hostname,
    running: typeof pin.reason.running === 'number' ? pin.reason.running : 0,
    load: formatMachineNumber(pin.reason.load1, lang),
    mem: formatMachineNumber(pin.reason.memFreePct, lang, 0),
  });
}

/**
 * Dòng "Máy" ở cột Thuộc tính: máy của cả cây yêu cầu. Owner đổi được ở yêu cầu gốc khi cây chưa có run. Không
 * đọc được (plugin chưa nâng cấp, mạng) thì ẩn dòng, không chặn trang.
 */
export function MachineSlot({ issue }: { issue: Issue }) {
  const { t, lang } = useT('issues');
  const { isOwner } = useCompanyAccess();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState('');
  const view = useQuery({
    queryKey: queryKeys.issueMachine(issue.id),
    queryFn: () => api.machinePins.get(issue.companyId, issue.id),
  });
  const projectId = issue.projectId ?? '';
  const canChange = isOwner && view.data?.isRoot === true && view.data.locked === false && projectId !== '';
  const candidates = useQuery({
    queryKey: queryKeys.machineCandidates(issue.companyId, projectId),
    queryFn: () => api.machinePins.candidates(issue.companyId, projectId),
    enabled: editing && canChange,
  });
  const save = useMutation({
    mutationFn: (machineId: string) => api.machinePins.set(issue.companyId, issue.id, machineId),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.issueMachine(issue.id), next);
      setEditing(false);
    },
  });
  if (view.error || !view.data) return null;
  return (
    <PropertyRow label={t('crew.machine.label')} wrap>
      <span className="flex flex-col gap-1">
        <span data-testid="issue-machine">{machineLine(t, lang, view.data)}</span>
        {canChange && !editing ? (
          <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setEditing(true)}>
            {t('crew.machine.change')}
          </Button>
        ) : null}
        {editing ? (
          <span className="flex flex-wrap items-center gap-2">
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger aria-label={t('crew.machine.label')} className="w-full">
                <SelectValue placeholder={t('crew.machine.pick')} />
              </SelectTrigger>
              <SelectContent>
                {(candidates.data ?? [])
                  .filter((machine) => machine.online)
                  .map((machine) => (
                    <SelectItem key={machine.machineId} value={machine.machineId}>
                      {machineOptionLabel(t, lang, machine)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" disabled={!choice || save.isPending} onClick={() => save.mutate(choice)}>
              {t('crew.machine.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('crew.machine.cancel')}
            </Button>
          </span>
        ) : null}
        {save.error ? <ErrorState title={t('crew.machine.changeFailed')} message={save.error.message} /> : null}
      </span>
    </PropertyRow>
  );
}
