// Lọc agent đã gỡ khỏi các hộp chọn agent (vai trò, bộ lọc người làm, bật skill), đọc setup run gỡ của company.
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { withoutRemovedAgents } from './removal-state';

/** Trả hàm lọc; chưa đọc được setup run thì giữ nguyên danh sách. */
export function useSelectableAgents(companyId: string) {
  const runs = useQuery({
    queryKey: queryKeys.crew('crew.setupRuns', { companyId }),
    queryFn: () => api.crew.setupRuns(companyId),
  });
  return <A extends { id: string; status?: string | null }>(
    agents: readonly A[] | undefined,
    keep: readonly (string | null | undefined)[] = [],
  ): A[] => withoutRemovedAgents(agents ?? [], runs.data ?? [], keep);
}
