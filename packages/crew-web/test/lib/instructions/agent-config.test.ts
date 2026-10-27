import { createAgentSchema } from '@paperclipai/shared';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_GRANTS,
  CREW_AGENT_PERMISSIONS,
  CREW_ROLE_SLOTS,
  CREW_RUNTIME_CONFIG,
  crewAgentCreateBody,
  crewCodexHome,
  crewExtraArgs,
  crewModelsOf,
  crewWrapperCommand,
  defaultModelOf,
  isCrewModel,
  isUnmanagedCodexHome,
  RUNTIME_SLOT_KEYS,
  roleOfSlot,
  runtimeOfSlot,
  slotModels,
  WRAPPER_RE,
  wrapperReOf,
} from '@/lib/instructions';
import { SETTINGS } from './__fixtures__/model-settings';

const PIN = '/Users/owner/.crew/workflows/superpowers/6.4.1-5bf4e7801107';
const ENV = '55555555-5555-4555-8555-555555555555';

describe('cấu hình agent Crew', () => {
  it('wrapper là đường tuyệt đối <home>/.crew/bin/crew-claude-run suy từ bản ghim', () => {
    expect(crewWrapperCommand(PIN)).toBe('/Users/owner/.crew/bin/crew-claude-run');
  });

  it('extraArgs ghim Superpowers đúng thứ tự như merge-agent-config.mjs', () => {
    expect(crewExtraArgs(PIN)).toEqual(['--setting-sources', 'project,local', '--plugin-dir', PIN]);
  });

  it('từ chối thư mục không phải bản ghim Superpowers', () => {
    for (const bad of [
      'relative/.crew/workflows/superpowers/1',
      '/Users/owner/.crew/workflows/superpowers/..',
      '/Users/owner/.crew/workflows/superpowers/1/extra',
      '/Users/owner/.crew/workflows/bmad/6.13.0',
      '/Users/owner/plugins/superpowers',
      // Home có `..` hoặc ký tự lạ: command trỏ ra ngoài home.
      '/Users/../etc/.crew/workflows/superpowers/1',
      '/Users/owner/../../tmp/.crew/workflows/superpowers/1',
      '/Users/./owner/.crew/workflows/superpowers/1',
      '/Users/a b$(x)/.crew/workflows/superpowers/1',
      '/Users/owner\n/.crew/workflows/superpowers/1',
      '/Users/owner/.crew/workflows/superpowers/1;rm',
    ]) {
      expect(() => crewExtraArgs(bad), bad).toThrow(/bản ghim/);
      expect(() => crewWrapperCommand(bad), bad).toThrow(/bản ghim/);
    }
  });

  it('nhận home và bản ghim dùng ký tự thường', () => {
    expect(crewWrapperCommand('/Users/owner.name-2/.crew/workflows/superpowers/6.4.1_x+y')).toBe(
      '/Users/owner.name-2/.crew/bin/crew-claude-run',
    );
  });

  it('body tạo agent có đúng các key Crew, không key lạ', () => {
    const body = crewAgentCreateBody({
      settings: SETTINGS,
      name: 'demo-executor',
      role: 'executor',
      model: 'claude-sonnet-5-5',
      pinDir: PIN,
      environmentId: ENV,
    });
    expect(body).toEqual({
      name: 'demo-executor',
      adapterType: 'claude_local',
      adapterConfig: {
        engine: 'cli',
        command: '/Users/owner/.crew/bin/crew-claude-run',
        extraArgs: ['--setting-sources', 'project,local', '--plugin-dir', PIN],
        model: 'claude-sonnet-5-5',
        env: {},
      },
      runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
      defaultEnvironmentId: ENV,
      permissions: { canCreateAgents: false, canCreateSkills: false },
    });
  });

  it('không có environment thì không gửi defaultEnvironmentId', () => {
    const body = crewAgentCreateBody({
      settings: SETTINGS,
      name: 'a',
      role: 'assistant',
      model: 'claude-opus-5-5',
      pinDir: PIN,
    });
    expect(Object.keys(body).sort()).toEqual(['adapterConfig', 'adapterType', 'name', 'permissions', 'runtimeConfig']);
  });

  it('body qua được createAgentSchema của server mà không đổi giá trị Crew', () => {
    const body = crewAgentCreateBody({
      settings: SETTINGS,
      name: 'a',
      role: 'reviewer',
      model: 'claude-sonnet-5-5',
      pinDir: PIN,
      environmentId: ENV,
    });
    const parsed = createAgentSchema.parse(body);
    expect(parsed.adapterConfig).toEqual(body.adapterConfig);
    expect(parsed.runtimeConfig).toEqual({ heartbeat: { enabled: false, maxConcurrentRuns: 1 } });
    expect(parsed.permissions).toEqual({ canCreateAgents: false, canCreateSkills: false });
    expect(parsed.defaultEnvironmentId).toBe(ENV);
    // Vai trò Crew không gửi lên: trường role của Paperclip là enum riêng, để mặc định.
    expect(parsed.role).toBe('general');
  });

  it('model phải thuộc catalog của bảng cài đặt model', () => {
    expect(() =>
      crewAgentCreateBody({ settings: SETTINGS, name: 'a', role: 'executor', model: 'claude-haiku-4', pinDir: PIN }),
    ).toThrow('Model claude-haiku-4 không nằm trong danh sách model Crew');
    expect(() =>
      crewAgentCreateBody({ settings: SETTINGS, name: 'a', role: 'executor', model: '', pinDir: PIN }),
    ).toThrow();
  });

  it('tên agent không được trống', () => {
    expect(() =>
      crewAgentCreateBody({
        settings: SETTINGS,
        name: '  ',
        role: 'executor',
        model: 'claude-sonnet-5-5',
        pinDir: PIN,
      }),
    ).toThrow('Tên agent không được trống');
  });

  it('hằng số cùng giá trị với app và server', () => {
    expect(CREW_AGENT_PERMISSIONS).toEqual({ canCreateAgents: false, canCreateSkills: false });
    expect(CREW_RUNTIME_CONFIG).toEqual({ heartbeat: { enabled: false, maxConcurrentRuns: 1 } });
    expect(ASSISTANT_GRANTS).toEqual(['tasks:assign']);
  });

  it('body là bản sao: sửa body không đổi hằng số dùng chung', () => {
    const body = crewAgentCreateBody({
      settings: SETTINGS,
      name: 'a',
      role: 'executor',
      model: 'claude-sonnet-5-5',
      pinDir: PIN,
    });
    body.runtimeConfig.heartbeat.enabled = true;
    body.permissions.canCreateAgents = true;
    expect(CREW_RUNTIME_CONFIG.heartbeat.enabled).toBe(false);
    expect(CREW_AGENT_PERMISSIONS.canCreateAgents).toBe(false);
  });

  it('ô vai trò executor-2 dùng template executor', () => {
    expect(roleOfSlot('executor-2')).toBe('executor');
    expect(roleOfSlot('assistant')).toBe('assistant');
  });
});

describe('ô runtime Codex/OpenCode', () => {
  it('ô mới map về template và runtime', () => {
    expect(CREW_ROLE_SLOTS).toEqual([
      'assistant',
      'executor',
      'executor-2',
      'reviewer',
      'integrator',
      'executor-codex',
      'executor-opencode',
      'reviewer-codex',
    ]);
    expect(roleOfSlot('executor-codex')).toBe('executor');
    expect(roleOfSlot('executor-opencode')).toBe('executor');
    expect(roleOfSlot('reviewer-codex')).toBe('reviewer');
    expect(runtimeOfSlot('executor-codex')).toBe('codex_local');
    expect(runtimeOfSlot('executor-opencode')).toBe('opencode_local');
    expect(runtimeOfSlot('reviewer-codex')).toBe('codex_local');
    for (const slot of ['assistant', 'executor', 'executor-2', 'reviewer', 'integrator'] as const) {
      expect(runtimeOfSlot(slot)).toBe('claude_local');
    }
    expect(RUNTIME_SLOT_KEYS).toEqual({
      'executor-codex': 'codexExecutorAgentId',
      'executor-opencode': 'opencodeExecutorAgentId',
      'reviewer-codex': 'codexReviewerAgentId',
    });
  });

  it('wrapper theo runtime, cùng home với bản ghim', () => {
    expect(crewWrapperCommand(PIN, 'codex_local')).toBe('/Users/owner/.crew/bin/crew-codex-run');
    expect(crewWrapperCommand(PIN, 'opencode_local')).toBe('/Users/owner/.crew/bin/crew-opencode-run');
    expect(wrapperReOf('codex_local').test('/Users/owner/.crew/bin/crew-codex-run')).toBe(true);
    expect(wrapperReOf('codex_local').test('/Users/owner/.crew/bin/crew-claude-run')).toBe(false);
    expect(wrapperReOf('claude_local')).toBe(WRAPPER_RE);
  });

  it('model theo runtime của ô; reviewer Codex chỉ có model cố định của vai', () => {
    expect(crewModelsOf('codex_local', SETTINGS)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    expect(slotModels('reviewer-codex', SETTINGS)).toEqual(['gpt-6-sol']);
    expect(slotModels('executor-codex', SETTINGS)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    expect(slotModels('executor', SETTINGS)).toEqual(crewModelsOf('claude_local', SETTINGS));
    expect(isCrewModel('gpt-6-sol', SETTINGS)).toBe(false);
    expect(isCrewModel('gpt-6-sol', SETTINGS, 'codex_local')).toBe(true);
    expect(isCrewModel('claude-opus-5-5', SETTINGS, 'opencode_local')).toBe(false);
    expect(defaultModelOf('executor-2', SETTINGS)).toBe('claude-sonnet-5-5');
  });

  it('CODEX_HOME của agent: đường tuyệt đối trên server, ngoài cây companies/<id>', () => {
    expect(crewCodexHome('demo', 'executor-codex')).toBe(
      '/paperclip/instances/default/crew-codex-home/demo/executor-codex',
    );
    expect(isUnmanagedCodexHome(crewCodexHome('demo', 'reviewer-codex'))).toBe(true);
    for (const bad of [
      '',
      'relative/home',
      '/paperclip/instances/default/companies/abc/codex-home',
      '/x/companies/abc',
      '/x/../companies/abc',
    ]) {
      expect(isUnmanagedCodexHome(bad), bad).toBe(false);
    }
    expect(() => crewCodexHome('Bad Key', 'executor-codex')).toThrow();
  });

  it('body tạo agent Codex: wrapper codex, effort, bỏ sandbox, CODEX_HOME, không OPENAI_API_KEY', () => {
    const body = crewAgentCreateBody({
      settings: SETTINGS,
      name: 'demo-executor-codex',
      slot: 'executor-codex',
      model: 'gpt-6-luna',
      pinDir: PIN,
      projectKey: 'demo',
    });
    expect(body).toEqual({
      name: 'demo-executor-codex',
      adapterType: 'codex_local',
      adapterConfig: {
        engine: 'cli',
        command: '/Users/owner/.crew/bin/crew-codex-run',
        extraArgs: [],
        model: 'gpt-6-luna',
        modelReasoningEffort: 'medium',
        dangerouslyBypassApprovalsAndSandbox: true,
        env: { CODEX_HOME: '/paperclip/instances/default/crew-codex-home/demo/executor-codex' },
      },
      runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
      permissions: { canCreateAgents: false, canCreateSkills: false },
    });
    expect(createAgentSchema.parse(body).adapterConfig).toEqual(body.adapterConfig);
  });

  it('reviewer Codex chạy gpt-6-sol, effort high', () => {
    const body = crewAgentCreateBody({
      settings: SETTINGS,
      name: 'r',
      slot: 'reviewer-codex',
      model: 'gpt-6-sol',
      pinDir: PIN,
      projectKey: 'demo',
    });
    expect(body.adapterConfig).toMatchObject({ model: 'gpt-6-sol', modelReasoningEffort: 'high' });
    expect(() =>
      crewAgentCreateBody({
        settings: SETTINGS,
        name: 'r',
        slot: 'reviewer-codex',
        model: 'gpt-6-luna',
        pinDir: PIN,
        projectKey: 'demo',
      }),
    ).toThrow('Model gpt-6-luna không nằm trong danh sách model Crew');
  });

  it('body tạo agent OpenCode: wrapper opencode, model opencode-go, env rỗng, không effort', () => {
    const body = crewAgentCreateBody({
      settings: SETTINGS,
      name: 'o',
      slot: 'executor-opencode',
      model: 'opencode-go/glm-5.3',
      pinDir: PIN,
      projectKey: 'demo',
      environmentId: ENV,
    });
    expect(body).toEqual({
      name: 'o',
      adapterType: 'opencode_local',
      adapterConfig: {
        command: '/Users/owner/.crew/bin/crew-opencode-run',
        extraArgs: [],
        model: 'opencode-go/glm-5.3',
        env: {},
      },
      runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
      defaultEnvironmentId: ENV,
      permissions: { canCreateAgents: false, canCreateSkills: false },
    });
    expect(createAgentSchema.parse(body).adapterConfig).toEqual(body.adapterConfig);
    expect(() =>
      crewAgentCreateBody({
        settings: SETTINGS,
        name: 'o',
        slot: 'executor-opencode',
        model: 'claude-sonnet-5-5',
        pinDir: PIN,
        projectKey: 'demo',
      }),
    ).toThrow('Model claude-sonnet-5-5 không nằm trong danh sách model Crew');
  });

  it('ô Claude gọi theo slot cho cùng body như theo role', () => {
    expect(
      crewAgentCreateBody({
        settings: SETTINGS,
        name: 'a',
        slot: 'executor-2',
        model: 'claude-sonnet-5-5',
        pinDir: PIN,
      }),
    ).toEqual(
      crewAgentCreateBody({ settings: SETTINGS, name: 'a', role: 'executor', model: 'claude-sonnet-5-5', pinDir: PIN }),
    );
  });
});
