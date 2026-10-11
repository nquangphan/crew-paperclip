import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Contribution, type ContributionFilters, type NewContribution, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { useCompanyAccess } from '@/features/access';

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

/** Danh sách góp ý của company (owner: mọi mục, khách: mục của mình), mới nhất trước. */
export function useContributions(filters: ContributionFilters = {}) {
  const { company } = useCompany();
  return useQuery({
    queryKey: queryKeys.contributions(company.id, filters),
    queryFn: () => api.contributions.list(company.id, filters),
  });
}

/**
 * Bình luận góp ý của một issue (mọi trạng thái). Chỉ owner và khách góp ý đọc được route này; người khác không gọi,
 * để không sinh lỗi 403 vô ích.
 */
export function useIssueContributions(issueId: string): Contribution[] {
  const { company } = useCompany();
  const { isOwner, isContributor } = useCompanyAccess();
  const query = useQuery({
    queryKey: queryKeys.contributions(company.id, { issueId }),
    queryFn: () => api.contributions.list(company.id, { issueId }),
    enabled: isOwner || isContributor,
  });
  return query.data ?? [];
}

/** Gửi góp ý mới; xong thì làm mới danh sách và số đếm. */
export function useCreateContribution() {
  const { company } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewContribution) => api.contributions.create(company.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.contributions(company.id) }),
  });
}

/** Tên hiển thị theo user id (từ user-directory, viewer cũng đọc được). */
export function useAuthorNames(): (userId: string) => string | null {
  const { company } = useCompany();
  const dir = useQuery({
    queryKey: queryKeys.userDirectory(company.id),
    queryFn: () => api.members.userDirectory(company.id),
    staleTime: 60_000,
  });
  const names = new Map((dir.data ?? []).map((e) => [e.principalId, e.user?.name ?? e.user?.email ?? null] as const));
  return (userId) => names.get(userId) ?? null;
}
