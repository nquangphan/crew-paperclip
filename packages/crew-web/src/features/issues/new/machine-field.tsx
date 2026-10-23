// crew: tự dựng
import { useQuery } from '@tanstack/react-query';
import { api, type MachineCandidate, queryKeys } from '@/api';
import { Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ds';
import { useT } from '@/i18n';

/** Giá trị "Tự chọn": Crew chọn máy ngay trước run đầu tiên của cây yêu cầu. */
export const AUTO_MACHINE = 'auto';

type Translate = ReturnType<typeof useT>['t'];

/** Số theo ngôn ngữ giao diện (`3,9` ở tiếng Việt); không phải số thì `—`. */
export function formatMachineNumber(value: unknown, lang: string, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: digits }).format(value)
    : '—';
}

/** Ghi chú trạng thái project trên máy; máy đã dựng xong thì không có ghi chú. */
function machineStatusNote(t: Translate, status: MachineCandidate['status']): string | null {
  if (status === 'ready') return null;
  if (status === 'provisioning') return t('new.machineProvisioning');
  if (status === 'failed') return t('new.machineBuildFailed');
  return t('new.machineFirstBuild');
}

/** "Phans-Mac-mini · 0 run · load 1,2", thêm ghi chú ("sẽ dựng lần đầu", "đang dựng", "dựng hỏng") khi máy chưa sẵn sàng. */
export function machineOptionLabel(t: Translate, lang: string, machine: MachineCandidate): string {
  const base = t('new.machineOption', {
    host: machine.hostname,
    running: machine.running,
    load: formatMachineNumber(machine.load1, lang),
  });
  const note = machineStatusNote(t, machine.status);
  return note === null ? base : `${base} · ${note}`;
}

/** Ô "Máy thực thi" của form yêu cầu gốc, chỉ owner thấy. Danh sách: máy đã ghép đang online. */
export function MachineField({
  companyId,
  projectId,
  value,
  onChange,
}: {
  companyId: string;
  projectId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t, lang } = useT('issues');
  const query = useQuery({
    queryKey: queryKeys.machineCandidates(companyId, projectId),
    queryFn: () => api.machinePins.candidates(companyId, projectId),
    enabled: projectId !== '',
  });
  const online = (query.data ?? []).filter((machine) => machine.online);
  return (
    <Field label={t('new.machine')} hint={query.error ? t('new.machineFailed') : t('new.machineHint')}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={t('new.machine')} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_MACHINE}>{t('new.machineAuto')}</SelectItem>
          {online.map((machine) => (
            <SelectItem key={machine.machineId} value={machine.machineId}>
              {machineOptionLabel(t, lang, machine)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
