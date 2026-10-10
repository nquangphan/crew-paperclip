import { describe, expect, it } from 'vitest';
import { loadProjectReadiness, type ReadinessSource } from '@/features/readiness';
import { matchesAssistantTemplate } from '@/features/readiness/assistant-instructions';
import { crewAgentCreateBody, renderAssistantFor, renderInstructions } from '@/lib/instructions';

const C = 'c0000000-0000-4000-8000-000000000000';
const HOME = '/Users/owner';
const PIN = `${HOME}/.crew/workflows/superpowers/6.4.1-x`;
const HASH = 'a'.repeat(64);

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const agent = (id: string, env: string, over: Record<string, unknown> = {}) => ({
  id,
  status: 'idle',
  adapterType: 'claude_local',
  adapterConfig: {
    engine: 'cli',
    command: `${HOME}/.crew/bin/crew-claude-run`,
    extraArgs: ['--setting-sources', 'project,local', '--plugin-dir', PIN],
    model: 'claude-sonnet-5',
    env: {},
  },
  runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
  defaultEnvironmentId: env,
  ...over,
});
const env = (id: string, path: string) => ({
  id,
  driver: 'ssh',
  status: 'active',
  config: { remoteWorkspacePath: path },
  metadata: { workspaceRealizationMode: 'in_place' },
});
const path = (role: string) => `${HOME}/crew-agents/demo/${role}`;

function source(over: Partial<{ checkouts: string[]; missingFile: string[]; rolesFor: Record<string, unknown> }> = {}) {
  const calls: string[] = [];
  const roles = ['assistant', 'executor', 'reviewer', 'integrator'];
  const src: ReadinessSource = {
    agents: {
      list: async (companyId) => {
        calls.push(`agents.list ${companyId}`);
        return [
          ...roles.map((r) => agent(`ag-${r}`, `env-${r}`)),
          agent('r1-tro-ly', 'env-r1', {}),
          agent('stray', 'env-stray', { status: 'terminated' }),
        ];
      },
      instructionsFile: async (id, p, companyId) => {
        calls.push(`instructionsFile ${id} ${p} ${companyId}`);
        if (over.missingFile?.includes(id)) throw new HttpError(404);
        return { content: 'x', contentHash: HASH };
      },
    },
    environments: {
      list: async () => [...roles.map((r) => env(`env-${r}`, path(r))), env('env-r1', `${HOME}/crew-agents/assistant`)],
    },
    projects: {
      list: async () => [
        { id: 'p-demo', archivedAt: null },
        { id: 'p-r1', archivedAt: null },
        { id: 'p-plain', archivedAt: null },
        { id: 'p-old', archivedAt: '2026-01-01T00:00:00.000Z' },
      ],
    },
    issues: {
      list: async (_companyId, filters) => {
        calls.push(`issues.list ${filters?.projectId}`);
        if (filters?.projectId === 'p-r1') {
          return [
            { id: 'root-1', parentId: null, assigneeAgentId: 'r1-tro-ly' },
            { id: 'note', parentId: null, assigneeAgentId: 'stray' },
          ];
        }
        return [];
      },
    },
    roles: {
      get: async (_companyId, projectId) => {
        const fixed = over.rolesFor?.[projectId];
        if (fixed !== undefined) return fixed as never;
        if (projectId === 'p-demo') {
          return {
            assistantAgentId: 'ag-assistant',
            executorAgentIds: ['ag-executor'],
            reviewerAgentId: 'ag-reviewer',
            integratorAgentId: 'ag-integrator',
          };
        }
        if (projectId === 'p-plain') throw new HttpError(404);
        return null;
      },
    },
    crew: {
      machines: async () => [
        {
          machineId: 'm1',
          latest: {
            superpowers: { pinned: '6.4.1-x', pinDir: PIN },
            checkouts: (over.checkouts ?? [...roles.map(path), `${HOME}/crew-agents/assistant`]).map((p) => ({
              path: p,
              head: null,
              clean: null,
            })),
          },
        },
      ],
      setupRuns: async () => [],
      roots: async () => [{ id: 'root-1' }],
    },
  };
  return { src, calls };
}

describe('loadProjectReadiness', () => {
  it('ghép REST và plugin: project vai trò, vai trò file, chưa có vai trò, đã lưu trữ', async () => {
    const { src, calls } = source();
    const res = await loadProjectReadiness(src, C);
    const by = Object.fromEntries(res.map((p) => [p.projectId, p]));
    expect(by['p-demo']?.state).toBe('ready');
    expect(by['p-demo']?.agents.map((a) => a.agentId).sort()).toEqual([
      'ag-assistant',
      'ag-executor',
      'ag-integrator',
      'ag-reviewer',
    ]);
    expect(by['p-r1']?.state).toBe('ready');
    expect(by['p-r1']?.agents.map((a) => a.agentId)).toEqual(['r1-tro-ly']);
    expect(by['p-plain']).toMatchObject({ state: 'untracked', failed: [] });
    expect(by['p-old']?.state).toBe('untracked');
    expect(calls).toContain(`instructionsFile ag-assistant AGENTS.md ${C}`);
    expect(calls).not.toContain('issues.list p-demo');
  });

  it('agent thiếu checkout trên máy làm project not_ready P2', async () => {
    const { src } = source({ checkouts: [path('assistant'), path('reviewer'), path('integrator')] });
    const demo = (await loadProjectReadiness(src, C)).find((p) => p.projectId === 'p-demo');
    expect(demo?.failed).toEqual([{ id: 'P2', detail: 'detail.P2', agentIds: ['ag-executor'] }]);
    expect(demo?.agents.find((a) => a.agentId === 'ag-executor')?.failed.map((f) => f.id)).toEqual(['A5']);
  });

  it('AGENTS.md 404 → A3; agent trong vai trò đã bị xóa → P2', async () => {
    const { src } = source({
      missingFile: ['ag-reviewer'],
      rolesFor: {
        'p-demo': {
          assistantAgentId: 'ag-assistant',
          executorAgentIds: ['ag-executor', 'gone'],
          reviewerAgentId: 'ag-reviewer',
          integratorAgentId: 'ag-integrator',
        },
      },
    });
    const demo = (await loadProjectReadiness(src, C)).find((p) => p.projectId === 'p-demo');
    expect(demo?.failed).toEqual([{ id: 'P2', detail: 'detail.P2', agentIds: ['gone', 'ag-reviewer'] }]);
    expect(demo?.agents.find((a) => a.agentId === 'ag-reviewer')?.failed.map((f) => f.id)).toEqual(['A3']);
  });

  it('data crew.machines lạ dạng thì coi như chưa có bản tin, không ném', async () => {
    const { src } = source();
    src.crew.machines = async () => ({ bad: true });
    const demo = (await loadProjectReadiness(src, C)).find((p) => p.projectId === 'p-demo');
    expect(demo?.state).toBe('not_ready');
    expect(demo?.agents[0]?.failed).toEqual([{ id: 'A5', detail: 'detail.noReport', resume: { none: true } }]);
  });
});

describe('A3 của Trợ Lý sau khi sửa vai trò', () => {
  const ASSISTANT = '11111111-1111-4111-8111-111111111111';
  const EXEC_1 = '22222222-2222-4222-8222-222222222222';
  const EXEC_2 = '33333333-3333-4333-8333-333333333333';
  const staleRun = {
    id: 'run-1',
    kind: 'add-project' as const,
    status: 'done' as const,
    updatedAt: '2026-10-10T01:00:00.000Z',
    steps: { agents: { refs: { agent_assistant: ASSISTANT, instructions_assistant: 'f'.repeat(64) } } },
  };

  async function assistantA3(content: string) {
    const { src } = source({
      rolesFor: {
        'p-demo': {
          assistantAgentId: ASSISTANT,
          executorAgentIds: [EXEC_1, EXEC_2],
          reviewerAgentId: 'ag-reviewer',
          integratorAgentId: 'ag-integrator',
        },
      },
    });
    const list = src.agents.list;
    src.agents.list = async (c) => [...(await list(c)), agent(ASSISTANT, 'env-assistant')];
    src.agents.instructionsFile = async (id) => ({ content: id === ASSISTANT ? content : 'x', contentHash: HASH });
    src.crew.setupRuns = async () => [staleRun as never];
    const demo = (await loadProjectReadiness(src, C)).find((p) => p.projectId === 'p-demo');
    return demo?.agents.find((a) => a.agentId === ASSISTANT)?.failed.map((f) => f.id) ?? [];
  }

  it('AGENTS.md đúng bản render theo executor hiện tại thì đạt dù hash trong setup run đã cũ', async () => {
    const content = renderInstructions('assistant', { agentId: ASSISTANT, executorIds: [EXEC_1, EXEC_2] });
    expect(await assistantA3(content)).not.toContain('A3');
  });

  it('AGENTS.md bị sửa tay lệch bản render và lệch hash thì vẫn báo A3', async () => {
    const content = `${renderInstructions('assistant', { agentId: ASSISTANT, executorIds: [EXEC_1, EXEC_2] })}\nsửa tay\n`;
    expect(await assistantA3(content)).toContain('A3');
  });
});

describe('project chưa có vai trò', () => {
  it('có lần thêm project dở trỏ tới project → not_ready P1', async () => {
    const { src } = source();
    src.crew.setupRuns = async () => [
      { id: 'run-p', kind: 'add-project', status: 'failed', projectId: 'p-plain', steps: {} } as never,
    ];
    const plain = (await loadProjectReadiness(src, C)).find((p) => p.projectId === 'p-plain');
    expect(plain).toMatchObject({ state: 'not_ready', failed: [{ id: 'P1' }] });
  });
});

describe('A3 của vai trò khác Trợ Lý', () => {
  const staleRun = {
    id: 'run-1',
    kind: 'add-project' as const,
    status: 'done' as const,
    updatedAt: '2026-10-10T01:00:00.000Z',
    steps: { agents: { refs: { agent_reviewer: 'ag-reviewer', instructions_reviewer: 'f'.repeat(64) } } },
  };

  async function reviewerA3(content: string) {
    const { src } = source();
    src.agents.instructionsFile = async (id) => ({ content: id === 'ag-reviewer' ? content : 'x', contentHash: HASH });
    src.crew.setupRuns = async () => [staleRun as never];
    const demo = (await loadProjectReadiness(src, C)).find((p) => p.projectId === 'p-demo');
    return demo?.agents.find((a) => a.agentId === 'ag-reviewer')?.failed.map((f) => f.id) ?? [];
  }

  it('AGENTS.md đúng bản render hiện tại của vai trò thì đạt dù hash trong setup run đã cũ', async () => {
    expect(await reviewerA3(renderInstructions('reviewer', { agentId: 'ag-reviewer' }))).not.toContain('A3');
  });

  it('AGENTS.md lệch bản render và lệch hash thì báo A3', async () => {
    expect(await reviewerA3('sửa tay')).toContain('A3');
  });
});

describe('ô runtime trong vai trò project', () => {
  const CODEX = 'ag-codex';
  const REV = 'ag-review-codex';
  const ASSISTANT = '11111111-1111-4111-8111-111111111111';
  const EXEC = '22222222-2222-4222-8222-222222222222';
  const CODEX_ID = '33333333-3333-4333-8333-333333333333';
  const REV_ID = '44444444-4444-4444-8444-444444444444';

  function withRuntimes(files: Record<string, string> = {}) {
    const { src } = source({
      rolesFor: {
        'p-demo': {
          assistantAgentId: 'ag-assistant',
          executorAgentIds: ['ag-executor'],
          reviewerAgentId: 'ag-reviewer',
          integratorAgentId: 'ag-integrator',
          codexExecutorAgentId: CODEX,
          opencodeExecutorAgentId: null,
          codexReviewerAgentId: REV,
        },
      },
    });
    const list = src.agents.list;
    const codexAgent = (id: string, slot: 'executor-codex' | 'reviewer-codex') => {
      const body = crewAgentCreateBody({ name: id, slot, model: 'gpt-6-sol', pinDir: PIN, projectKey: 'demo' });
      return agent(id, `env-${slot}`, { adapterType: body.adapterType, adapterConfig: body.adapterConfig });
    };
    src.agents.list = async (c) => [
      ...(await list(c)),
      codexAgent(CODEX, 'executor-codex'),
      codexAgent(REV, 'reviewer-codex'),
    ];
    const envs = src.environments.list;
    src.environments.list = async (c) => [
      ...(await envs(c)),
      env('env-executor-codex', path('executor-codex')),
      env('env-reviewer-codex', path('reviewer-codex')),
    ];
    const machines = src.crew.machines;
    src.crew.machines = async (c) => {
      const [m] = (await machines(c)) as { latest: { checkouts: { path: string }[] } }[];
      m?.latest.checkouts.push({ path: path('executor-codex') }, { path: path('reviewer-codex') });
      return [m];
    };
    src.agents.instructionsFile = async (id) => ({ content: files[id] ?? 'x', contentHash: HASH });
    return src;
  }

  it('agent Codex ở ô executor-codex và reviewer-codex được kiểm theo runtime Codex, có trong project', async () => {
    const demo = (await loadProjectReadiness(withRuntimes(), C)).find((p) => p.projectId === 'p-demo');
    const of = (id: string) => demo?.agents.find((a) => a.agentId === id);
    expect(of(CODEX)?.failed).toEqual([]);
    expect(of(REV)?.failed).toEqual([]);
    expect(demo?.state).toBe('ready');
  });

  it('AGENTS.md của agent ô runtime khớp template executor/reviewer thì không A3 khi hash cũ', async () => {
    const src = withRuntimes({ [REV]: renderInstructions('reviewer', { agentId: REV }) });
    src.crew.setupRuns = async () =>
      [
        {
          id: 'run-r',
          kind: 'add-agent',
          status: 'done',
          updatedAt: '2026-10-10T01:00:00.000Z',
          steps: { agent: { refs: { agent: REV } }, pin: { refs: { instructions: 'f'.repeat(64) } } },
        },
      ] as never;
    const demo = (await loadProjectReadiness(src, C)).find((p) => p.projectId === 'p-demo');
    expect(demo?.agents.find((a) => a.agentId === REV)?.failed.map((f) => f.id)).toEqual([]);
  });

  it('Trợ Lý: AGENTS.md phải có executor kèm runtime và reviewer Codex', () => {
    const roles = {
      assistantAgentId: ASSISTANT,
      executorAgentIds: [EXEC],
      reviewerAgentId: 'r',
      integratorAgentId: 'i',
      codexExecutorAgentId: CODEX_ID,
      codexReviewerAgentId: REV_ID,
    };
    const good = renderAssistantFor(roles, '');
    expect(matchesAssistantTemplate(good, roles)).toBe(true);
    const old = renderInstructions('assistant', { agentId: ASSISTANT, executorIds: [EXEC, CODEX_ID] });
    expect(matchesAssistantTemplate(old, roles)).toBe(false);
  });
});
