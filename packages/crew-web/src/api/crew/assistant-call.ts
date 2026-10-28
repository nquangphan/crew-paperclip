// Gọi Trợ Lý bằng tag (S6.5): router Crew của server. Ô bình luận gửi bình luận có link `agent://` tới Trợ Lý của
// project, rồi gọi route này với id bình luận để đánh thức Trợ Lý (mention của lõi không đánh thức ai). Chỉ owner gọi
// được (403); issue đã đóng hay project chưa có Trợ Lý thì 409; bình luận không có link tới Trợ Lý thì 422.
import { call } from '../endpoints';

export type AssistantCallResult =
  | { status: 'already' }
  | { status: 'queued' | 'deferred' | 'skipped'; runId: string | null; skipReason?: string | null };

export const assistantCallApi = {
  call: (companyId: string, issueId: string, commentId: string): Promise<AssistantCallResult> =>
    call('assistantCall.call', { companyId, issueId }, { body: { commentId } }),
};

export const __endpoints = ['assistantCall.call'];
