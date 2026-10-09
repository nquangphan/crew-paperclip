import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api';
import { runAddProject, runAddProjectStep, StepBusyError } from '@/features/wizards/add-project/run-step';
import { renderInstructions } from '@/lib/instructions';
import { addProjectRun, COMPANY, fakeApi, PIN } from './fake-api';

/** Dịch giả: trả khóa kèm tham số để test so được. */
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
const ctxOf = (api: unknown) => ({ api: api as never, t, pollMs: 1 });

const stepsCalled = (calls: { fn: string; args: unknown[] }[]) =>
  calls.filter((c) => c.fn === 'setup.begin').map((c) => c.args[2]);

describe('runAddProject', () => {
  it('đủ 7 bước theo thứ tự, ghi projectId trước khi xếp prepare-checkouts, agent đúng I9', async () => {
    const f = fakeApi();
    const run = await runAddProject(ctxOf(f.api), f.state.run);

    expect(run.status).toBe('done');
    expect(stepsCalled(f.calls)).toEqual([
      'inspect',
      'project',
      'checkouts',
      'environments',
      'agents',
      'roles',
      'check',
    ]);

    const projectFinish = f.calls.findIndex(
      (c) => c.fn === 'setup.finish' && c.args[2] === 'project' && (c.args[3] as { projectId?: string }).projectId,
    );
    const checkoutsJob = f.calls.findIndex(
      (c) => c.fn === 'jobs.create' && (c.args[0] as { kind: string }).kind === 'prepare-checkouts',
    );
    expect(projectFinish).toBeGreaterThan(-1);
    expect(projectFinish).toBeLessThan(checkoutsJob);

    const jobs = f.calls.filter((c) => c.fn === 'jobs.create').map((c) => c.args[0]);
    expect(jobs).toEqual([
      {
        companyId: COMPANY,
        machineId: 'm1',
        kind: 'inspect-folder',
        payload: { kind: 'inspect-folder', folder: '/Users/owner/code/demo' },
        setupRunId: 'run-1',
      },
      {
        companyId: COMPANY,
        machineId: 'm1',
        kind: 'prepare-checkouts',
        payload: {
          kind: 'prepare-checkouts',
          projectKey: 'demo',
          folder: '/Users/owner/code/demo',
          roles: [
            { role: 'assistant', branch: 'crew/demo/assistant' },
            { role: 'executor', branch: 'crew/demo/executor' },
            { role: 'reviewer', branch: 'crew/demo/reviewer' },
            { role: 'integrator', branch: 'crew/demo/integrator' },
          ],
        },
        setupRunId: 'run-1',
      },
      {
        companyId: COMPANY,
        machineId: 'm1',
        kind: 'check',
        payload: { kind: 'check', projectKey: 'demo' },
        setupRunId: 'run-1',
      },
    ]);

    const envs = f.calls.filter((c) => c.fn === 'environments.create').map((c) => c.args[1]);
    expect(envs).toHaveLength(4);
    expect(envs[0]).toMatchObject({
      name: 'demo-assistant',
      driver: 'ssh',
      config: {
        host: 'mac.local',
        port: 2222,
        username: 'owner',
        remoteWorkspacePath: '/Users/owner/crew-agents/demo/assistant',
        privateKeySecretRef: { type: 'secret_ref', secretId: 'sec-1', version: 'latest' },
        knownHosts: 'mac.local ssh-ed25519 AAAA',
        strictHostKeyChecking: true,
      },
      metadata: { workspaceRealizationMode: 'in_place', crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 30 } },
    });

    const agents = f.calls.filter((c) => c.fn === 'agents.create').map((c) => c.args[1] as Record<string, unknown>);
    expect(agents.map((a) => a.name)).toEqual(['demo-assistant', 'demo-executor', 'demo-reviewer', 'demo-integrator']);
    for (const body of agents) {
      expect(Object.keys(body).sort()).toEqual(
        ['adapterConfig', 'adapterType', 'defaultEnvironmentId', 'name', 'permissions', 'runtimeConfig'].sort(),
      );
      expect(body).toMatchObject({
        adapterType: 'claude_local',
        adapterConfig: {
          engine: 'cli',
          command: '/Users/owner/.crew/bin/crew-claude-run',
          extraArgs: ['--setting-sources', 'project,local', '--plugin-dir', PIN],
          env: {},
        },
        runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
        permissions: { canCreateAgents: false, canCreateSkills: false },
      });
    }
    expect((agents[0].adapterConfig as { model: string }).model).toBe('claude-opus-5');
    expect((agents[1].adapterConfig as { model: string }).model).toBe('claude-sonnet-5');

    // Chỉ Trợ Lý giữ quyền giao việc.
    const perms = f.calls.filter((c) => c.fn === 'agents.setPermissions').map((c) => c.args[1]);
    expect(perms).toEqual([
      { canCreateAgents: false, canCreateSkills: false, canAssignTasks: true },
      { canCreateAgents: false, canCreateSkills: false, canAssignTasks: false },
      { canCreateAgents: false, canCreateSkills: false, canAssignTasks: false },
      { canCreateAgents: false, canCreateSkills: false, canAssignTasks: false },
    ]);

    // AGENTS.md: Trợ Lý render sau khi có id của chính nó và executor.
    const [assistant, executor] = f.state.agents;
    expect(f.state.files.get(assistant.id)?.content).toBe(
      renderInstructions('assistant', { agentId: assistant.id, executorIds: [executor.id] }),
    );
    expect(f.state.files.get(executor.id)?.content).toBe(renderInstructions('executor', { agentId: executor.id }));

    const refs = Object.assign({}, ...Object.values(run.steps).map((s) => s?.refs ?? {}));
    expect(refs).toMatchObject({
      root: '/Users/owner/code/demo',
      checkout_assistant: '/Users/owner/crew-agents/demo/assistant',
      agent_assistant: assistant.id,
      instructions_assistant: `hash-${assistant.id}`,
    });
    expect(f.calls.find((c) => c.fn === 'roles.set')?.args[2]).toEqual({
      assistantAgentId: f.state.agents[0].id,
      executorAgentIds: [f.state.agents[1].id],
      reviewerAgentId: f.state.agents[2].id,
      integratorAgentId: f.state.agents[3].id,
    });
  });

  it('2 executor → thêm ô executor-2, Trợ Lý nhận cả hai executor', async () => {
    const f = fakeApi({
      run: addProjectRun({ input: { name: 'Demo', key: 'demo', folder: '/x/demo', executors: 2 } }),
    });
    await runAddProject(ctxOf(f.api), f.state.run);
    const names = f.calls.filter((c) => c.fn === 'agents.create').map((c) => (c.args[1] as { name: string }).name);
    expect(names).toEqual(['demo-assistant', 'demo-executor', 'demo-executor-2', 'demo-reviewer', 'demo-integrator']);
    const [assistant, e1, e2] = f.state.agents;
    expect(f.state.files.get(assistant.id)?.content).toBe(
      renderInstructions('assistant', { agentId: assistant.id, executorIds: [e1.id, e2.id] }),
    );
  });

  it('lỗi ở environments vai trò thứ 2 → run failed kèm refs dở, chưa có agent nên không pause', async () => {
    const f = fakeApi();
    f.failOn('environments.create', 2, new ApiError(422, 'secret không hợp lệ'));
    const run = await runAddProject(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('failed');
    expect(run.steps.environments).toMatchObject({ status: 'failed', error: 'secret không hợp lệ' });
    expect(run.steps.environments?.refs).toEqual({ environment_assistant: expect.any(String) });
    expect(f.names()).not.toContain('agents.pause');
    expect(f.names()).not.toContain('agents.create');
  });

  it('lỗi ở roles → pause đủ 4 agent đã tạo; Chạy tiếp chỉ gọi roles rồi check, không tạo lại', async () => {
    const f = fakeApi();
    f.failOn('roles.set', 1, new ApiError(400, 'Reviewer trùng'));
    const failed = await runAddProject(ctxOf(f.api), f.state.run);
    expect(failed.status).toBe('failed');
    expect(failed.steps.roles).toMatchObject({ status: 'failed', error: 'Reviewer trùng' });
    const paused = f.calls.filter((c) => c.fn === 'agents.pause');
    expect(paused.map((c) => c.args[0]).sort()).toEqual(f.state.agents.map((a) => a.id).sort());
    expect(paused.every((c) => c.args[1] === COMPANY)).toBe(true);

    f.clearFailures();
    f.calls.length = 0;
    const done = await runAddProject(ctxOf(f.api), failed);
    expect(done.status).toBe('done');
    expect(stepsCalled(f.calls)).toEqual(['roles', 'check']);
    for (const fn of ['projects.create', 'environments.create', 'agents.create']) expect(f.names()).not.toContain(fn);
    // Kiểm xong thì agent đang tạm dừng do lỗi trước được chạy lại.
    expect(f.calls.filter((c) => c.fn === 'agents.resume')).toHaveLength(4);
    expect(f.state.agents.every((a) => a.status === 'idle')).toBe(true);
  });

  it('check có mục error → bước check failed kèm danh sách mục', async () => {
    const f = fakeApi({
      jobOutcome: (payload) =>
        payload.kind === 'check'
          ? {
              status: 'failed',
              errorCode: 'check_failed',
              errorText: 'worktree bẩn',
              result: {
                kind: 'check',
                items: [
                  { id: 'a', status: 'ok', title: 'Ổn' },
                  { id: 'b', status: 'error', title: 'Worktree executor bẩn' },
                  { id: 'c', status: 'error', title: 'Thiếu bundle docs' },
                ],
              },
            }
          : payload.kind === 'inspect-folder'
            ? {
                status: 'done',
                result: {
                  kind: 'inspect-folder',
                  root: '/r',
                  branch: null,
                  remote: null,
                  docsBundle: null,
                  clean: true,
                },
              }
            : {
                status: 'done',
                result: {
                  kind: 'prepare-checkouts',
                  checkouts: (payload as { roles: { role: 'assistant' }[] }).roles.map((r) => ({
                    role: r.role,
                    path: `/c/${r.role}`,
                    head: 'b'.repeat(40),
                  })),
                },
              },
    });
    const run = await runAddProject(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('failed');
    expect(run.steps.check?.error).toBe('errors.checkFailed {"items":"Worktree executor bẩn; Thiếu bundle docs"}');
    expect(f.calls.filter((c) => c.fn === 'agents.pause')).toHaveLength(4);
  });

  it('inspect: folder không phải repo git → dừng ngay ở bước inspect', async () => {
    const f = fakeApi({
      jobOutcome: () => ({ status: 'failed', errorCode: 'folder_not_git', errorText: '/x không phải repo git' }),
    });
    const run = await runAddProject(ctxOf(f.api), f.state.run);
    expect(stepsCalled(f.calls)).toEqual(['inspect']);
    expect(run.steps.inspect?.error).toBe('errors.job.folder_not_git {"text":"/x không phải repo git"}');
  });

  it('Chạy tiếp gặp việc máy còn đang chờ thì chờ tiếp việc đó, không xếp việc mới', async () => {
    const f = fakeApi();
    f.state.jobs.push({
      id: 'old-job',
      companyId: COMPANY,
      machineId: 'm1',
      kind: 'inspect-folder',
      payload: { kind: 'inspect-folder', folder: '/Users/owner/code/demo' },
      status: 'done',
      result: {
        kind: 'inspect-folder',
        root: '/Users/owner/code/demo',
        branch: 'main',
        remote: null,
        docsBundle: null,
        clean: true,
      },
      errorCode: null,
      errorText: null,
      attempts: 0,
      setupRunId: 'run-1',
      createdAt: '2026-10-10T00:00:00Z',
      claimedAt: null,
      finishedAt: null,
    });
    const run = await runAddProjectStep(ctxOf(f.api), f.state.run, 'inspect');
    expect(run.steps.inspect?.status).toBe('done');
    expect(f.names()).not.toContain('jobs.create');
  });

  it('setup.begin trả 409 → StepBusyError, không gọi gì thêm', async () => {
    const f = fakeApi({ busy: true });
    await expect(runAddProject(ctxOf(f.api), f.state.run)).rejects.toBeInstanceOf(StepBusyError);
    expect(f.names()).toEqual(['setup.begin']);
  });

  it('đổi company đang chọn giữa environments và agents → mọi lời gọi vẫn mang companyId của run', async () => {
    const f = fakeApi();
    // Trang đổi company giữa chừng: runner không đọc company đang chọn, chỉ dùng run.companyId.
    let selected = COMPANY;
    const create = f.api.environments.create;
    f.api.environments.create = async (companyId, body) => {
      selected = 'c-other';
      return create(companyId, body);
    };
    await runAddProject(ctxOf(f.api), f.state.run);
    expect(selected).toBe('c-other');
    const companyArgs = f.calls.flatMap((c) => {
      if (
        [
          'agents.pause',
          'agents.resume',
          'agents.instructionsFile',
          'agents.saveInstructionsFile',
          'agents.setPermissions',
        ].includes(c.fn)
      ) {
        return [c.args[c.args.length - 1]];
      }
      if (c.fn === 'jobs.create') return [(c.args[0] as { companyId: string }).companyId];
      return [c.args[0]];
    });
    expect(new Set(companyArgs)).toEqual(new Set([COMPANY]));
  });

  it('finish gửi lại đúng mã chủ khóa mà begin trả', async () => {
    const f = fakeApi();
    await runAddProjectStep(ctxOf(f.api), f.state.run, 'inspect');
    const token = f.calls.find((c) => c.fn === 'setup.finish')?.args[3] as { lockToken?: string };
    expect(token.lockToken).toMatch(/^0f/);
  });

  it('tab khác đã lấy khóa khi việc xong (finish 409) → StepBusyError, không ghi lỗi, không tạm dừng agent', async () => {
    const f = fakeApi();
    const run = await runAddProject(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('done');
    // Dựng lại run dở ở bước check, rồi để finish của bước check bị 409 như khi tab khác đã begin lại.
    const halfway = { ...run, status: 'running' as const, steps: { ...run.steps, check: undefined } };
    f.state.run = structuredClone(halfway);
    f.calls.length = 0;
    const finish = f.api.setup.finish;
    f.api.setup.finish = async (companyId, id, stepId, body) => {
      f.state.lockToken = 'token-cua-tab-khac';
      return finish(companyId, id, stepId, body);
    };
    await expect(runAddProjectStep(ctxOf(f.api), halfway, 'check')).rejects.toBeInstanceOf(StepBusyError);
    expect(f.calls.filter((c) => c.fn === 'setup.finish')).toHaveLength(1);
    expect(f.names()).not.toContain('agents.pause');
  });

  it('việc lỗi mà finish failed cũng 409 → StepBusyError, không tạm dừng agent', async () => {
    const f = fakeApi();
    f.failOn('roles.set', 1, new ApiError(400, 'Reviewer trùng'));
    const finish = f.api.setup.finish;
    f.api.setup.finish = async (companyId, id, stepId, body) => {
      if (stepId === 'roles') f.state.lockToken = 'token-cua-tab-khac';
      return finish(companyId, id, stepId, body);
    };
    await expect(runAddProject(ctxOf(f.api), f.state.run)).rejects.toBeInstanceOf(StepBusyError);
    expect(f.names()).toContain('agents.create');
    expect(f.names()).not.toContain('agents.pause');
  });

  it('environment mẫu thiếu knownHosts thì không dùng làm mẫu', async () => {
    const f = fakeApi();
    const template = f.state.environments[0] as { config: Record<string, unknown> };
    template.config = { ...template.config, knownHosts: null };
    const run = await runAddProject(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('failed');
    expect(run.steps.environments?.error).toContain('errors.noTemplate');
    expect(f.names()).not.toContain('environments.create');
  });

  it('bước đã done thì bỏ qua, không begin lại', async () => {
    const f = fakeApi();
    const run = await runAddProjectStep(
      ctxOf(f.api),
      addProjectRun({ steps: { inspect: { status: 'done', at: 'x', refs: { root: '/r' } } } }),
      'inspect',
    );
    expect(run.steps.inspect?.status).toBe('done');
    expect(f.calls).toHaveLength(0);
  });
});
