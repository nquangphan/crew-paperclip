import { describe, expect, it } from 'vitest';
import { ApiError, type SetupRun } from '@/api';
import { removeAgentSteps, runRemoveAgent } from '@/features/wizards/remove/remove-agent';
import { assistantListsOf, renderInstructions } from '@/lib/instructions';
import { COMPANY, type FakeAgent, fakeApi } from '../fake-api';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
const ctxOf = (api: unknown) => ({ api: api as never, t, pollMs: 1 });

const P = 'p0000000-0000-4000-8000-000000000001';
const ID = {
  assistant: 'a1111111-1111-4111-8111-111111111111',
  executor: 'e2222222-2222-4222-8222-222222222222',
  executor2: 'e3333333-3333-4333-8333-333333333333',
  reviewer: 'b4444444-4444-4444-8444-444444444444',
  integrator: 'c5555555-5555-4555-8555-555555555555',
  spare: 'd6666666-6666-4666-8666-666666666666',
  bmad: 'f7777777-7777-4777-8777-777777777777',
};

const removeRun = (input: Partial<{ agentId: string; projectId: string | null; role: string | null }> = {}) => {
  const value = { agentId: ID.executor2, agentName: 'demo-executor-2', projectId: P, role: 'executor-2', ...input };
  return {
    id: 'run-ra',
    companyId: COMPANY,
    kind: 'remove-agent',
    projectKey: value.projectId ? 'demo' : `agent-${value.agentId.slice(0, 8)}`,
    projectId: value.projectId,
    machineId: 'm1',
    input: value,
    steps: {},
    status: 'running',
    runningStep: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  } as SetupRun;
};

const agent = (id: string, name: string, env: string, status = 'idle'): FakeAgent => ({
  id,
  name,
  status,
  defaultEnvironmentId: env,
});
const env = (id: string, key: string, slot: string) => ({
  id,
  name: `${key}-${slot}`,
  driver: 'ssh',
  status: 'active',
  config: { remoteWorkspacePath: `/Users/owner/crew-agents/${key}/${slot}` },
  metadata: { workspaceRealizationMode: 'in_place' },
});

function setup(run: SetupRun) {
  const f = fakeApi({ run });
  f.state.agents.push(
    agent(ID.assistant, 'demo-assistant', 'env-a'),
    agent(ID.executor, 'demo-executor', 'env-e'),
    agent(ID.executor2, 'demo-executor-2', 'env-e2', 'running'),
    agent(ID.reviewer, 'demo-reviewer', 'env-r'),
    agent(ID.integrator, 'demo-integrator', 'env-i'),
    agent(ID.spare, 'le', 'env-old'),
  );
  f.state.environments.push(
    env('env-a', 'demo', 'assistant'),
    env('env-e', 'demo', 'executor'),
    env('env-e2', 'demo', 'executor-2'),
    env('env-old', 'old', 'executor'),
  );
  f.state.roles = {
    assistantAgentId: ID.assistant,
    executorAgentIds: [ID.executor, ID.executor2],
    reviewerAgentId: ID.reviewer,
    integratorAgentId: ID.integrator,
  };
  f.state.files.set(ID.assistant, {
    content: renderInstructions('assistant', {
      agentId: ID.assistant,
      executorIds: [ID.executor, ID.executor2],
      bmadIds: [ID.bmad],
    }),
    contentHash: 'hash-old',
  });
  return f;
}

const begun = (f: ReturnType<typeof fakeApi>) =>
  f.calls.filter((c) => c.fn === 'setup.begin').map((c) => c.args[2] as string);

describe('removeAgentSteps', () => {
  it('có vai trò: roles → pause-agent → environment → checkout; không vai trò: pause-agent → environment', () => {
    expect(removeAgentSteps(removeRun())).toEqual(['roles', 'pause-agent', 'environment', 'checkout']);
    expect(removeAgentSteps(removeRun({ agentId: ID.spare, projectId: null, role: null }))).toEqual([
      'pause-agent',
      'environment',
    ]);
  });
});

describe('runRemoveAgent', () => {
  it('executor-2: vai trò mới bỏ agent, render lại AGENTS.md Trợ Lý, pause, archive environment, gỡ checkout', async () => {
    const f = setup(removeRun());
    const run = await runRemoveAgent(ctxOf(f.api), removeRun());
    expect(run.status).toBe('done');
    expect(begun(f)).toEqual(['roles', 'pause-agent', 'environment', 'checkout']);

    expect(f.state.roles?.executorAgentIds).toEqual([ID.executor]);
    const file = f.state.files.get(ID.assistant)?.content ?? '';
    expect(assistantListsOf(file)).toEqual({ executorIds: [ID.executor], bmadIds: [ID.bmad] });
    const save = f.calls.find((c) => c.fn === 'agents.saveInstructionsFile');
    expect(save?.args[1]).toMatchObject({ baseHash: 'hash-old' });

    expect(f.calls.filter((c) => c.fn === 'agents.pause').map((c) => c.args[0])).toEqual([ID.executor2]);
    expect(f.calls.filter((c) => c.fn === 'environments.archive').map((c) => c.args[0])).toEqual(['env-e2']);
    const job = f.calls.find((c) => c.fn === 'jobs.create')?.args[0] as { payload: unknown };
    expect(job.payload).toEqual({
      kind: 'remove-checkouts',
      projectId: P,
      projectKey: 'demo',
      roles: ['executor-2'],
      removeStatusRepo: false,
    });
    expect(f.names().some((n) => /delete|terminate|roles\.remove/i.test(n))).toBe(false);
  });

  it('executor-1 khi có executor-2: executor-2 lên executor-1, gỡ checkout ô executor', async () => {
    const run0 = removeRun({ agentId: ID.executor, role: 'executor' });
    const f = setup(run0);
    const run = await runRemoveAgent(ctxOf(f.api), run0);
    expect(run.status).toBe('done');
    expect(f.state.roles?.executorAgentIds).toEqual([ID.executor2]);
    const job = f.calls.find((c) => c.fn === 'jobs.create')?.args[0] as { payload: { roles: string[] } };
    expect(job.payload.roles).toEqual(['executor']);
  });

  it('AGENTS.md Trợ Lý bị sửa nơi khác (409) → dừng, báo; Chạy tiếp không ghi vai trò lại, ghi AGENTS.md rồi đi tiếp', async () => {
    const f = setup(removeRun());
    f.failOn('agents.saveInstructionsFile', 1, new ApiError(409, 'conflict'));
    const first = await runRemoveAgent(ctxOf(f.api), removeRun());
    expect(first.status).toBe('failed');
    expect(first.steps.roles?.status).toBe('failed');
    expect(first.steps.roles?.error).toContain('errors.instructionsConflict');
    expect(f.state.roles?.executorAgentIds).toEqual([ID.executor]);
    expect(f.names()).not.toContain('agents.pause');

    f.clearFailures();
    f.calls.length = 0;
    const second = await runRemoveAgent(ctxOf(f.api), first);
    expect(second.status).toBe('done');
    expect(f.names()).not.toContain('roles.set');
    expect(assistantListsOf(f.state.files.get(ID.assistant)?.content ?? '').executorIds).toEqual([ID.executor]);
  });

  it('vai trò đổi giữa chừng làm agent thành executor duy nhất → bước roles lỗi, không pause', async () => {
    const f = setup(removeRun());
    if (f.state.roles) f.state.roles.executorAgentIds = [ID.executor2];
    const run = await runRemoveAgent(ctxOf(f.api), removeRun());
    expect(run.status).toBe('failed');
    expect(run.steps.roles?.error).toContain('remove.errors.blocked.onlyExecutor');
    expect(f.names()).not.toContain('roles.set');
    expect(f.names()).not.toContain('agents.pause');
  });

  it('agent không vai trò: chỉ pause-agent và environment; không đụng vai trò, không việc máy', async () => {
    const run0 = removeRun({ agentId: ID.spare, projectId: null, role: null });
    const f = setup(run0);
    const run = await runRemoveAgent(ctxOf(f.api), run0);
    expect(run.status).toBe('done');
    expect(begun(f)).toEqual(['pause-agent', 'environment']);
    expect(f.calls.filter((c) => c.fn === 'agents.pause').map((c) => c.args[0])).toEqual([ID.spare]);
    expect(f.calls.filter((c) => c.fn === 'environments.archive').map((c) => c.args[0])).toEqual(['env-old']);
    expect(f.names().some((n) => n.startsWith('roles.') || n.startsWith('jobs.'))).toBe(false);
    expect(run.steps['pause-agent']?.refs).toEqual({ agent: ID.spare, paused: 'true' });
    expect(run.steps.environment?.refs).toEqual({ environment: 'env-old' });
  });

  it('agent đã paused sẵn → không pause lại', async () => {
    const run0 = removeRun({ agentId: ID.spare, projectId: null, role: null });
    const f = setup(run0);
    const spare = f.state.agents.find((a) => a.id === ID.spare);
    if (spare) spare.status = 'paused';
    const run = await runRemoveAgent(ctxOf(f.api), run0);
    expect(run.status).toBe('done');
    expect(f.names()).not.toContain('agents.pause');
    expect(run.steps['pause-agent']?.refs).toEqual({ agent: ID.spare });
  });
});
