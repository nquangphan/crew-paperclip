// Thao tác trên một run (S12.2 Dừng, S12.3 Chạy lại, S12.4 Tiếp tục) và định dạng log.
// Nguồn: server/src/routes/agents.ts POST /agents/:id/wakeup (failedRunId chỉ nhận run failed/timed_out và reason
// retry_failed_run); ui/src/pages/AgentDetail.tsx (resume run process_lost).
import type { WakeupBody } from '@/api/paperclip/agents';

export type RunActionId = 'cancel' | 'retry' | 'resume';

export interface RunAction {
  id: RunActionId;
  /** Body wakeup cho retry/resume; cancel không có body. */
  body?: WakeupBody;
}

interface ActionRun {
  id: string;
  status: string;
  errorCode?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
  execution?: { phase?: string | null; successorRunId?: string | null } | null;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

export function runActionsFor(run: ActionRun): RunAction[] {
  if (run.status === 'queued' || run.status === 'running') return [{ id: 'cancel' }];
  if (run.status !== 'failed' && run.status !== 'timed_out') return [];
  if (run.execution?.successorRunId || run.execution?.phase === 'recovery_needed') return [];
  if (run.status === 'failed' && run.errorCode === 'process_lost') {
    const ctx = run.contextSnapshot ?? {};
    const payload: Record<string, string> = { resumeFromRunId: run.id };
    const issueId = str(ctx.issueId);
    const taskId = str(ctx.taskId);
    const taskKey = str(ctx.taskKey);
    const commentId = str(ctx.wakeCommentId) ?? str(ctx.commentId);
    if (issueId) payload.issueId = issueId;
    if (taskId) payload.taskId = taskId;
    if (taskKey) payload.taskKey = taskKey;
    if (commentId) payload.commentId = commentId;
    return [{ id: 'resume', body: { reason: 'resume_process_lost_run', payload } }];
  }
  return [{ id: 'retry', body: { reason: 'retry_failed_run', failedRunId: run.id } }];
}

/**
 * Kết quả wakeup (202): run mới (`id`, hoặc `runId` của biên nhận chạy lại chat), biên nhận chat đã nhận nhưng chưa
 * có run (`runId: null`, status queued/deferred: worker sẽ chạy, bấm lại là gửi trùng), còn lại là bị bỏ qua/từ chối
 * (`status: 'skipped'` kèm message, hoặc biên nhận chat failed/cancelled).
 */
export type WakeupOutcome =
  | { kind: 'created'; runId: string }
  | { kind: 'queued' }
  | { kind: 'rejected'; message?: string };

const ACCEPTED = new Set(['queued', 'deferred', 'running']);

export function wakeupOutcome(result: unknown): WakeupOutcome {
  const r = (result ?? {}) as { id?: unknown; runId?: unknown; status?: unknown; message?: unknown };
  const created = str(r.id) ?? str(r.runId);
  if (created) return { kind: 'created', runId: created };
  if ('runId' in r && r.runId === null && typeof r.status === 'string' && ACCEPTED.has(r.status)) {
    return { kind: 'queued' };
  }
  return { kind: 'rejected', message: str(r.message) };
}

/** Log run là NDJSON `{ts, stream, chunk}`; ghép chunk, dòng không đọc được giữ nguyên. */
export function formatRunLog(content: string | undefined): string {
  if (!content) return '';
  const out: string[] = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && typeof (parsed as { chunk?: unknown }).chunk === 'string') {
        out.push((parsed as { chunk: string }).chunk);
        continue;
      }
    } catch {
      // không phải JSON: giữ dòng thô
    }
    out.push(`\n${line}`);
  }
  return out.join('').replace(/^\n/, '');
}
