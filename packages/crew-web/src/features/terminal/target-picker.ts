// Danh sách dự án mở được terminal, nhóm theo máy: dùng cho menu "+" và danh sách chọn của khung nổi, và khối Terminal
// trên trang Máy.
import type { TerminalTarget } from '@/api/crew/terminal';
import type { TerminalPickerGroup } from '@/ds';

export interface TargetGroup {
  machineId: string;
  hostname: string;
  items: TerminalTarget[];
}

/** Khoá một terminal: một dự án trên một máy. */
export function targetKey(target: Pick<TerminalTarget, 'machineId' | 'projectId'>): string {
  return `${target.machineId}/${target.projectId}`;
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

/**
 * Nhóm cho menu chọn của ds; dự án đã mở (`openKeys`) có dấu tick. `note` thêm chữ vào dòng phụ (ví dụ "đang chạy trên
 * máy").
 */
export function pickerGroups(
  targets: readonly TerminalTarget[],
  openKeys: ReadonlySet<string>,
  note: (target: TerminalTarget) => string | undefined = () => undefined,
): TerminalPickerGroup[] {
  return groupTargetsByMachine(targets).map((group) => ({
    id: group.machineId,
    label: group.hostname,
    items: group.items.map((item) => ({
      id: item.projectId,
      title: item.projectName,
      detail: [item.projectKey, item.branch, note(item)].filter(Boolean).join(' · '),
      active: openKeys.has(targetKey(item)),
    })),
  }));
}
