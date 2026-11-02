// Danh sách dự án mở được terminal, nhóm theo máy: dùng cho menu "+" và danh sách chọn của khung nổi, và khối Terminal
// trên trang Máy.
import type { TerminalTarget } from '@/api/crew/terminal';
import type { TerminalPickerGroup } from '@/ds';

export interface TargetGroup {
  machineId: string;
  hostname: string;
  items: TerminalTarget[];
}

/** Khoá một dự án trên một máy. */
export function targetKey(target: Pick<TerminalTarget, 'machineId' | 'projectId'>): string {
  return `${target.machineId}/${target.projectId}`;
}

/** Mỗi dự án trên mỗi máy mở được tối đa chừng này terminal (slot 1..9, server cũng chặn). */
export const MAX_SLOTS = 9;

/** Một terminal: slot thứ mấy của một dự án trên một máy; mỗi slot là một phiên tmux riêng, chung worktree owner. */
export interface TabRef {
  machineId: string;
  projectId: string;
  slot: number;
}

/** Khoá một tab terminal. */
export function tabKey(ref: TabRef): string {
  return `${targetKey(ref)}/${ref.slot}`;
}

/** Slot nhỏ nhất trong 1..`MAX_SLOTS` chưa nằm trong `used`; hết thì null. */
export function freeSlot(used: Iterable<number>): number | null {
  const taken = new Set(used);
  for (let slot = 1; slot <= MAX_SLOTS; slot++) if (!taken.has(slot)) return slot;
  return null;
}

/** Tên hiển thị của một terminal: slot 1 là tên dự án, slot từ 2 thêm "(n)". */
export function tabTitle(name: string, slot: number): string {
  return slot > 1 ? `${name} (${slot})` : name;
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
 * Nhóm cho menu chọn của ds; dự án đã có tab (`openKeys` theo `targetKey`) có dấu tick. `note` thêm chữ vào dòng phụ (ví dụ "đang chạy trên
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
