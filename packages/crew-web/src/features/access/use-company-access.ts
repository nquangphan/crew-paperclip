import { useQuery } from '@tanstack/react-query';
import { api, type ContributorDepartment, queryKeys } from '@/api';
import { useCompany } from '@/app/hooks';

export interface CompanyAccessState {
  /** Có membership `owner`: duyệt góp ý, mời khách, xem trang Thành viên. */
  isOwner: boolean;
  /** Viewer có dấu khách góp ý (Phòng Marketing hoặc Phòng QC); hai phòng cùng quyền. */
  isContributor: boolean;
  /** Phòng của khách góp ý; null khi không phải khách góp ý. */
  department: ContributorDepartment | null;
  /** Vai trò thành viên ở lõi (`owner`, `admin`, `operator`, `viewer`); null khi đang tải hoặc không có membership. */
  membershipRole: string | null;
  /**
   * UI chỉ đọc: ẩn mọi nút ghi. Đúng với viewer, và cả lúc đang tải để nút ghi không chớp lên rồi biến mất.
   * Lỗi tải thì không coi là chỉ đọc: server vẫn là cổng thật (viewer ghi nhận 403), UI chỉ bớt nút chết.
   */
  readOnly: boolean;
  loading: boolean;
  /** Lỗi tải vai trò (sau khi đã thử lại); null khi ổn. Owner lúc này mất phần duyệt góp ý, nên route cần vai trò báo lỗi. */
  error: Error | null;
  /** Tải lại vai trò. */
  retry: () => void;
}

/** Suy trạng thái từ câu trả lời `GET /access`; tách riêng để test không cần React. */
export function deriveAccess(
  data: { membershipRole: string | null; contributor: boolean; department?: ContributorDepartment | null } | undefined,
  loading: boolean,
): Omit<CompanyAccessState, 'error' | 'retry'> {
  const viewer = data?.membershipRole === 'viewer';
  const isContributor = viewer && data?.contributor === true;
  return {
    isOwner: data?.membershipRole === 'owner',
    isContributor,
    // Server cũ chưa trả phòng: khách góp ý khi đó là Phòng Marketing.
    department: isContributor ? (data?.department ?? 'marketing') : null,
    membershipRole: data?.membershipRole ?? null,
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
  return {
    ...deriveAccess(query.data, query.isPending),
    error: query.data ? null : query.error,
    retry: () => void query.refetch(),
  };
}
