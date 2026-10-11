import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';

/** Làm mới số mục chờ duyệt mỗi 30 giây (và sau mỗi lần gửi/duyệt/từ chối, do nơi đó invalidate `contributions(c)`). */
const SUMMARY_REFRESH_MS = 30_000;

/**
 * Số mục góp ý đang chờ cho badge sidebar: owner thấy mọi mục, khách thấy mục của mình. Trả null khi chưa có số liệu
 * hoặc `enabled` tắt.
 */
export function useContributionsSummary(companyId: string, enabled: boolean): number | null {
  const query = useQuery({
    queryKey: queryKeys.contributionsSummary(companyId),
    queryFn: () => api.contributions.summary(companyId),
    enabled,
    refetchInterval: SUMMARY_REFRESH_MS,
  });
  return query.data?.pending ?? null;
}
