// Run (heartbeat): danh sách, chi tiết, log, dừng. Nguồn: server/src/routes/agents.ts:6824-7509, activity.ts:350.
import type { HeartbeatRun, HeartbeatRunEvent } from '@paperclipai/shared';
import { call } from '../endpoints';

export interface RunLogChunk {
  content?: string;
  nextOffset?: number;
  [key: string]: unknown;
}

export const runsApi = {
  list: (companyId: string, opts: { agentId?: string; limit?: number } = {}): Promise<HeartbeatRun[]> =>
    call('runs.list', { companyId }, { query: opts }),
  live: (companyId: string, opts: { minCount?: number; limit?: number } = {}): Promise<unknown[]> =>
    call('runs.live', { companyId }, { query: opts }),
  get: (runId: string): Promise<HeartbeatRun> => call('runs.get', { runId }),
  events: (runId: string, afterSeq = 0, limit = 200): Promise<HeartbeatRunEvent[]> =>
    call('runs.events', { runId }, { query: { afterSeq, limit } }),
  log: (runId: string, offset = 0, limitBytes = 256_000): Promise<RunLogChunk> =>
    call('runs.log', { runId }, { query: { offset, limitBytes } }),
  issues: (runId: string): Promise<unknown[]> => call('runs.issues', { runId }),
  cancel: (runId: string): Promise<void> => call('runs.cancel', { runId }, { body: {} }),
  forIssue: (issueId: string): Promise<unknown[]> => call('runs.forIssue', { id: issueId }),
  liveForIssue: (issueId: string): Promise<unknown[]> => call('runs.liveForIssue', { id: issueId }),
};

export const __endpoints = [
  'runs.cancel',
  'runs.events',
  'runs.forIssue',
  'runs.get',
  'runs.issues',
  'runs.list',
  'runs.live',
  'runs.liveForIssue',
  'runs.log',
];
