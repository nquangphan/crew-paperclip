import { describe, expect, it } from 'vitest';
import { formatRunLog, runActionsFor, wakeupOutcome } from '@/features/runs/run-actions';

// Nguồn: server/src/routes/agents.ts route POST /agents/:id/wakeup (nhánh failedRunId: chỉ run `failed`/`timed_out`,
// reason bắt buộc `retry_failed_run`); ui/src/pages/AgentDetail.tsx RunDetail (resume khi errorCode `process_lost` và
// status `failed`, reason `resume_process_lost_run`, payload resumeFromRunId + issueId/taskId/taskKey/commentId).
// Status run: packages/shared/src/constants.ts HEARTBEAT_RUN_STATUSES.
const run = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  agentId: 'a1',
  status: 'succeeded',
  errorCode: null,
  contextSnapshot: null,
  execution: null,
  ...over,
});

describe('runActionsFor (S12.2–S12.4)', () => {
  it('queued và running chỉ có Dừng', () => {
    expect(runActionsFor(run({ status: 'queued' })).map((a) => a.id)).toEqual(['cancel']);
    expect(runActionsFor(run({ status: 'running' })).map((a) => a.id)).toEqual(['cancel']);
  });

  it('failed và timed_out có Chạy lại với body retry_failed_run', () => {
    for (const status of ['failed', 'timed_out']) {
      const actions = runActionsFor(run({ status, errorCode: 'adapter_failed' }));
      expect(actions.map((a) => a.id)).toEqual(['retry']);
      expect(actions[0].body).toEqual({ reason: 'retry_failed_run', failedRunId: 'r1' });
    }
  });

  it('process_lost có Tiếp tục với body resume_process_lost_run và payload từ contextSnapshot', () => {
    const actions = runActionsFor(
      run({
        status: 'failed',
        errorCode: 'process_lost',
        contextSnapshot: { issueId: 'i1', taskId: 't1', wakeCommentId: 'c1', ignored: 'x' },
      }),
    );
    expect(actions.map((a) => a.id)).toEqual(['resume']);
    expect(actions[0].body).toEqual({
      reason: 'resume_process_lost_run',
      payload: { resumeFromRunId: 'r1', issueId: 'i1', taskId: 't1', commentId: 'c1' },
    });
  });

  it('succeeded, cancelled, scheduled_retry không có thao tác', () => {
    for (const status of ['succeeded', 'cancelled', 'scheduled_retry', 'interrupted']) {
      expect(runActionsFor(run({ status }))).toEqual([]);
    }
  });

  it('run lỗi đã có run kế tiếp thì không Chạy lại', () => {
    expect(runActionsFor(run({ status: 'failed', execution: { successorRunId: 'r2' } }))).toEqual([]);
  });
});

describe('formatRunLog', () => {
  it('ghép chunk từ các dòng NDJSON, dòng không phải JSON giữ nguyên', () => {
    const content = [
      '{"ts":"t","stream":"stdout","chunk":"xin "}',
      '{"ts":"t","stream":"stderr","chunk":"chào"}',
      'dòng thô',
    ].join('\n');
    expect(formatRunLog(content)).toBe('xin chào\ndòng thô');
  });
  it('rỗng thì trả chuỗi rỗng', () => {
    expect(formatRunLog(undefined)).toBe('');
  });
});

// Nguồn: server/src/routes/agents.ts handleWakeupRoute (202 run, hoặc buildSkippedWakeupResponse status skipped) và
// nhánh chạy lại run gắn chat (biên nhận {actionId, issueId, runId, status} của chat-channels failedChatRetryReceipt).
describe('wakeupOutcome', () => {
  it('run mới hoặc biên nhận chat đã có run là created', () => {
    expect(wakeupOutcome({ id: 'r9', status: 'queued' })).toEqual({ kind: 'created', runId: 'r9' });
    expect(wakeupOutcome({ actionId: 'a', runId: 'r8', status: 'running' })).toEqual({ kind: 'created', runId: 'r8' });
  });

  it('biên nhận chat chưa có run mà queued/deferred là queued', () => {
    for (const status of ['queued', 'deferred']) {
      expect(wakeupOutcome({ actionId: 'a', issueId: 'i1', runId: null, status })).toEqual({ kind: 'queued' });
    }
  });

  it('skipped hoặc biên nhận chat failed/cancelled là rejected', () => {
    expect(wakeupOutcome({ status: 'skipped', message: 'Wakeup was skipped.' })).toEqual({
      kind: 'rejected',
      message: 'Wakeup was skipped.',
    });
    expect(wakeupOutcome({ actionId: 'a', runId: null, status: 'failed' })).toEqual({ kind: 'rejected' });
    expect(wakeupOutcome({ actionId: 'a', runId: null, status: 'cancelled' })).toEqual({ kind: 'rejected' });
  });
});
