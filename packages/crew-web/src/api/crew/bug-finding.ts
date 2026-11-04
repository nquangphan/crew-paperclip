// Lượt Bug Finding của ticket tổng code-bf: route board-or-agent của plugin crew.core
// (`GET /api/plugins/crew.core/api/issues/:issueId/bug-finding?companyId=`). Body theo `shared/bug-finding` của plugin:
// mọi lượt (mới nhất trước) kèm kế hoạch `crew-bf-triage` của Trợ Lý, số lô sửa đã dùng, head PR hiện tại.
import type { BugFindingView } from '@crew/paperclip-plugin/shared/bug-finding';
import { useQuery } from '@tanstack/react-query';
import { call } from '../endpoints';
import { queryKeys } from '../queryKeys';

export const bugFindingApi = {
  bugFinding: (companyId: string, issueId: string): Promise<BugFindingView> =>
    call('crew.bugFinding', { issueId }, { query: { companyId } }),
};

export const __endpoints = ['crew.bugFinding'];

/** App Bug Finding báo tiến độ khoảng mỗi phút; lượt đang chờ hoặc chạy thì đọc lại mỗi 30 giây. */
export const BUG_FINDING_POLL_MS = 30_000;
const OPEN_STATES = new Set(['requested', 'queued', 'running']);

export function hasOpenRun(view: BugFindingView | undefined): boolean {
  return !!view?.runs.some((run) => OPEN_STATES.has(run.state));
}

/** Đọc lượt Bug Finding của `issueId`; `enabled` tắt khi issue không phải ticket tổng code-bf. */
export function useBugFinding(companyId: string, issueId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.crew('crew.bugFinding', { companyId, issueId }),
    queryFn: () => bugFindingApi.bugFinding(companyId, issueId),
    enabled: enabled && !!issueId,
    refetchInterval: (query) => (hasOpenRun(query.state.data) ? BUG_FINDING_POLL_MS : false),
  });
}
