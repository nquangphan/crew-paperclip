// Thẻ câu hỏi/xác nhận của Trợ Lý (S6.9). Body theo ui/src/api/issues.ts.
import type { AskUserQuestionsAnswer, IssueThreadInteraction } from '@paperclipai/shared';
import { call } from '../endpoints';

export const interactionsApi = {
  list: (issueId: string): Promise<IssueThreadInteraction[]> => call('interactions.list', { id: issueId }),
  respond: (
    issueId: string,
    interactionId: string,
    body: { answers: AskUserQuestionsAnswer[]; summaryMarkdown?: string | null },
  ): Promise<IssueThreadInteraction> => call('interactions.respond', { id: issueId, interactionId }, { body }),
  accept: (
    issueId: string,
    interactionId: string,
    body: { selectedClientKeys?: string[]; selectedOptionIds?: string[] } = {},
  ): Promise<IssueThreadInteraction> => call('interactions.accept', { id: issueId, interactionId }, { body }),
  reject: (issueId: string, interactionId: string, reason?: string): Promise<IssueThreadInteraction> =>
    call('interactions.reject', { id: issueId, interactionId }, { body: reason ? { reason } : {} }),
};

export const __endpoints = ['interactions.accept', 'interactions.list', 'interactions.reject', 'interactions.respond'];
