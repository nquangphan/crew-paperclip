import { describe, expect, it } from 'vitest';
import type { SetupRun } from '@/api';
import { findAgentRun, resumeHref } from '@/features/wizards';

const AGENT = 'a1111111-1111-4111-8111-111111111111';

const run = (over: Partial<SetupRun>): SetupRun => ({
  id: 'run-a',
  companyId: 'c1',
  kind: 'add-agent',
  projectKey: 'demo',
  projectId: 'p1',
  machineId: 'm1',
  input: { projectId: 'p1', slot: 'executor-2', name: 'demo-executor-2', model: 'claude-sonnet-5' },
  steps: { agent: { status: 'done', at: 'x', refs: { agent: AGENT, created: 'true' } } },
  status: 'failed',
  runningStep: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

describe('resumeHref', () => {
  it('add-agent có setup run dở của agent → agents/new?resume=<runId>', () => {
    const target = { wizard: 'add-agent', step: 'workspace', agentId: AGENT } as const;
    expect(resumeHref('TPS', target, [run({})])).toBe('/TPS/agents/new?resume=run-a');
  });

  it('không có run (agent do app tạo, thiếu A2) → chế độ sửa agents/new?fix=<agentId>&step=pin', () => {
    const target = { wizard: 'add-agent', step: 'pin', agentId: AGENT } as const;
    expect(resumeHref('TPS', target)).toBe(`/TPS/agents/new?fix=${AGENT}&step=pin`);
    // Run đã xong hoặc của agent khác không tính.
    expect(resumeHref('TPS', target, [run({ status: 'done' }), run({ id: 'run-b', steps: {} })])).toBe(
      `/TPS/agents/new?fix=${AGENT}&step=pin`,
    );
  });

  it('add-project → projects/new?resume=; none → null', () => {
    expect(resumeHref('TPS', { wizard: 'add-project', setupRunId: 'run-p' })).toBe('/TPS/projects/new?resume=run-p');
    expect(resumeHref('TPS', { none: true })).toBeNull();
  });

  it('findAgentRun chọn run add-agent chưa xong mới nhất có refs.agent là agent', () => {
    const older = run({ id: 'old', updatedAt: '2026-10-09T00:00:00.000Z' });
    const newer = run({ id: 'new', updatedAt: '2026-10-10T01:00:00.000Z', status: 'running' });
    const project = run({ id: 'proj', kind: 'add-project' });
    expect(findAgentRun([older, newer, project], AGENT)?.id).toBe('new');
    expect(findAgentRun([older], 'khac')).toBeNull();
  });
});
