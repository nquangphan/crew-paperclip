import { describe, expect, it } from 'vitest';
import type { SetupRun } from '@/api';
import { removalState } from '@/features/wizards/remove/removal-state';

const A = 'a1111111-1111-4111-8111-111111111111';
const P = 'p0000000-0000-4000-8000-000000000001';
const run = (over: Partial<SetupRun>): SetupRun => ({
  id: 'r',
  companyId: 'c',
  kind: 'remove-agent',
  projectKey: 'agent-a1111111',
  projectId: null,
  machineId: 'm',
  input: { agentId: A, agentName: 'A', projectId: null, role: null },
  steps: {},
  status: 'running',
  runningStep: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

describe('removalState', () => {
  it('không có lần gỡ → none', () => {
    expect(removalState([], { agentId: A })).toEqual({ status: 'none', run: null });
  });

  it('agent: lần gỡ mới nhất quyết định; done → removed', () => {
    const old = run({ id: 'old', status: 'failed', updatedAt: '2026-10-10T00:00:00.000Z' });
    const done = run({ id: 'done', status: 'done', updatedAt: '2026-10-10T01:00:00.000Z' });
    expect(removalState([old, done], { agentId: A })).toEqual({ status: 'removed', run: done });
    expect(removalState([old], { agentId: A.toUpperCase() }).status).toBe('failed');
    expect(removalState([run({ status: 'running' })], { agentId: A }).status).toBe('removing');
  });

  it('agent đã gỡ rồi được chạy lại tay (không còn paused) → none', () => {
    const done = run({ status: 'done' });
    expect(removalState([done], { agentId: A, agentStatus: 'idle' }).status).toBe('none');
    expect(removalState([done], { agentId: A, agentStatus: 'paused' }).status).toBe('removed');
  });

  it('project: theo projectId của lần gỡ project; bỏ qua lần thêm và lần gỡ agent', () => {
    const remove = run({
      kind: 'remove-project',
      projectKey: 'demo',
      projectId: P,
      input: { projectId: P, projectName: 'Demo' },
      status: 'failed',
    });
    const add = run({ kind: 'add-project', projectId: P, status: 'done', updatedAt: '2026-10-11T00:00:00.000Z' });
    expect(removalState([remove, add, run({})], { projectId: P })).toEqual({ status: 'failed', run: remove });
  });
});
