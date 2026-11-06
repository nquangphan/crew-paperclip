// Nhãn máy của một yêu cầu theo bốn trạng thái (online, offline, đã gỡ ghép, chưa ghim), chữ lấy từ i18n.
// `cell`: cột Máy trên desktop, có tooltip, chưa ghim ghi "Chưa ghim". `inline`: dòng phụ màn hẹp và thẻ Bảng, kèm chữ
// trạng thái. `option`: mục bộ lọc, chữ trạng thái xuống dòng. Không bao giờ hiện `machineId`.
import type { IssueMachineSummary } from '@/api';
import { MachineLabel } from '@/ds';
import { useT } from '@/i18n';
import { machineStateOf } from './machines';

interface IssueMachineLabelProps {
  machine: IssueMachineSummary | null;
  names: ReadonlyMap<string, string>;
  variant: 'cell' | 'inline' | 'option';
  /** Chữ thay tên cho máy đã gỡ ghép (không có tên), vd. "Đã gỡ ghép #2" trong bộ lọc; mặc định "Đã gỡ ghép". */
  unnamedLabel?: string;
}

export function IssueMachineLabel({ machine, names, variant, unnamedLabel }: IssueMachineLabelProps) {
  const { t } = useT('issues');
  const state = machineStateOf(machine);
  if (state === 'unpinned' || !machine) {
    return variant === 'inline' ? null : (
      <MachineLabel
        state="unpinned"
        name={t('machine.unpinned')}
        layout={variant === 'option' ? 'option' : 'inline'}
        tooltip={variant === 'cell' ? t('machine.tip.unpinned') : undefined}
      />
    );
  }
  const name = names.get(machine.machineId) ?? null;
  const fullName = machine.hostname ?? null;
  const stateLabel = t(`machine.state.${state}`);
  return (
    <MachineLabel
      state={state}
      name={name ?? unnamedLabel ?? t('machine.unpaired')}
      strike={state === 'unpaired' && name !== null}
      stateText={variant !== 'cell' && state !== 'online' && name !== null ? stateLabel : undefined}
      layout={variant === 'option' ? 'option' : 'inline'}
      ariaLabel={
        name ? t('machine.aria', { name, state: stateLabel }) : t('machine.ariaUnnamed', { state: stateLabel })
      }
      tooltip={
        variant === 'cell' ? (
          <span className="flex flex-col">
            {fullName ? <strong>{fullName}</strong> : null}
            <span>{t(`machine.tip.${state}`)}</span>
          </span>
        ) : undefined
      }
    />
  );
}
