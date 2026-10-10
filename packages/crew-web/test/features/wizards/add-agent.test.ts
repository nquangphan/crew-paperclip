import { describe, expect, it } from 'vitest';
import { ApiError, type CrewRoleSlot, type ProjectRoles, type SetupRun } from '@/api';
import { computeAgentReadiness } from '@/features/readiness';
import { prepareFixRun, runAddAgent, runAddAgentStep } from '@/features/wizards/add-agent/run-step';
import { StepBusyError } from '@/features/wizards/add-project/run-step';
import {
  crewAgentCreateBody,
  crewExtraArgs,
  defaultModelOf,
  isRuntimeSlot,
  renderAssistantFor,
  renderInstructions,
} from '@/lib/instructions';
import { COMPANY, type FakeAgent, fakeApi, type JobOutcome, PIN, TEMPLATE_ENV } from './fake-api';

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
const FOLDER = '/Users/owner/code/demo';
const ctxOf = (api: unknown, seed: Record<string, string> = { folder: FOLDER }) => ({
  api: api as never,
  t,
  pollMs: 1,
  seed,
});

const ID = {
  assistant: 'a1111111-1111-4111-8111-111111111111',
  executor: 'e2222222-2222-4222-8222-222222222222',
  reviewer: 'b4444444-4444-4444-8444-444444444444',
  integrator: 'c5555555-5555-4555-8555-555555555555',
  bmad: 'f7777777-7777-4777-8777-777777777777',
};
const PROJECT = 'p0000000-0000-4000-8000-000000000001';

function existing(id: string, name: string, role: 'assistant' | 'executor' | 'reviewer' | 'integrator'): FakeAgent {
  const body = crewAgentCreateBody({ name, role, model: 'claude-sonnet-5', pinDir: PIN, environmentId: `env-${name}` });
  return {
    id,
    name,
    status: 'idle',
    defaultEnvironmentId: `env-${name}`,
    adapterType: body.adapterType,
    adapterConfig: { ...body.adapterConfig },
    runtimeConfig: structuredClone(body.runtimeConfig),
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

const ASSISTANT_FILE = renderInstructions('assistant', {
  agentId: ID.assistant,
  executorIds: [ID.executor],
  bmadIds: [ID.bmad],
});

function addAgentRun(slot: CrewRoleSlot, over: Partial<SetupRun> = {}) {
  return {
    id: 'run-a',
    companyId: COMPANY,
    kind: 'add-agent',
    projectKey: 'demo',
    projectId: PROJECT,
    machineId: 'm1',
    input: {
      projectId: PROJECT,
      slot,
      name: `demo-${slot}-moi`,
      model: isRuntimeSlot(slot) ? defaultModelOf(slot) : 'claude-sonnet-5',
    },
    steps: {},
    status: 'running',
    runningStep: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...over,
  } satisfies SetupRun;
}

/** Project demo có đủ 4 vai trò do app tạo; Trợ Lý có AGENTS.md liệt kê executor và một agent BMAD. */
function setup(run: SetupRun, jobOutcome?: JobOutcome) {
  const f = fakeApi({ run, jobOutcome });
  f.state.agents.push(
    existing(ID.assistant, 'demo-assistant', 'assistant'),
    existing(ID.executor, 'demo-executor', 'executor'),
    existing(ID.reviewer, 'demo-reviewer', 'reviewer'),
    existing(ID.integrator, 'demo-integrator', 'integrator'),
  );
  f.state.roles = {
    assistantAgentId: ID.assistant,
    executorAgentIds: [ID.executor],
    reviewerAgentId: ID.reviewer,
    integratorAgentId: ID.integrator,
  };
  f.state.files.set(ID.assistant, { content: ASSISTANT_FILE, contentHash: 'hash-old' });
  return f;
}

const begun = (calls: { fn: string; args: unknown[] }[]) =>
  calls.filter((c) => c.fn === 'setup.begin').map((c) => c.args[2]);
const savedContent = (calls: { fn: string; args: unknown[] }[], id: string) =>
  (saves(calls, id)[0]?.args[1] as { content?: string } | undefined)?.content;
const saves = (calls: { fn: string; args: unknown[] }[], id: string) =>
  calls.filter((c) => c.fn === 'agents.saveInstructionsFile' && c.args[0] === id);

describe('runAddAgent', () => {
  it('thêm executor-2: đủ 6 bước, agent đúng I9, checkout riêng, bước cuối ghi AGENTS.md Trợ Lý có executor mới', async () => {
    const f = setup(addAgentRun('executor-2'));
    const run = await runAddAgent(ctxOf(f.api), f.state.run);

    expect(run.status).toBe('done');
    expect(begun(f.calls)).toEqual(['agent', 'pin', 'environment', 'workspace', 'role', 'assistant-instructions']);

    const created = f.state.agents.find((a) => a.name === 'demo-executor-2-moi');
    expect(created).toBeDefined();
    const newId = created?.id as string;
    const create = f.calls.find((c) => c.fn === 'agents.create');
    expect(create?.args).toEqual([
      COMPANY,
      crewAgentCreateBody({ name: 'demo-executor-2-moi', role: 'executor', model: 'claude-sonnet-5', pinDir: PIN }),
    ]);
    expect(f.calls.find((c) => c.fn === 'agents.setPermissions')?.args).toEqual([
      newId,
      { canCreateAgents: false, canCreateSkills: false, canAssignTasks: false },
      COMPANY,
    ]);

    // Ghim đã đúng từ lúc tạo: không PATCH adapterConfig; AGENTS.md executor theo template.
    expect(f.calls.some((c) => c.fn === 'agents.update' && 'adapterConfig' in (c.args[1] as object))).toBe(false);
    expect(savedContent(f.calls, newId)).toBe(renderInstructions('executor', { agentId: newId }));

    const envCreate = f.calls.find((c) => c.fn === 'environments.create');
    expect(envCreate?.args[0]).toBe(COMPANY);
    expect(envCreate?.args[1]).toMatchObject({
      name: 'demo-executor-2',
      driver: 'ssh',
      config: {
        host: TEMPLATE_ENV.config.host,
        remoteWorkspacePath: '/Users/owner/crew-agents/demo/executor-2',
        privateKeySecretRef: { type: 'secret_ref', secretId: 'sec-1', version: 'latest' },
      },
      metadata: { workspaceRealizationMode: 'in_place', crewLoadGate: TEMPLATE_ENV.metadata.crewLoadGate },
    });
    const envId = f.state.environments.at(-1)?.id;
    expect(f.calls.find((c) => c.fn === 'agents.update')?.args).toEqual([
      newId,
      { defaultEnvironmentId: envId },
      COMPANY,
    ]);

    expect(f.calls.find((c) => c.fn === 'jobs.create')?.args[0]).toEqual({
      companyId: COMPANY,
      machineId: 'm1',
      kind: 'agent-workspace',
      payload: {
        kind: 'agent-workspace',
        projectKey: 'demo',
        folder: FOLDER,
        role: 'executor-2',
        branch: 'crew/demo/executor-2',
      },
      setupRunId: 'run-a',
    });

    expect(f.state.roles).toEqual({
      assistantAgentId: ID.assistant,
      executorAgentIds: [ID.executor, newId],
      reviewerAgentId: ID.reviewer,
      integratorAgentId: ID.integrator,
    });

    const assistantPut = saves(f.calls, ID.assistant);
    expect(assistantPut).toHaveLength(1);
    expect(assistantPut[0]?.args[1]).toEqual({
      path: 'AGENTS.md',
      content: renderInstructions('assistant', {
        agentId: ID.assistant,
        executorIds: [ID.executor, newId],
        bmadIds: [ID.bmad],
      }),
      baseHash: 'hash-old',
    });

    expect(run.steps.agent?.refs).toMatchObject({ agent: newId, created: 'true', folder: FOLDER });
    expect(run.steps.environment?.refs).toEqual({
      environment: envId,
      checkout: '/Users/owner/crew-agents/demo/executor-2',
    });
    expect(run.steps.pin?.refs?.instructions).toBe(`hash-${newId}`);
    // Mọi lời gọi mang company của run.
    for (const c of f.calls.filter((x) => x.fn === 'setup.begin' || x.fn === 'roles.set')) {
      expect(c.args[0]).toBe(COMPANY);
    }
    expect(f.calls.some((c) => c.fn === 'agents.pause')).toBe(false);
  });

  it('thay reviewer: ghi vai trò mới, không render lại AGENTS.md của Trợ Lý, run vẫn xong', async () => {
    const f = setup(addAgentRun('reviewer'));
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    const newId = f.state.agents.find((a) => a.name === 'demo-reviewer-moi')?.id;

    expect(run.status).toBe('done');
    expect(f.state.roles?.reviewerAgentId).toBe(newId);
    expect(f.state.roles?.executorAgentIds).toEqual([ID.executor]);
    expect(saves(f.calls, ID.assistant)).toHaveLength(0);
    expect(run.steps['assistant-instructions']?.status).toBe('done');
  });

  it('thay Trợ Lý: chỉ Trợ Lý giữ quyền giao việc, AGENTS.md mới có executor và agent BMAD hiện có', async () => {
    const f = setup(addAgentRun('assistant'));
    await runAddAgent(ctxOf(f.api), f.state.run);
    const newId = f.state.agents.find((a) => a.name === 'demo-assistant-moi')?.id as string;

    expect(f.calls.find((c) => c.fn === 'agents.setPermissions')?.args[1]).toEqual({
      canCreateAgents: false,
      canCreateSkills: false,
      canAssignTasks: true,
    });
    const body = f.calls.find((c) => c.fn === 'agents.create')?.args[1] as { adapterConfig?: { model?: string } };
    expect(body.adapterConfig?.model).toBe('claude-sonnet-5');
    expect(savedContent(f.calls, newId)).toBe(
      renderInstructions('assistant', { agentId: newId, executorIds: [ID.executor], bmadIds: [ID.bmad] }),
    );
    expect(f.state.roles?.assistantAgentId).toBe(newId);
  });

  it('thay Trợ Lý: Trợ Lý cũ không còn giữ ô Trợ Lý ở project nào thì bị bỏ quyền giao việc', async () => {
    const f = setup(addAgentRun('assistant'));
    const OTHER = 'p0000000-0000-4000-8000-000000000002';
    f.state.projects.push(
      { id: PROJECT, name: 'Demo', urlKey: 'demo', createdAt: 'x', archivedAt: null },
      { id: OTHER, name: 'Khác', urlKey: 'khac', createdAt: 'x', archivedAt: null },
    );
    f.state.rolesBy.set(OTHER, null);
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('done');
    expect(
      f.calls.filter((c) => c.fn === 'agents.setPermissions' && c.args[0] === ID.assistant).map((c) => c.args),
    ).toEqual([[ID.assistant, { canCreateAgents: false, canCreateSkills: false, canAssignTasks: false }, COMPANY]]);
  });

  it('thay Trợ Lý: Trợ Lý cũ còn là Trợ Lý của project khác thì giữ quyền giao việc', async () => {
    const f = setup(addAgentRun('assistant'));
    const OTHER = 'p0000000-0000-4000-8000-000000000002';
    f.state.projects.push(
      { id: PROJECT, name: 'Demo', urlKey: 'demo', createdAt: 'x', archivedAt: null },
      { id: OTHER, name: 'Khác', urlKey: 'khac', createdAt: 'x', archivedAt: null },
    );
    f.state.rolesBy.set(OTHER, { ...(f.state.roles as ProjectRoles) });
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('done');
    expect(f.calls.some((c) => c.fn === 'agents.setPermissions' && c.args[0] === ID.assistant)).toBe(false);
  });

  it('tab khác đã lấy khóa khi bước xong (finish 409) → StepBusyError, agent mới không bị tạm dừng', async () => {
    const f = setup(addAgentRun('executor-2'));
    const finish = f.api.setup.finish;
    f.api.setup.finish = async (companyId, id, stepId, body) => {
      if (stepId === 'pin') f.state.lockToken = 'token-cua-tab-khac';
      return finish(companyId, id, stepId, body);
    };
    await expect(runAddAgent(ctxOf(f.api), f.state.run)).rejects.toBeInstanceOf(StepBusyError);
    expect(f.names()).toContain('agents.create');
    expect(f.names()).not.toContain('agents.pause');
  });

  it('lỗi workspace: run failed, agent mới bị tạm dừng, readiness not_ready A5; không xóa gì', async () => {
    const f = setup(addAgentRun('executor-2'), (payload) =>
      payload.kind === 'agent-workspace'
        ? { status: 'failed', errorCode: 'git_failed', errorText: 'worktree add lỗi' }
        : { status: 'done' },
    );
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    const agent = f.state.agents.find((a) => a.name === 'demo-executor-2-moi') as FakeAgent;

    expect(run.status).toBe('failed');
    expect(run.steps.workspace?.status).toBe('failed');
    expect(run.steps.workspace?.error).toContain('errors.job.git_failed');
    expect(f.calls.filter((c) => c.fn === 'agents.pause').map((c) => c.args)).toEqual([[agent.id, COMPANY]]);
    expect(agent.status).toBe('paused');
    expect(f.calls.some((c) => c.fn === 'roles.set')).toBe(false);
    expect(f.names().some((n) => n.includes('delete') || n.includes('archive'))).toBe(false);

    const environment = f.state.environments.find((e) => e.id === agent.defaultEnvironmentId) as never;
    const readiness = computeAgentReadiness({
      agent: agent as never,
      environment,
      report: { superpowers: { pinned: '5.0.7', pinDir: PIN }, checkouts: [] },
      roleOf: null,
      setupRun: run,
      instructionsHash: f.state.files.get(agent.id)?.contentHash ?? null,
    });
    expect(readiness.state).toBe('not_ready');
    expect(readiness.failed.map((x) => x.id)).toContain('A5');
    expect(readiness.failed.find((x) => x.id === 'A5')?.resume).toEqual({
      wizard: 'add-agent',
      step: 'workspace',
      agentId: agent.id,
    });
  });

  it('Chạy tiếp sau lỗi workspace: không tạo lại agent/environment, xong thì chạy lại agent đã tạm dừng', async () => {
    let fail = true;
    const f = setup(addAgentRun('executor-2'), (payload) =>
      payload.kind === 'agent-workspace' && fail
        ? { status: 'failed', errorCode: 'git_failed', errorText: 'lỗi' }
        : {
            status: 'done',
            result: {
              kind: 'agent-workspace',
              role: 'executor-2',
              path: '/Users/owner/crew-agents/demo/executor-2',
              head: 'c'.repeat(40),
            },
          },
    );
    const failed = await runAddAgent(ctxOf(f.api), f.state.run);
    fail = false;
    const before = f.calls.length;
    // Chạy tiếp ở trình duyệt khác: không có seed folder, lấy lại từ refs.
    const run = await runAddAgent(ctxOf(f.api, {}), failed);
    const after = f.calls.slice(before);

    expect(run.status).toBe('done');
    expect(after.filter((c) => c.fn === 'setup.begin').map((c) => c.args[2])).toEqual([
      'workspace',
      'role',
      'assistant-instructions',
    ]);
    expect(after.some((c) => c.fn === 'agents.create' || c.fn === 'environments.create')).toBe(false);
    const agent = f.state.agents.find((a) => a.name === 'demo-executor-2-moi') as FakeAgent;
    expect(after.filter((c) => c.fn === 'agents.resume').map((c) => c.args)).toEqual([[agent.id, COMPANY]]);
    expect(agent.status).toBe('idle');
  });

  it('setup.begin 409 → StepBusyError, không gọi gì thêm', async () => {
    const f = setup(addAgentRun('executor-2'));
    f.state.busy = true;
    await expect(runAddAgentStep(ctxOf(f.api), f.state.run, 'agent')).rejects.toBeInstanceOf(StepBusyError);
    expect(f.names()).toEqual(['setup.begin']);
  });

  it('agent đã giữ vai trò nhưng project không có dòng vai trò → bước role lỗi, có câu dịch', async () => {
    const f = setup(addAgentRun('reviewer'));
    f.state.roles = null;
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('failed');
    expect(run.steps.role?.error).toContain('errors.noRoles');
  });
});

describe('chế độ sửa (agent do app tạo, không có setup run)', () => {
  it('sửa từ bước pin: bỏ bước agent, PATCH ghim lệch, các bước sau đã đạt thì không ghi gì thêm', async () => {
    const f = setup(
      addAgentRun('executor', {
        input: { projectId: PROJECT, slot: 'executor', name: 'demo-executor', model: 'claude-sonnet-5' },
      }),
    );
    const agent = f.state.agents.find((a) => a.id === ID.executor) as FakeAgent;
    agent.adapterConfig = {
      ...agent.adapterConfig,
      extraArgs: crewExtraArgs('/Users/owner/.crew/workflows/superpowers/4.0.0'),
    };
    f.state.environments.push({
      ...structuredClone(TEMPLATE_ENV),
      id: agent.defaultEnvironmentId,
      name: 'demo-executor',
      config: { ...TEMPLATE_ENV.config, remoteWorkspacePath: '/Users/owner/crew-agents/demo/executor' },
    });
    f.state.files.set(ID.executor, { content: 'bản cũ của app', contentHash: 'h-exec' });

    const seeded = await prepareFixRun(ctxOf(f.api), f.state.run, { agentId: ID.executor, step: 'pin' });
    expect(seeded.steps.agent).toMatchObject({ status: 'done', refs: { agent: ID.executor, folder: FOLDER } });
    const run = await runAddAgent(ctxOf(f.api), seeded);

    expect(run.status).toBe('done');
    expect(f.calls.some((c) => c.fn === 'agents.create' || c.fn === 'environments.create')).toBe(false);
    expect(f.calls.find((c) => c.fn === 'agents.update')?.args).toEqual([
      ID.executor,
      { adapterConfig: { command: '/Users/owner/.crew/bin/crew-claude-run', extraArgs: crewExtraArgs(PIN) } },
      COMPANY,
    ]);
    expect(agent.adapterConfig?.engine).toBe('cli');
    // AGENTS.md đang có (A3 đạt): không ghi đè phần owner sửa tay.
    expect(saves(f.calls, ID.executor)).toHaveLength(0);
    expect(f.state.files.get(ID.executor)?.content).toBe('bản cũ của app');
    expect(f.calls.some((c) => c.fn === 'roles.set')).toBe(false);
    expect(saves(f.calls, ID.assistant)).toHaveLength(0);
    // Agent không do wizard tạo: không tạm dừng, không bật lại.
    expect(f.calls.some((c) => c.fn === 'agents.pause' || c.fn === 'agents.resume')).toBe(false);
  });

  it('sửa từ bước pin vì AGENTS.md lệch (A3): ghi lại AGENTS.md theo mẫu, cả khi chạy tiếp ở trình duyệt khác', async () => {
    const f = setup(
      addAgentRun('executor', {
        input: { projectId: PROJECT, slot: 'executor', name: 'demo-executor', model: 'claude-sonnet-5' },
      }),
    );
    f.state.files.set(ID.executor, { content: 'bản lệch', contentHash: 'h-exec' });
    const seeded = await prepareFixRun(ctxOf(f.api, { folder: FOLDER, rewrite: 'true' }), f.state.run, {
      agentId: ID.executor,
      step: 'pin',
    });
    expect(seeded.steps.agent?.refs).toMatchObject({ rewrite: 'true' });
    await runAddAgentStep(ctxOf(f.api, {}), seeded, 'pin');
    expect(savedContent(f.calls, ID.executor)).toBe(renderInstructions('executor', { agentId: ID.executor }));
  });

  it('sửa agent chưa có AGENTS.md: ghi file theo mẫu', async () => {
    const f = setup(
      addAgentRun('executor', {
        input: { projectId: PROJECT, slot: 'executor', name: 'demo-executor', model: 'claude-sonnet-5' },
      }),
    );
    const seeded = await prepareFixRun(ctxOf(f.api), f.state.run, { agentId: ID.executor, step: 'pin' });
    await runAddAgentStep(ctxOf(f.api), seeded, 'pin');
    expect(savedContent(f.calls, ID.executor)).toBe(renderInstructions('executor', { agentId: ID.executor }));
  });

  it('sửa từ bước agent (A1): PATCH merge engine/env/heartbeat, không tạo agent mới', async () => {
    const f = setup(
      addAgentRun('reviewer', {
        input: { projectId: PROJECT, slot: 'reviewer', name: 'demo-reviewer', model: 'claude-sonnet-5' },
      }),
    );
    const agent = f.state.agents.find((a) => a.id === ID.reviewer) as FakeAgent;
    agent.adapterConfig = { ...agent.adapterConfig, engine: undefined, env: { TOKEN: 'x' } };
    agent.runtimeConfig = { heartbeat: { enabled: true, intervalSec: 60 }, other: 1 };

    const seeded = await prepareFixRun(ctxOf(f.api), f.state.run, { agentId: ID.reviewer, step: 'agent' });
    expect(seeded.steps.agent).toBeUndefined();
    await runAddAgentStep(ctxOf(f.api, { folder: FOLDER, agent: ID.reviewer }), seeded, 'agent');

    expect(f.calls.some((c) => c.fn === 'agents.create')).toBe(false);
    expect(f.calls.find((c) => c.fn === 'agents.update')?.args).toEqual([
      ID.reviewer,
      {
        adapterConfig: { engine: 'cli', env: {} },
        runtimeConfig: { heartbeat: { enabled: false, intervalSec: 60, maxConcurrentRuns: 1 }, other: 1 },
      },
      COMPANY,
    ]);
    expect(f.calls.find((c) => c.fn === 'agents.setPermissions')?.args[1]).toMatchObject({ canAssignTasks: false });
  });

  it('lỗi ở chế độ sửa không tạm dừng agent có sẵn', async () => {
    const f = setup(
      addAgentRun('executor', {
        input: { projectId: PROJECT, slot: 'executor', name: 'demo-executor', model: 'claude-sonnet-5' },
      }),
    );
    f.failOn('agents.get', 1, new ApiError(500, 'Lỗi máy chủ'));
    const seeded = await prepareFixRun(ctxOf(f.api), f.state.run, { agentId: ID.executor, step: 'pin' });
    const run = await runAddAgent(ctxOf(f.api), seeded);
    expect(run.status).toBe('failed');
    expect(run.steps.pin?.error).toBe('Lỗi máy chủ');
    expect(f.calls.some((c) => c.fn === 'agents.pause')).toBe(false);
  });
});

describe('ô runtime Codex/OpenCode', () => {
  it('thêm executor Codex: agent codex_local, ghim bằng wrapper codex, ô riêng, AGENTS.md Trợ Lý có runtime', async () => {
    const f = setup(addAgentRun('executor-codex'));
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('done');
    const created = f.state.agents.find((a) => a.name === 'demo-executor-codex-moi') as FakeAgent;
    expect(f.calls.find((c) => c.fn === 'agents.create')?.args).toEqual([
      COMPANY,
      crewAgentCreateBody({
        name: 'demo-executor-codex-moi',
        slot: 'executor-codex',
        model: 'gpt-6-luna',
        pinDir: PIN,
        projectKey: 'demo',
      }),
    ]);
    expect(created.adapterType).toBe('codex_local');
    // Ghim đúng từ lúc tạo: không PATCH adapterConfig; AGENTS.md theo template executor.
    expect(f.calls.some((c) => c.fn === 'agents.update' && 'adapterConfig' in (c.args[1] as object))).toBe(false);
    expect(savedContent(f.calls, created.id)).toBe(renderInstructions('executor', { agentId: created.id }));
    expect(f.calls.find((c) => c.fn === 'environments.create')?.args[1]).toMatchObject({
      name: 'demo-executor-codex',
      config: { remoteWorkspacePath: '/Users/owner/crew-agents/demo/executor-codex' },
    });
    expect((f.calls.find((c) => c.fn === 'jobs.create')?.args[0] as { payload: unknown } | undefined)?.payload).toEqual(
      {
        kind: 'agent-workspace',
        projectKey: 'demo',
        folder: FOLDER,
        role: 'executor-codex',
        branch: 'crew/demo/executor-codex',
      },
    );
    expect(f.state.roles).toEqual({
      assistantAgentId: ID.assistant,
      executorAgentIds: [ID.executor],
      reviewerAgentId: ID.reviewer,
      integratorAgentId: ID.integrator,
      codexExecutorAgentId: created.id,
    });
    expect(savedContent(f.calls, ID.assistant)).toBe(
      renderInstructions('assistant', {
        agentId: ID.assistant,
        executorIds: [ID.executor, `${created.id}:codex_local`],
        bmadIds: [ID.bmad],
      }),
    );
    // Agent Codex không giao việc.
    expect(f.calls.find((c) => c.fn === 'agents.setPermissions')?.args[1]).toMatchObject({ canAssignTasks: false });
  });

  it('thêm executor OpenCode: agent opencode_local, Trợ Lý thấy runtime opencode_local', async () => {
    const f = setup(addAgentRun('executor-opencode'));
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('done');
    const created = f.state.agents.find((a) => a.name === 'demo-executor-opencode-moi') as FakeAgent;
    expect(created.adapterType).toBe('opencode_local');
    expect(created.adapterConfig).toMatchObject({
      command: '/Users/owner/.crew/bin/crew-opencode-run',
      model: 'opencode-go/kimi-k3',
      env: {},
    });
    expect(f.state.roles?.opencodeExecutorAgentId).toBe(created.id);
    expect(savedContent(f.calls, ID.assistant)).toContain(`- \`${created.id}\` — runtime \`opencode_local\``);
  });

  it('thêm reviewer Codex: AGENTS.md theo template reviewer, Trợ Lý có mục reviewer Codex', async () => {
    const f = setup(addAgentRun('reviewer-codex'));
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('done');
    const created = f.state.agents.find((a) => a.name === 'demo-reviewer-codex-moi') as FakeAgent;
    expect(created.adapterConfig).toMatchObject({ model: 'gpt-6-sol', modelReasoningEffort: 'high' });
    expect(savedContent(f.calls, created.id)).toBe(renderInstructions('reviewer', { agentId: created.id }));
    expect(f.state.roles?.codexReviewerAgentId).toBe(created.id);
    expect(f.state.roles?.reviewerAgentId).toBe(ID.reviewer);
    expect(savedContent(f.calls, ID.assistant)).toBe(renderAssistantFor(f.state.roles as ProjectRoles, ASSISTANT_FILE));
  });

  it('thay executor Codex: ô Codex đổi agent, ô Claude giữ nguyên', async () => {
    const OLD = 'd6666666-6666-4666-8666-666666666666';
    const f = setup(addAgentRun('executor-codex'));
    f.state.roles = { ...(f.state.roles as ProjectRoles), codexExecutorAgentId: OLD };
    const run = await runAddAgent(ctxOf(f.api), f.state.run);
    expect(run.status).toBe('done');
    const created = f.state.agents.find((a) => a.name === 'demo-executor-codex-moi') as FakeAgent;
    expect(f.state.roles?.codexExecutorAgentId).toBe(created.id);
    expect(f.state.roles?.executorAgentIds).toEqual([ID.executor]);
  });

  it('sửa agent Codex có sẵn từ bước agent: PATCH bỏ sandbox, CODEX_HOME, heartbeat; không engine', async () => {
    const CODEX = 'd6666666-6666-4666-8666-666666666666';
    const f = setup(
      addAgentRun('executor-codex', {
        input: { projectId: PROJECT, slot: 'executor-codex', name: 'demo-codex', model: 'gpt-6-luna' },
      }),
    );
    f.state.agents.push({
      id: CODEX,
      name: 'demo-codex',
      status: 'idle',
      defaultEnvironmentId: null,
      adapterType: 'codex_local',
      adapterConfig: { command: '/Users/owner/.crew/bin/crew-codex-run', model: 'gpt-6-sol', env: {} },
      runtimeConfig: {},
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    f.state.roles = { ...(f.state.roles as ProjectRoles), codexExecutorAgentId: CODEX };
    const seeded = await prepareFixRun(ctxOf(f.api), f.state.run, { agentId: CODEX, step: 'agent' });
    await runAddAgentStep(ctxOf(f.api, { folder: FOLDER, agent: CODEX }), seeded, 'agent');
    expect(f.calls.find((c) => c.fn === 'agents.update')?.args).toEqual([
      CODEX,
      {
        adapterConfig: {
          dangerouslyBypassApprovalsAndSandbox: true,
          env: { CODEX_HOME: '/paperclip/instances/default/crew-codex-home/demo/executor-codex' },
        },
        runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
      },
      COMPANY,
    ]);
  });

  it('sửa ô Codex mà agent không chạy codex_local → lỗi, không PATCH', async () => {
    const f = setup(
      addAgentRun('executor-codex', {
        input: { projectId: PROJECT, slot: 'executor-codex', name: 'demo-executor', model: 'gpt-6-luna' },
      }),
    );
    const seeded = await prepareFixRun(ctxOf(f.api), f.state.run, { agentId: ID.executor, step: 'agent' });
    const run = await runAddAgentStep(ctxOf(f.api, { folder: FOLDER, agent: ID.executor }), seeded, 'agent');
    expect(run.steps.agent?.error).toContain('errors.wrongAdapter');
    expect(f.calls.some((c) => c.fn === 'agents.update')).toBe(false);
  });

  it('sửa ghim agent Codex: PATCH command wrapper codex, extraArgs rỗng', async () => {
    const CODEX = 'd6666666-6666-4666-8666-666666666666';
    const f = setup(
      addAgentRun('executor-codex', {
        input: { projectId: PROJECT, slot: 'executor-codex', name: 'demo-codex', model: 'gpt-6-luna' },
      }),
    );
    const body = crewAgentCreateBody({
      name: 'demo-codex',
      slot: 'executor-codex',
      model: 'gpt-6-luna',
      pinDir: PIN,
      projectKey: 'demo',
    });
    f.state.agents.push({
      id: CODEX,
      name: 'demo-codex',
      status: 'idle',
      defaultEnvironmentId: null,
      adapterType: 'codex_local',
      adapterConfig: {
        ...body.adapterConfig,
        command: '/Users/owner/.crew/bin/crew-claude-run',
        extraArgs: ['--plugin-dir', PIN],
      },
      runtimeConfig: structuredClone(body.runtimeConfig),
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    f.state.files.set(CODEX, { content: 'x', contentHash: 'h' });
    const seeded = await prepareFixRun(ctxOf(f.api), f.state.run, { agentId: CODEX, step: 'pin' });
    await runAddAgentStep(ctxOf(f.api), seeded, 'pin');
    expect(f.calls.find((c) => c.fn === 'agents.update')?.args).toEqual([
      CODEX,
      { adapterConfig: { command: '/Users/owner/.crew/bin/crew-codex-run', extraArgs: [] } },
      COMPANY,
    ]);
  });
});
