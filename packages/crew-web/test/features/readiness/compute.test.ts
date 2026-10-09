import { describe, expect, it } from 'vitest';
import {
  type AgentReadiness,
  type AgentReadinessInput,
  computeAgentReadiness,
  computeProjectReadiness,
  type ReadinessAgent,
  type ReadinessEnvironment,
  type ReadinessReport,
  type ReadinessSetupRun,
} from '@/features/readiness';
import en from '@/features/readiness/locales/en.json';
import vi from '@/features/readiness/locales/vi.json';

const HOME = '/Users/owner';
const PIN = `${HOME}/.crew/workflows/superpowers/6.4.1-5bf4e7801107`;
const CHECKOUT = `${HOME}/crew-agents/demo/executor-1`;
const AGENT = '11111111-1111-4111-8111-111111111111';
const ENV = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);

function agent(over: Partial<ReadinessAgent> = {}): ReadinessAgent {
  return {
    id: AGENT,
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
    defaultEnvironmentId: ENV,
    ...over,
  };
}

function environment(over: Partial<ReadinessEnvironment> = {}): ReadinessEnvironment {
  return {
    id: ENV,
    driver: 'ssh',
    status: 'active',
    config: { remoteWorkspacePath: CHECKOUT },
    metadata: { workspaceRealizationMode: 'in_place' },
    ...over,
  };
}

function report(over: Partial<ReadinessReport> = {}): ReadinessReport {
  return {
    superpowers: { pinned: '6.4.1-5bf4e7801107', pinDir: PIN },
    checkouts: [{ path: CHECKOUT, head: 'b'.repeat(40), clean: true }],
    ...over,
  };
}

function input(over: Partial<AgentReadinessInput> = {}): AgentReadinessInput {
  return {
    agent: agent(),
    environment: environment(),
    report: report(),
    roleOf: 'executor',
    setupRun: null,
    instructionsHash: HASH,
    ...over,
  };
}

const ids = (r: AgentReadiness) => r.failed.map((f) => f.id);

describe('computeAgentReadiness', () => {
  it('agent đủ mọi điều kiện thì ready', () => {
    expect(computeAgentReadiness(input())).toEqual({ agentId: AGENT, state: 'ready', failed: [] });
  });

  describe('A1 cấu hình adapter', () => {
    it('thiếu engine → A1, làm tiếp ở bước agent', () => {
      const a = agent();
      const { engine: _engine, ...rest } = a.adapterConfig;
      const r = computeAgentReadiness(input({ agent: { ...a, adapterConfig: rest } }));
      expect(r.state).toBe('not_ready');
      expect(r.failed).toEqual([
        { id: 'A1', detail: 'detail.A1', resume: { wizard: 'add-agent', step: 'agent', agentId: AGENT } },
      ]);
    });

    it.each([
      ['adapterType khác', { adapterType: 'codex_local' }],
      ['env có biến', { adapterConfig: { ...agent().adapterConfig, env: { X: '1' } } }],
      ['env thiếu', { adapterConfig: { ...agent().adapterConfig, env: undefined } }],
      ['model trống', { adapterConfig: { ...agent().adapterConfig, model: '' } }],
      ['heartbeat bật', { runtimeConfig: { heartbeat: { enabled: true, maxConcurrentRuns: 1 } } }],
      ['maxConcurrentRuns 2', { runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 2 } } }],
      ['runtimeConfig rỗng', { runtimeConfig: {} }],
    ] as [string, Partial<ReadinessAgent>][])('%s → A1', (_name, over) => {
      expect(ids(computeAgentReadiness(input({ agent: agent(over) })))).toEqual(['A1']);
    });
  });

  describe('A2 wrapper và bản ghim', () => {
    it('extraArgs trỏ pinDir khác report.superpowers.pinDir → A2, bước pin', () => {
      const r = computeAgentReadiness(
        input({
          report: report({ superpowers: { pinned: '7.0.0-x', pinDir: `${HOME}/.crew/workflows/superpowers/7.0.0-x` } }),
        }),
      );
      expect(r.failed).toEqual([
        { id: 'A2', detail: 'detail.A2', resume: { wizard: 'add-agent', step: 'pin', agentId: AGENT } },
      ]);
    });

    it('report thiếu pinDir: kiểm dạng extraArgs chứa /superpowers/<pinned>', () => {
      expect(
        computeAgentReadiness(input({ report: report({ superpowers: { pinned: '6.4.1-5bf4e7801107' } }) })).state,
      ).toBe('ready');
      expect(ids(computeAgentReadiness(input({ report: report({ superpowers: { pinned: '7.0.0-x' } }) })))).toEqual([
        'A2',
      ]);
    });

    it('command không phải wrapper Crew → A2', () => {
      const a = agent();
      const r = computeAgentReadiness(
        input({ agent: { ...a, adapterConfig: { ...a.adapterConfig, command: 'claude' } } }),
      );
      expect(ids(r)).toEqual(['A2']);
    });

    it('wrapper ở home khác home của bản ghim → A2', () => {
      const a = agent();
      const r = computeAgentReadiness(
        input({
          agent: { ...a, adapterConfig: { ...a.adapterConfig, command: '/Users/other/.crew/bin/crew-claude-run' } },
        }),
      );
      expect(ids(r)).toEqual(['A2']);
    });

    it('extraArgs sai thứ tự hoặc thừa cờ → A2', () => {
      const a = agent();
      for (const extraArgs of [
        ['--plugin-dir', PIN, '--setting-sources', 'project,local'],
        ['--setting-sources', 'project,local', '--plugin-dir', PIN, '--verbose'],
        'x',
      ]) {
        expect(
          ids(computeAgentReadiness(input({ agent: { ...a, adapterConfig: { ...a.adapterConfig, extraArgs } } }))),
        ).toEqual(['A2']);
      }
    });
  });

  describe('A3 AGENTS.md', () => {
    const run = (refs: Record<string, string>): ReadinessSetupRun => ({
      id: RUN,
      kind: 'add-project',
      status: 'done',
      steps: { agents: { status: 'done', refs } },
    });

    it('setup run có instructions_<vai> khác hash hiện tại → A3, bước pin', () => {
      const r = computeAgentReadiness(
        input({ setupRun: run({ agent_executor: AGENT, instructions_executor: 'c'.repeat(64) }) }),
      );
      expect(r.failed).toEqual([
        { id: 'A3', detail: 'detail.A3', resume: { wizard: 'add-agent', step: 'pin', agentId: AGENT, rewrite: true } },
      ]);
    });

    it('setup run có hash trùng hash hiện tại → đạt', () => {
      expect(
        computeAgentReadiness(input({ setupRun: run({ agent_executor: AGENT, instructions_executor: HASH }) })).state,
      ).toBe('ready');
    });

    it('setup run add-agent ghi refs agent/instructions → so cùng cách', () => {
      const addAgent: ReadinessSetupRun = {
        id: RUN,
        kind: 'add-agent',
        status: 'done',
        steps: {
          agent: { status: 'done', refs: { agent: AGENT } },
          pin: { status: 'done', refs: { instructions: 'd'.repeat(64) } },
        },
      };
      expect(ids(computeAgentReadiness(input({ setupRun: addAgent })))).toEqual(['A3']);
    });

    it('agent do app tạo (không setup run) mà file có → đạt', () => {
      expect(computeAgentReadiness(input({ setupRun: null })).state).toBe('ready');
    });

    it('không có file AGENTS.md → A3', () => {
      expect(ids(computeAgentReadiness(input({ instructionsHash: null })))).toEqual(['A3']);
    });
  });

  it('agent của vai trò file: báo mục hỏng nhưng không có lối "Làm tiếp" (wizard không sửa được vai trò file)', () => {
    const a = agent();
    const r = computeAgentReadiness(
      input({
        roleOf: 'file',
        instructionsHash: null,
        agent: { ...a, adapterConfig: { ...a.adapterConfig, engine: 'acp' } },
      }),
    );
    expect(ids(r)).toEqual(['A1', 'A3']);
    expect(r.failed.every((f) => 'none' in f.resume)).toBe(true);
  });

  describe('A4 environment', () => {
    it.each([
      ['archived', { status: 'archived' }],
      ['driver không phải ssh', { driver: 'local' }],
      ['không in_place', { metadata: {} }],
      ['remoteWorkspacePath khác checkout', { config: { remoteWorkspacePath: `${HOME}/crew-agents/demo/reviewer` } }],
      ['thiếu remoteWorkspacePath', { config: {} }],
    ] as [string, Partial<ReadinessEnvironment>][])('%s → A4, bước environment', (_name, over) => {
      const r = computeAgentReadiness(
        input({
          environment: environment(over),
          setupRun: {
            id: RUN,
            kind: 'add-project',
            status: 'done',
            steps: {
              checkouts: { status: 'done', refs: { checkout_executor: CHECKOUT } },
              agents: { status: 'done', refs: { agent_executor: AGENT } },
            },
          },
        }),
      );
      expect(r.failed[0]).toEqual({
        id: 'A4',
        detail: 'detail.A4',
        resume: { wizard: 'add-agent', step: 'environment', agentId: AGENT },
      });
    });

    it('agent không có defaultEnvironmentId hay environment không tìm thấy → A4', () => {
      expect(ids(computeAgentReadiness(input({ environment: null })))).toContain('A4');
    });
  });

  describe('A5 checkout trên máy', () => {
    it('report.checkouts không có path → A5, bước workspace', () => {
      const r = computeAgentReadiness(input({ report: report({ checkouts: [] }) }));
      expect(r.failed).toEqual([
        { id: 'A5', detail: 'detail.A5', resume: { wizard: 'add-agent', step: 'workspace', agentId: AGENT } },
      ]);
    });

    it('report null → A5 với resume none và chi tiết "Chưa có bản tin máy"', () => {
      const r = computeAgentReadiness(input({ report: null }));
      expect(r.state).toBe('not_ready');
      expect(r.failed).toEqual([{ id: 'A5', detail: 'detail.noReport', resume: { none: true } }]);
      expect(vi.detail.noReport).toBe('Chưa có bản tin máy');
    });

    it('report bản cũ thiếu key checkouts → A5 "Không rõ", không ném', () => {
      const { checkouts: _c, ...old } = report();
      const r = computeAgentReadiness(input({ report: old }));
      expect(r.failed).toEqual([{ id: 'A5', detail: 'detail.checkoutsUnknown', resume: { none: true } }]);
      expect(vi.detail.checkoutsUnknown).toContain('Không rõ');
    });

    it('report thiếu superpowers vẫn không ném', () => {
      const r = computeAgentReadiness(input({ report: { checkouts: report().checkouts } as ReadinessReport }));
      expect(ids(r)).toEqual(['A2']);
    });
  });

  it('A6: không giữ vai trò → A6, bước role', () => {
    expect(computeAgentReadiness(input({ roleOf: null })).failed).toEqual([
      { id: 'A6', detail: 'detail.A6', resume: { wizard: 'add-agent', step: 'role', agentId: AGENT } },
    ]);
  });

  describe('A7 trạng thái agent', () => {
    it('terminated → state terminated', () => {
      expect(computeAgentReadiness(input({ agent: agent({ status: 'terminated' }) }))).toEqual({
        agentId: AGENT,
        state: 'terminated',
        failed: [{ id: 'A7', detail: 'detail.A7', resume: { none: true } }],
      });
    });

    it('paused và đủ điều kiện → state paused, failed rỗng', () => {
      expect(computeAgentReadiness(input({ agent: agent({ status: 'paused' }) }))).toEqual({
        agentId: AGENT,
        state: 'paused',
        failed: [],
      });
    });

    it('paused vì wizard dừng giữa chừng (thiếu checkout) → not_ready A5', () => {
      const r = computeAgentReadiness(input({ agent: agent({ status: 'paused' }), report: report({ checkouts: [] }) }));
      expect(r.state).toBe('not_ready');
      expect(ids(r)).toEqual(['A5']);
    });
  });

  it('agent thuộc setup run add-project chưa xong → làm tiếp chạy lại đúng run đó', () => {
    const r = computeAgentReadiness(
      input({
        roleOf: null,
        setupRun: {
          id: RUN,
          kind: 'add-project',
          status: 'failed',
          steps: { agents: { status: 'done', refs: { agent_executor: AGENT } } },
        },
      }),
    );
    expect(r.failed).toEqual([{ id: 'A6', detail: 'detail.A6', resume: { wizard: 'add-project', setupRunId: RUN } }]);
  });

  it('nhiều mục hỏng thì liệt kê đủ theo thứ tự A1..A6', () => {
    const r = computeAgentReadiness(
      input({ agent: agent({ adapterType: 'x' }), environment: null, roleOf: null, instructionsHash: null }),
    );
    expect(ids(r)).toEqual(['A1', 'A3', 'A4', 'A6']);
  });
});

describe('computeProjectReadiness', () => {
  const ready = (agentId: string): AgentReadiness => ({ agentId, state: 'ready', failed: [] });
  const roles = {
    assistantAgentId: 'a1',
    executorAgentIds: ['e1', 'e2'],
    reviewerAgentId: 'r1',
    integratorAgentId: 'i1',
  };
  const project = { id: 'p1', archivedAt: null };

  it('có dòng vai trò và mọi agent ready → ready', () => {
    const r = computeProjectReadiness({
      project,
      roles,
      fileRoles: false,
      agents: ['a1', 'e1', 'e2', 'r1', 'i1'].map(ready),
    });
    expect(r.state).toBe('ready');
    expect(r.failed).toEqual([]);
    expect(r.agents.map((a) => a.agentId)).toEqual(['a1', 'e1', 'e2', 'r1', 'i1']);
  });

  it('agent paused vẫn tính là sẵn sàng', () => {
    const agents = ['a1', 'e1', 'e2', 'r1', 'i1'].map(ready);
    agents[1] = { agentId: 'e1', state: 'paused', failed: [] };
    expect(computeProjectReadiness({ project, roles, fileRoles: false, agents }).state).toBe('ready');
  });

  it('một agent trong vai trò chưa sẵn sàng hoặc thiếu → not_ready P2 kèm danh sách', () => {
    const agents = ['a1', 'e1', 'r1', 'i1'].map(ready);
    agents[0] = {
      agentId: 'a1',
      state: 'not_ready',
      failed: [{ id: 'A5', detail: 'detail.A5', resume: { none: true } }],
    };
    const r = computeProjectReadiness({ project, roles, fileRoles: false, agents });
    expect(r.state).toBe('not_ready');
    expect(r.failed).toEqual([{ id: 'P2', detail: 'detail.P2', agentIds: ['a1', 'e2'] }]);
  });

  it('vai trò file (roles null) mà agent đủ → ready', () => {
    const r = computeProjectReadiness({ project, roles: null, fileRoles: true, agents: [ready('x1'), ready('x2')] });
    expect(r).toEqual({ projectId: 'p1', state: 'ready', failed: [], agents: [ready('x1'), ready('x2')] });
  });

  it('đang thêm bằng wizard (lần thêm project dở) mà chưa có vai trò → not_ready P1', () => {
    const r = computeProjectReadiness({ project, roles: null, fileRoles: false, settingUp: true, agents: [] });
    expect(r.state).toBe('not_ready');
    expect(r.failed).toEqual([{ id: 'P1', detail: 'detail.P1' }]);
  });

  it('không có vai trò, không có yêu cầu Crew, không đang thêm → untracked (project vai trò file chưa có việc)', () => {
    const r = computeProjectReadiness({ project, roles: null, fileRoles: false, agents: [] });
    expect(r.state).toBe('untracked');
    expect(r.failed).toEqual([]);
  });

  it('project đã lưu trữ → untracked', () => {
    const r = computeProjectReadiness({
      project: { id: 'p1', archivedAt: '2026-10-01T00:00:00.000Z' },
      roles: null,
      fileRoles: false,
      agents: [],
    });
    expect(r.state).toBe('untracked');
    expect(r.failed).toEqual([]);
  });
});

describe('locale readiness', () => {
  it('vi và en có cùng khóa, đủ mã A1–A7, P1, P2', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(en).sort()).toEqual(keys(vi).sort());
    for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'P1', 'P2']) {
      expect(keys(vi)).toContain(`detail.${id}`);
    }
  });
});
