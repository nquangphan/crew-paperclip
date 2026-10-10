// Ép Done (S6.17): route board của plugin crew.core. Agent gọi sẽ nhận 403; lý do 10–1000 ký tự (400 reason_invalid);
// issue đã đóng thì 409 issue_terminal.
import { call } from '../endpoints';
import type { ForceDoneResult } from './types';

export const forceDoneApi = {
  forceDone: (issueId: string, body: { companyId: string; reason: string }): Promise<ForceDoneResult> =>
    call('crew.forceDone', { issueId }, { body }),
};

export const __endpoints = ['crew.forceDone'];
