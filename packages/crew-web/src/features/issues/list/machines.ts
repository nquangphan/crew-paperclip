// Máy của cây chứa từng yêu cầu trên danh sách và Bảng: một request lô (`POST …/issue-machines`) cho mọi yêu cầu đang
// tải, tên máy gọn, trạng thái nhãn và lọc theo máy ở máy khách. Mockup: docs/design/mockups/tps-750-machine-label.
import type { CompactIssue } from '@paperclipai/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type IssueMachineSummary, queryKeys } from '@/api';
import type { MachineLabelState } from '@/ds';

/** Kết quả route lô: id yêu cầu → máy của cây, `null` là cây chưa ghim. */
export type IssueMachines = Readonly<Record<string, IssueMachineSummary | null>>;

/** Giá trị lọc "Chưa ghim" trong `?machine=` (không dùng `none`: `patchParams` coi `none` là mặc định và bỏ khóa). */
export const MACHINE_FILTER_NONE = 'unpinned';

/** Tên gọn: hostname máy báo, bỏ hậu tố miền (`demo-mac-02.local` → `demo-mac-02`). */
export function machineShortName(hostname: string): string {
  const short = hostname.split('.')[0];
  return short || hostname;
}

/**
 * Tên hiện của từng máy (theo `machineId`). Hai máy trùng tên gọn thì máy sau thêm "#2", "#3"… theo thứ tự `machineId`
 * để ổn định giữa các lần tải; máy đã gỡ ghép (không có hostname) không có tên.
 */
export function machineDisplayNames(machines: Iterable<IssueMachineSummary | null>): ReadonlyMap<string, string> {
  const byId = new Map<string, string>();
  for (const m of machines) if (m?.hostname) byId.set(m.machineId, machineShortName(m.hostname));
  const names = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const id of [...byId.keys()].sort()) {
    const short = byId.get(id) as string;
    const n = (seen.get(short) ?? 0) + 1;
    seen.set(short, n);
    names.set(id, n === 1 ? short : `${short} #${n}`);
  }
  return names;
}

export function machineStateOf(machine: IssueMachineSummary | null): MachineLabelState {
  if (!machine) return 'unpinned';
  if (!machine.paired) return 'unpaired';
  return machine.online ? 'online' : 'offline';
}

/** Lọc theo máy: rỗng là không lọc, `unpinned` là cây chưa ghim; chưa có dữ liệu máy thì không khớp. */
export function matchesMachine(issue: CompactIssue, machine: string, items: IssueMachines | undefined): boolean {
  if (!machine) return true;
  if (!items) return false;
  const m = items[issue.id];
  if (m === undefined) return false;
  return machine === MACHINE_FILTER_NONE ? m === null : m?.machineId === machine;
}

/** Số yêu cầu theo máy (khóa `machineId`, chưa ghim là `unpinned`). */
export function machineCounts(issues: readonly CompactIssue[], items: IssueMachines): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const m = items[issue.id];
    if (m === undefined) continue;
    const key = m === null ? MACHINE_FILTER_NONE : m.machineId;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Máy của mọi yêu cầu đang tải: một request lô (client chia khúc 500 id), khóa trong `queryKeys.crew`. */
export function useIssueMachines(companyId: string, issues: readonly CompactIssue[] | undefined) {
  const issueIds = useMemo(() => (issues ?? []).map((i) => i.id).sort(), [issues]);
  const enabled = issueIds.length > 0;
  return useQuery({
    queryKey: queryKeys.crew('issue-machines', { companyId, issueIds }),
    queryFn: () => api.machinePins.issueMachines(companyId, issueIds),
    enabled,
    // Đổi bộ lọc server (trạng thái, project…) thì giữ nhãn cũ tới khi lô mới về, không nháy skeleton ô Máy. Bản cũ
    // (`isPlaceholderData`) không dùng để lọc theo máy (`IssuesPage` chờ lô mới). Danh sách rỗng thì query tắt, không
    // giữ bản cũ để khỏi kẹt ở trạng thái chờ.
    placeholderData: enabled ? keepPreviousData : undefined,
  });
}
