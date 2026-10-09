// Dọn bản ghi ca tạo ra: mỗi issue ghi vào test.info().annotations (type `crew-e2e-issue`), cuối ca hủy issue chưa
// xong. Không xóa gì: issue/agent có cost_events không xóa được, nên chỉ hủy/tạm dừng.
import { type TestInfo, test } from '@playwright/test';
import type { Api } from './api';

export const ISSUE_ANNOTATION = 'crew-e2e-issue';

/** Ghi issue ca vừa tạo để cuối ca tự hủy. */
export function trackIssue(issueId: string, info: TestInfo = test.info()): void {
  info.annotations.push({ type: ISSUE_ANNOTATION, description: issueId });
}

export function trackedIssues(info: TestInfo): string[] {
  return info.annotations
    .filter((a) => a.type === ISSUE_ANNOTATION && a.description)
    .map((a) => a.description as string);
}

/** Hủy mọi issue đã ghi mà chưa ở trạng thái cuối; trả số issue đã hủy. Lỗi từng issue gom lại, ném sau cùng. */
export async function cancelTrackedIssues(api: Api, info: TestInfo): Promise<number> {
  const errors: string[] = [];
  let cancelled = 0;
  for (const id of new Set(trackedIssues(info))) {
    try {
      const issue = await api.get<{ status: string }>(`/api/issues/${id}`);
      if (issue.status === 'done' || issue.status === 'cancelled') continue;
      await api.patch(`/api/issues/${id}`, { status: 'cancelled' });
      cancelled++;
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`);
    }
  }
  if (errors.length) throw new Error(`Không hủy được issue thử:\n${errors.join('\n')}`);
  return cancelled;
}

/**
 * Xóa phiên Claude đã lưu của agent. Run stub lưu session_id `crew-e2e-stub`; trước khi chạy claude thật (T3) phải
 * xóa để không `--resume` một phiên không có thật.
 */
export async function resetAgentSessions(api: Api, agentIds: string[]): Promise<void> {
  for (const id of agentIds) await api.post(`/api/agents/${id}/runtime-state/reset-session`, {});
}
