// Yêu cầu chờ owner trả lời thẻ câu hỏi/xác nhận: router Crew của server (chỉ đọc, mọi thành viên, lọc theo quyền xem
// project). Danh sách lõi chỉ báo thẻ chờ của issue đang duyệt, nên issue Đang làm hay Đang bị chặn cần route này.
import { call } from '../endpoints';
import type { AwaitingOwnerItem } from './types';

export const awaitingOwnerApi = {
  list: async (companyId: string): Promise<AwaitingOwnerItem[]> => {
    const res: { items: AwaitingOwnerItem[] } = await call('awaitingOwner.list', { companyId });
    return res.items;
  },
};

export const __endpoints = ['awaitingOwner.list'];
