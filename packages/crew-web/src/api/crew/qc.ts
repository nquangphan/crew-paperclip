// Phòng QC duyệt lại yêu cầu do mình gửi: router Crew của server. Yêu cầu của Phòng QC khi Xong thì "Chờ QC duyệt";
// QC (hoặc owner) Xác nhận đạt chỉ đổi trạng thái QC. "Chưa đạt" là góp ý kind `reopen` (contributions.create).
import { call } from '../endpoints';
import type { QcIssueState } from './types';

export const qcApi = {
  /** Vòng QC đang mở của các yêu cầu đã Xong mà người xem thấy được. */
  list: async (companyId: string): Promise<QcIssueState[]> => {
    const res: { items: QcIssueState[] } = await call('qc.list', { companyId });
    return res.items;
  },
  /** Xác nhận đạt: chỉ người QC đã gửi yêu cầu hoặc owner; 409 `crew_qc_reopen_pending` khi đang chờ owner mở lại. */
  verify: (companyId: string, issueId: string): Promise<QcIssueState> => call('qc.verify', { companyId, issueId }),
};

export const __endpoints = ['qc.list', 'qc.verify'];
