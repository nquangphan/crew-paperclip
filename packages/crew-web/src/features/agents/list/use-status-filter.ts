// Bộ lọc trạng thái của danh sách agent (S10.2): giữ trong state của trang, không ghi DB. `removed` (agent đã gỡ) là
// bộ lọc riêng; các bộ lọc khác không hiện agent đã gỡ.
import { useState } from 'react';

export const STATUS_FILTERS = ['all', 'running', 'paused', 'error', 'removed'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function useStatusFilter(): [
  StatusFilter,
  (next: StatusFilter) => void,
  typeof STATUS_FILTERS,
  (status: string, removed: boolean) => boolean,
] {
  const [filter, setFilter] = useState<StatusFilter>('all');
  return [
    filter,
    setFilter,
    STATUS_FILTERS,
    (status, removed) => (filter === 'removed' ? removed : !removed && (filter === 'all' || status === filter)),
  ];
}
