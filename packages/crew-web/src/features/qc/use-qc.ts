import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type QcIssueState, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { useCompanyAccess } from '@/features/access';

/** Làm mới trạng thái QC mỗi 30 giây (và ngay sau Xác nhận đạt, Chưa đạt, quyết định của owner). */
const QC_REFRESH_MS = 30_000;

const EMPTY: QcIssueState[] = [];

export interface QcStates {
  items: QcIssueState[];
  /** Theo id issue. */
  byIssue: ReadonlyMap<string, QcIssueState>;
}

/**
 * Vòng QC đang mở của các yêu cầu đã Xong mà người xem thấy được. Chỉ thành viên company gọi (route trả 403 cho người
 * không có membership). Lỗi (vd. server chưa nâng cấp) thì coi như không có yêu cầu nào ở vòng QC: trang vẫn hiện
 * trạng thái lõi như cũ.
 */
export function useQcStates(): QcStates {
  const { company } = useCompany();
  const access = useCompanyAccess();
  const query = useQuery({
    queryKey: queryKeys.qc(company.id),
    queryFn: () => api.qc.list(company.id),
    enabled: !access.loading && access.membershipRole !== null,
    refetchInterval: QC_REFRESH_MS,
  });
  const items = query.data ?? EMPTY;
  const byIssue = useMemo(() => new Map(items.map((s) => [s.issueId, s] as const)), [items]);
  return { items, byIssue };
}

/** Sau mỗi thao tác QC: làm tươi trạng thái QC, góp ý (số chờ duyệt) và issue. */
export function useRefreshQc() {
  const { company } = useCompany();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.qc(company.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.contributions(company.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.sidebarBadges(company.id) });
  };
}

/** QC (hoặc owner) Xác nhận đạt: chỉ đổi trạng thái QC, không chạm yêu cầu. */
export function useVerifyQc() {
  const { company } = useCompany();
  const qc = useQueryClient();
  const refresh = useRefreshQc();
  return useMutation({
    mutationFn: (issueId: string) => api.qc.verify(company.id, issueId),
    onSuccess: (state) => {
      qc.setQueryData<QcIssueState[]>(queryKeys.qc(company.id), (items) =>
        items?.map((s) => (s.issueId === state.issueId ? state : s)),
      );
      refresh();
    },
    onError: refresh,
  });
}

/** QC báo "Chưa đạt" kèm lý do: gửi cho owner duyệt; agent chỉ thấy lý do khi owner duyệt. */
export function useRequestReopen() {
  const { company } = useCompany();
  const refresh = useRefreshQc();
  return useMutation({
    mutationFn: ({ issueId, reason }: { issueId: string; reason: string }) =>
      api.contributions.create(company.id, { kind: 'reopen', issueId, body: reason }),
    onSettled: refresh,
  });
}
