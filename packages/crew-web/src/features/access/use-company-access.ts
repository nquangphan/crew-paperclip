import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';

export interface CompanyAccessState {
  /** Có membership `owner`: duyệt góp ý, mời khách, xem trang Thành viên. */
  isOwner: boolean;
  /** Viewer có dấu khách góp ý (Phòng Marketing). */
  isContributor: boolean;
  /**
   * UI chỉ đọc: ẩn mọi nút ghi. Đúng với viewer, và cả lúc đang tải để nút ghi không chớp lên rồi biến mất.
   * Lỗi tải thì không coi là chỉ đọc: server vẫn là cổng thật (viewer ghi nhận 403), UI chỉ bớt nút chết.
   */
  readOnly: boolean;
  loading: boolean;
}

/** Suy trạng thái từ câu trả lời `GET /access`; tách riêng để test không cần React. */
export function deriveAccess(
  data: { membershipRole: string | null; contributor: boolean } | undefined,
  loading: boolean,
): CompanyAccessState {
  const viewer = data?.membershipRole === 'viewer';
  return {
    isOwner: data?.membershipRole === 'owner',
    isContributor: viewer && data?.contributor === true,
    readOnly: loading || viewer,
    loading,
  };
}

/** Vai trò của người dùng trong company đang xem. Chỉ dùng bên trong shell company. */
export function useCompanyAccess(): CompanyAccessState {
  const { company } = useCompany();
  const query = useQuery({
    queryKey: queryKeys.access(company.id),
    queryFn: () => api.contributions.access(company.id),
    staleTime: 60_000,
  });
  return deriveAccess(query.data, query.isPending);
}
