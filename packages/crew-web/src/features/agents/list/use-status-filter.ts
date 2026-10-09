// Bộ lọc trạng thái của danh sách agent (S10.2): giữ trong state của trang, không ghi DB.
import { useState } from 'react';

export const STATUS_FILTERS = ['all', 'running', 'paused', 'error'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function useStatusFilter(): [
  StatusFilter,
  (next: StatusFilter) => void,
  typeof STATUS_FILTERS,
  (status: string) => boolean,
] {
  const [filter, setFilter] = useState<StatusFilter>('all');
  return [filter, setFilter, STATUS_FILTERS, (status) => filter === 'all' || status === filter];
}
