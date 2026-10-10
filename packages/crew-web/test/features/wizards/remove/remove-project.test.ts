import { describe, expect, it } from 'vitest';
import { ApiError, type MachineJob, type SetupRun } from '@/api';
import { keptCheckouts, REMOVE_PROJECT_STEPS, runRemoveProject } from '@/features/wizards/remove/remove-project';
import { COMPANY, type FakeAgent, fakeApi, type JobOutcome } from '../fake-api';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
const ctxOf = (api: unknown) => ({ api: api as never, t, pollMs: 1 });

const P = 'p0000000-0000-4000-8000-000000000001';
const ID = {
  assistant: 'a1111111-1111-4111-8111-111111111111',
  executor: 'e2222222-2222-4222-8222-222222222222',
  reviewer: 'b4444444-4444-4444-8444-444444444444',
  integrator: 'c5555555-5555-4555-8555-555555555555',
  outside: 'f7777777-7777-4777-8777-777777777777',
};

const removeRun = (over: Partial<SetupRun> = {}): SetupRun => ({
  id: 'run-rm',
  companyId: COMPANY,
  kind: 'remove-project',
  projectKey: 'demo',
  projectId: P,
  machineId: 'm1',
  input: { projectId: P, projectName: 'Demo' },
  steps: {},
  status: 'running',
  runningStep: null,
  createdAt: '2026-10-10T00:00:00.000Z',
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

const agent = (id: string, slot: string, status = 'running'): FakeAgent => ({
  id,
  name: `demo-${slot}`,
  status,
  defaultEnvironmentId: `env-${slot}`,
});
const roleEnv = (slot: string) => ({
  id: `env-${slot}`,
  name: `demo-${slot}`,
  driver: 'ssh',
  status: 'active',
  config: { remoteWorkspacePath: `/Users/owner/crew-agents/demo/${slot}` },
  metadata: { workspaceRealizationMode: 'in_place' },
});

/** Project demo có 4 vai trò; reviewer dùng chung environment với một agent ngoài project. */
function setup(jobOutcome?: JobOutcome) {
  const f = fakeApi({ run: removeRun(), jobOutcome });
  f.state.projects.push({ id: P, name: 'Demo', urlKey: 'demo', createdAt: '2026-10-01T00:00:00Z', archivedAt: null });
  f.state.agents.push(
    agent(ID.assistant, 'assistant', 'idle'),
    agent(ID.executor, 'executor'),
    agent(ID.reviewer, 'reviewer', 'paused'),
    agent(ID.integrator, 'integrator', 'terminated'),
    { id: ID.outside, name: 'khac', status: 'idle', defaultEnvironmentId: 'env-reviewer' },
  );
  f.state.environments.push(roleEnv('assistant'), roleEnv('executor'), roleEnv('reviewer'), roleEnv('integrator'));
  f.state.roles = {
    assistantAgentId: ID.assistant,
    executorAgentIds: [ID.executor],
    reviewerAgentId: ID.reviewer,
    integratorAgentId: ID.integrator,
  };
  return f;
}

const begun = (f: ReturnType<typeof fakeApi>) =>
  f.calls.filter((c) => c.fn === 'setup.begin').map((c) => c.args[2] as string);

describe('runRemoveProject', () => {
  it('đúng thứ tự bước spec §4.4; refs lưu id agent đã pause, environment đã archive, jobId', async () => {
    const f = setup();
    const run = await runRemoveProject(ctxOf(f.api), removeRun());
    expect(run.status).toBe('done');
    expect(begun(f)).toEqual([...REMOVE_PROJECT_STEPS]);
    expect(REMOVE_PROJECT_STEPS).toEqual(['pause-agents', 'roles', 'environments', 'checkouts', 'project']);

    // Ghi thật theo đúng thứ tự: pause → xóa vai trò → archive environment → việc máy → archive project.
    const writes = f
      .names()
      .filter((n) =>
        ['agents.pause', 'roles.remove', 'environments.archive', 'jobs.create', 'projects.archive'].includes(n),
      );
    expect(writes).toEqual([
      'agents.pause',
      'agents.pause',
      'roles.remove',
      'environments.archive',
      'environments.archive',
      'environments.archive',
      'jobs.create',
      'projects.archive',
    ]);

    // Chỉ pause agent chưa paused/terminated.
    const paused = f.calls.filter((c) => c.fn === 'agents.pause').map((c) => c.args);
    expect(paused).toEqual([
      [ID.assistant, COMPANY],
      [ID.executor, COMPANY],
    ]);
    expect(run.steps['pause-agents']?.refs).toEqual({
      agent_assistant: ID.assistant,
      agent_executor: ID.executor,
      agent_reviewer: ID.reviewer,
      agent_integrator: ID.integrator,
      paused_assistant: ID.assistant,
      paused_executor: ID.executor,
    });

    // Environment reviewer dùng chung với agent ngoài project: giữ. Environment mẫu không bị chạm.
    const archived = f.calls.filter((c) => c.fn === 'environments.archive').map((c) => c.args[0]);
    expect(archived).toEqual(['env-assistant', 'env-executor', 'env-integrator']);
    expect(run.steps.environments?.refs).toEqual({
      environment_assistant: 'env-assistant',
      environment_executor: 'env-executor',
      environment_integrator: 'env-integrator',
    });
    expect(f.state.environments.find((e) => e.id === 'env-template')?.status).toBe('active');

    const job = f.calls.find((c) => c.fn === 'jobs.create')?.args[0] as { payload: unknown; setupRunId: string };
    expect(job.payload).toEqual({
      kind: 'remove-checkouts',
      projectId: P,
      projectKey: 'demo',
      roles: ['assistant', 'executor', 'executor-2', 'reviewer', 'integrator'],
      removeStatusRepo: true,
    });
    expect(job.setupRunId).toBe('run-rm');
    expect(run.steps.checkouts?.refs?.job).toBe(f.state.jobs[0]?.id);

    expect(f.calls.find((c) => c.fn === 'projects.archive')?.args).toEqual([P, COMPANY]);
    expect(f.state.projects[0]?.archivedAt).not.toBeNull();
  });

  it('không có lời gọi DELETE nào ngoài xóa dòng vai trò; không terminate', async () => {
    const f = setup();
    await runRemoveProject(ctxOf(f.api), removeRun());
    const names = f.names();
    expect(names.some((n) => /delete|terminate/i.test(n))).toBe(false);
    expect(names.filter((n) => n.endsWith('.remove'))).toEqual(['roles.remove']);
    expect('delete' in f.api.environments || 'delete' in f.api.projects).toBe(false);
  });

  it('lỗi ở checkouts → run failed; Chạy tiếp bỏ qua bước done, không pause lại agent đã chạy lại tay', async () => {
    let fail = true;
    const f = setup((payload) =>
      fail
        ? { status: 'failed', errorCode: 'app_error', errorText: 'mất kết nối' }
        : {
            status: 'done',
            result: {
              kind: 'remove-checkouts',
              removed: [],
              kept: [],
              absent: payload.kind === 'remove-checkouts' ? payload.roles : [],
            },
          },
    );
    const first = await runRemoveProject(ctxOf(f.api), removeRun());
    expect(first.status).toBe('failed');
    expect(first.steps.checkouts?.status).toBe('failed');
    expect(first.steps.checkouts?.error).toContain('errors.job.app_error');
    expect(first.steps.project).toBeUndefined();
    expect(f.state.projects[0]?.archivedAt).toBeNull();

    // Owner chạy lại tay agent executor giữa hai lần.
    const executor = f.state.agents.find((a) => a.id === ID.executor);
    if (executor) executor.status = 'idle';
    fail = false;
    f.calls.length = 0;
    const second = await runRemoveProject(ctxOf(f.api), first);
    expect(second.status).toBe('done');
    expect(begun(f)).toEqual(['checkouts', 'project']);
    expect(f.names()).not.toContain('agents.pause');
    expect(f.names()).not.toContain('environments.archive');
    expect(f.names()).not.toContain('roles.remove');
    expect(executor?.status).toBe('idle');
  });

  it('kết quả có kept → bước vẫn done, refs ghi lý do và đường dẫn để cảnh báo', async () => {
    const f = setup(() => ({
      status: 'done',
      result: {
        kind: 'remove-checkouts',
        removed: [{ role: 'assistant', path: '/Users/owner/crew-agents/demo/assistant' }],
        kept: [
          { role: 'executor', path: '/Users/owner/crew-agents/demo/executor', reason: 'dirty' },
          { role: 'reviewer', path: '/Users/owner/crew-agents/demo/reviewer', reason: 'busy', detail: 'pid 42' },
        ],
        absent: ['executor-2', 'integrator'],
      },
    }));
    const run = await runRemoveProject(ctxOf(f.api), removeRun());
    expect(run.status).toBe('done');
    expect(run.steps.checkouts?.status).toBe('done');
    expect(keptCheckouts(run)).toEqual([
      { role: 'executor', path: '/Users/owner/crew-agents/demo/executor', reason: 'dirty' },
      { role: 'reviewer', path: '/Users/owner/crew-agents/demo/reviewer', reason: 'busy' },
    ]);
  });

  it('việc máy của lần trước còn đang chờ thì chờ tiếp việc đó, không xếp việc mới', async () => {
    const f = setup();
    const pending: MachineJob = {
      id: 'job-old',
      companyId: COMPANY,
      machineId: 'm1',
      kind: 'remove-checkouts',
      payload: {
        kind: 'remove-checkouts',
        projectId: P,
        projectKey: 'demo',
        roles: ['executor'],
        removeStatusRepo: true,
      },
      status: 'done',
      result: { kind: 'remove-checkouts', removed: [], kept: [], absent: ['executor'] },
      errorCode: null,
      errorText: null,
      attempts: 1,
      setupRunId: 'run-rm',
      createdAt: 'x',
      claimedAt: null,
      finishedAt: null,
    };
    f.state.jobs.push(pending);
    const run = await runRemoveProject(ctxOf(f.api), removeRun());
    expect(run.status).toBe('done');
    expect(f.names()).not.toContain('jobs.create');
    expect(run.steps.checkouts?.refs?.job).toBe('job-old');
  });

  it('project đã archive (lần trước mất response) → không archive lại', async () => {
    const f = setup();
    const project = f.state.projects[0];
    if (project) project.archivedAt = '2026-10-10T01:00:00.000Z';
    const run = await runRemoveProject(ctxOf(f.api), removeRun());
    expect(run.status).toBe('done');
    expect(f.names()).not.toContain('projects.archive');
    expect(project?.archivedAt).toBe('2026-10-10T01:00:00.000Z');
  });

  it('bước đang bị tab khác giữ (409) → dừng, không ghi gì', async () => {
    const f = setup();
    f.state.busy = true;
    await expect(runRemoveProject(ctxOf(f.api), removeRun())).rejects.toThrow(/đang chạy/);
    expect(f.names()).toEqual(['setup.begin']);
  });

  it('pause lỗi → bước pause-agents failed, giữ refs agent đã đọc; không đi tiếp', async () => {
    const f = setup();
    f.failOn('agents.pause', 2, new ApiError(500, 'server lỗi'));
    const run = await runRemoveProject(ctxOf(f.api), removeRun());
    expect(run.status).toBe('failed');
    expect(run.steps['pause-agents']?.status).toBe('failed');
    expect(run.steps['pause-agents']?.refs?.paused_assistant).toBe(ID.assistant);
    expect(f.names()).not.toContain('roles.remove');
  });
});
