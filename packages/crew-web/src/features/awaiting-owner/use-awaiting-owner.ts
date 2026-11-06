import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type AwaitingOwnerItem, api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';
import { useCompanyAccess } from '@/features/access';

/** Làm mới mỗi 30 giây; trả lời thẻ ở chi tiết và sự kiện live của issue làm mới ngay (khóa nằm dưới `queryKeys.crew()`). */
const AWAITING_OWNER_REFRESH_MS = 30_000;

const EMPTY: AwaitingOwnerItem[] = [];

export interface AwaitingOwner {
  items: AwaitingOwnerItem[];
  /** Id các issue đang chờ owner trả lời. */
  issueIds: ReadonlySet<string>;
}

/** Khóa query; nằm dưới tiền tố `queryKeys.crew()` nên mọi chỗ làm mới data Crew (thao tác cổng, live) đều làm mới nó. */
export const awaitingOwnerKey = (companyId: string) => queryKeys.crew('awaiting-owner', { companyId });

/**
 * Issue chưa đóng có thẻ câu hỏi/xác nhận chờ owner trả lời mà người xem thấy được. Chỉ thành viên company gọi (route trả
 * 403 cho người không có membership). Lỗi (vd. server chưa nâng cấp) thì coi như không có: trang hiện trạng thái lõi.
 */
export function useAwaitingOwner(): AwaitingOwner {
  const { company } = useCompany();
  const access = useCompanyAccess();
  const query = useQuery({
    queryKey: awaitingOwnerKey(company.id),
    queryFn: () => api.awaitingOwner.list(company.id),
    enabled: !access.loading && access.membershipRole !== null,
    refetchInterval: AWAITING_OWNER_REFRESH_MS,
  });
  const items = query.data ?? EMPTY;
  const issueIds = useMemo(() => new Set(items.map((item) => item.issueId)), [items]);
  return { items, issueIds };
}
