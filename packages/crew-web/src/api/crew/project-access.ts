// Quyền xem project theo thành viên: router Crew của server (gắn cùng router góp ý). Owner thấy mọi project; thành
// viên khác chỉ thấy project owner đã cấp. Chỉ UI Crew áp luật này, API lõi không đổi.
import { call } from '../endpoints';
import type { MemberProjectAccess, ProjectAccess } from './types';

export const projectAccessApi = {
  /** Project người đang đăng nhập được xem. */
  me: (companyId: string): Promise<ProjectAccess> => call('projectAccess.me', { companyId }),
  /** Quyền của mọi thành viên đang hoạt động (chỉ owner). */
  list: async (companyId: string): Promise<MemberProjectAccess[]> => {
    const res: { items: MemberProjectAccess[] } = await call('projectAccess.list', { companyId });
    return res.items;
  },
  /** Thay toàn bộ danh sách project một thành viên được xem (chỉ owner; owner khác không đặt được). */
  set: (companyId: string, userId: string, projectIds: string[]): Promise<MemberProjectAccess> =>
    call('projectAccess.set', { companyId, userId }, { body: { projectIds } }),
};

export const __endpoints = ['projectAccess.list', 'projectAccess.me', 'projectAccess.set'];
