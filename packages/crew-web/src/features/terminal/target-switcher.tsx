// Nút tiêu đề của trang terminal: tên dự án và máy đang mở; bấm ra danh sách mọi dự án sẵn sàng, nhóm theo máy, để đổi
// sang terminal khác mà không phải quay về trang Máy.
import type { TerminalTarget } from '@/api/crew/terminal';
import { TerminalSwitcher } from '@/ds';
import { useT } from '@/i18n';

export interface TargetGroup {
  machineId: string;
  hostname: string;
  items: TerminalTarget[];
}

/** Nhóm theo máy, giữ thứ tự server trả. */
export function groupTargetsByMachine(targets: readonly TerminalTarget[]): TargetGroup[] {
  const groups = new Map<string, TargetGroup>();
  for (const target of targets) {
    const group = groups.get(target.machineId) ?? { machineId: target.machineId, hostname: target.hostname, items: [] };
    group.items.push(target);
    groups.set(target.machineId, group);
  }
  return [...groups.values()];
}

export function TargetSwitcher({
  targets,
  current,
  fallbackTitle,
  onSelect,
}: {
  targets: readonly TerminalTarget[];
  current: TerminalTarget | undefined;
  /** Tiêu đề khi chưa tải xong hoặc không tìm thấy dự án. */
  fallbackTitle: string;
  onSelect: (target: TerminalTarget) => void;
}) {
  const { t } = useT('terminal');
  const groups = groupTargetsByMachine(targets);
  return (
    <TerminalSwitcher
      label={t('switchTarget')}
      title={current?.projectName ?? fallbackTitle}
      detail={current ? [current.hostname, current.branch].filter(Boolean).join(' · ') : undefined}
      emptyLabel={t('noTargets')}
      groups={groups.map((group) => ({
        id: group.machineId,
        label: group.hostname,
        items: group.items.map((item) => ({
          id: item.projectId,
          title: item.projectName,
          detail: [item.projectKey, item.branch].filter(Boolean).join(' · '),
          active: item.machineId === current?.machineId && item.projectId === current?.projectId,
        })),
      }))}
      onSelect={(machineId, projectId) => {
        const next = targets.find((x) => x.machineId === machineId && x.projectId === projectId);
        if (next) onSelect(next);
      }}
    />
  );
}
