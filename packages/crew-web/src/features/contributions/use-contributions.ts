import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Contribution, type ContributionFilters, type NewContribution, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { useCompanyAccess } from '@/features/access';
import { approveContribution, contributionFromError, type IssueApprovalChoices } from './approve-flow';

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
export function useContributions(filters: ContributionFilters = {}, options: { enabled?: boolean } = {}) {
  const { company } = useCompany();
  return useQuery({
    queryKey: queryKeys.contributions(company.id, filters),
    queryFn: () => api.contributions.list(company.id, filters),
    enabled: options.enabled ?? true,
  });
}

/** Một mục góp ý (owner hoặc tác giả). Khóa nằm dưới tiền tố `contributions(c)` để cùng được làm mới. */
export function useContribution(id: string) {
  const { company } = useCompany();
  return useQuery({
    queryKey: [...queryKeys.contributions(company.id), 'item', id],
    queryFn: () => api.contributions.get(company.id, id),
  });
}

/** Thay mục `next` vào mọi cache góp ý của company (danh sách và chi tiết) mà không chờ tải lại. */
function patchContributionCache(qc: QueryClient, companyId: string, next: Contribution) {
  qc.setQueriesData({ queryKey: queryKeys.contributions(companyId) }, (data: unknown) => {
    if (Array.isArray(data)) return data.map((c: Contribution) => (c.id === next.id ? next : c));
    if (data && typeof data === 'object' && (data as Contribution).id === next.id) return next;
    return data;
  });
}

/** Sau khi duyệt/từ chối (thành công hay lỗi): làm tươi góp ý, số đếm, danh sách issue và luồng bình luận. */
function useRefreshAfterDecision() {
  const { company } = useCompany();
  const qc = useQueryClient();
  return (contribution: Contribution, latest: Contribution | null) => {
    if (latest) patchContributionCache(qc, company.id, latest);
    void qc.invalidateQueries({ queryKey: queryKeys.contributions(company.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.issues(company.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.sidebarBadges(company.id) });
    if (contribution.targetIssueId)
      void qc.invalidateQueries({ queryKey: queryKeys.comments(contribution.targetIssueId) });
  };
}

/** Duyệt một mục (ba bước ở `approve-flow`). Lỗi 409 kèm mục mới nhất thì thay ngay vào cache. */
export function useApproveContribution() {
  const { company } = useCompany();
  const refresh = useRefreshAfterDecision();
  return useMutation({
    mutationFn: ({ contribution, choices }: { contribution: Contribution; choices: IssueApprovalChoices | null }) =>
      approveContribution(company.id, contribution, choices),
    onSuccess: (done, { contribution }) => refresh(contribution, done),
    onError: (error, { contribution }) => refresh(contribution, contributionFromError(error)),
  });
}

/** Từ chối một mục. Lỗi 409 kèm mục mới nhất (ví dụ đã được duyệt) thì thay ngay vào cache. */
export function useRejectContribution() {
  const { company } = useCompany();
  const refresh = useRefreshAfterDecision();
  return useMutation({
    mutationFn: (contribution: Contribution) => api.contributions.reject(company.id, contribution.id),
    onSuccess: (done, contribution) => refresh(contribution, done),
    onError: (error, contribution) => refresh(contribution, contributionFromError(error)),
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
