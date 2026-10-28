// Gọi Trợ Lý bằng tag (S6.5): router Crew của server. Ô bình luận gửi bình luận có link `agent://` tới Trợ Lý của
// project, rồi gọi route này với id bình luận để đánh thức Trợ Lý (mention của lõi không đánh thức ai). Chỉ owner gọi
// được (403); issue đã đóng, project chưa có Trợ Lý, hay lõi không nhận wake (Trợ Lý pause, hết ngân sách) thì 409; bình
// luận không có link tới Trợ Lý thì 422. Wake bị bỏ không khóa bình luận: gọi lại cùng id thử đánh thức lại.
import { call } from '../endpoints';

export type AssistantCallResult = { status: 'already' } | { status: 'queued' | 'deferred'; runId: string | null };

export const assistantCallApi = {
  call: (companyId: string, issueId: string, commentId: string): Promise<AssistantCallResult> =>
    call('assistantCall.call', { companyId, issueId }, { body: { commentId } }),
};

export const __endpoints = ['assistantCall.call'];
