// Gỡ máy đã ghép (S15.4, route board của plugin). Lỗi trả câu tiếng Việt của server, hiện nguyên văn:
// 403 chỉ board, 404 máy chưa được ghép. Gọi lại khi đã gỡ vẫn trả 200 (idempotent).
import { call } from '../endpoints';

export const machinesApi = {
  unpair: (companyId: string, machineId: string): Promise<{ environmentId: string; revokedAt: string }> =>
    call('machines.unpair', { machineId }, { body: { companyId } }),
};

export const __endpoints = ['machines.unpair'];
