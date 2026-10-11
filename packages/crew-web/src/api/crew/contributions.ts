// Góp ý chờ duyệt của Phòng Marketing: router Crew của server (hợp đồng ở spec góp ý chờ duyệt, mục API).
// Duyệt gồm ba bước: `approve` (khóa, trả nội dung cần đăng) → trình duyệt owner đăng qua route stock của board →
// `complete` (server tự tìm bản ghi đã đăng). Server trả 409 khi chưa tìm thấy bản ghi hoặc mục đã chốt.
import { call } from '../endpoints';
import type {
  CompanyAccess,
  Contribution,
  ContributionApproval,
  ContributionFilters,
  ContributionPage,
  Contributor,
  NewContribution,
} from './types';

export const contributionsApi = {
  /** Vai trò của người đang đăng nhập trong company; UI dùng để ẩn nút ghi và chọn composer. */
  access: (companyId: string): Promise<CompanyAccess> => call('access.get', { companyId }),
  /** Trang đầu của danh sách (owner: mọi mục; khách: mục của mình), mới nhất trước, tối đa 200 mục. */
  list: async (companyId: string, filters: ContributionFilters = {}): Promise<Contribution[]> =>
    (await contributionsApi.page(companyId, filters)).items,
  /** Một trang danh sách; trang kế đọc bằng `before = nextBefore` (null: đã hết). */
  page: (companyId: string, filters: ContributionFilters = {}, before?: string): Promise<ContributionPage> =>
    call('contributions.list', { companyId }, { query: before ? { ...filters, before } : filters }),
  /** Số mục đang chờ (gồm đang duyệt dở) để hiện badge. */
  summary: (companyId: string): Promise<{ pending: number }> => call('contributions.summary', { companyId }),
  get: (companyId: string, id: string): Promise<Contribution> => call('contributions.get', { companyId, id }),
  create: (companyId: string, body: NewContribution): Promise<Contribution> =>
    call('contributions.create', { companyId }, { body }),
  /** Bước 1 của duyệt: khóa mục và nhận nội dung để đăng. Gọi lại an toàn (cùng khóa idempotent). */
  approve: (companyId: string, id: string): Promise<ContributionApproval> =>
    call('contributions.approve', { companyId, id }),
  /** Bước 3 của duyệt: server tự tìm bản ghi đã đăng; 409 `crew_contribution_not_materialized` nếu chưa thấy. */
  complete: (companyId: string, id: string): Promise<Contribution> => call('contributions.complete', { companyId, id }),
  reject: (companyId: string, id: string): Promise<Contribution> => call('contributions.reject', { companyId, id }),
  /** Người đang có dấu khách góp ý (chỉ owner). */
  contributors: async (companyId: string): Promise<Contributor[]> => {
    const res: { items: Contributor[] } = await call('contributors.list', { companyId });
    return res.items;
  },
  /** Bật dấu cho viewer đang hoạt động; 409 `crew_contributor_requires_viewer` nếu người đó không phải viewer. */
  enableContributor: (companyId: string, userId: string): Promise<void> =>
    call('contributors.set', { companyId, userId }),
  disableContributor: (companyId: string, userId: string): Promise<void> =>
    call('contributors.remove', { companyId, userId }),
};

export const __endpoints = [
  'access.get',
  'contributions.approve',
  'contributions.complete',
  'contributions.create',
  'contributions.get',
  'contributions.list',
  'contributions.reject',
  'contributions.summary',
  'contributors.list',
  'contributors.remove',
  'contributors.set',
];
