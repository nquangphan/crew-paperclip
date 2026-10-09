import { createAgentSchema } from '@paperclipai/shared';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_GRANTS,
  CREW_AGENT_PERMISSIONS,
  CREW_MODELS,
  CREW_RUNTIME_CONFIG,
  crewAgentCreateBody,
  crewExtraArgs,
  crewWrapperCommand,
  ROLE_MODELS,
  roleOfSlot,
} from '@/lib/instructions';

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
      name: 'demo-executor',
      role: 'executor',
      model: 'claude-sonnet-5',
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
        model: 'claude-sonnet-5',
        env: {},
      },
      runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
      defaultEnvironmentId: ENV,
      permissions: { canCreateAgents: false, canCreateSkills: false },
    });
  });

  it('không có environment thì không gửi defaultEnvironmentId', () => {
    const body = crewAgentCreateBody({ name: 'a', role: 'assistant', model: 'claude-opus-5', pinDir: PIN });
    expect(Object.keys(body).sort()).toEqual(['adapterConfig', 'adapterType', 'name', 'permissions', 'runtimeConfig']);
  });

  it('body qua được createAgentSchema của server mà không đổi giá trị Crew', () => {
    const body = crewAgentCreateBody({
      name: 'a',
      role: 'reviewer',
      model: 'claude-sonnet-5',
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

  it('model phải thuộc CREW_MODELS', () => {
    expect(() => crewAgentCreateBody({ name: 'a', role: 'executor', model: 'claude-haiku-4', pinDir: PIN })).toThrow(
      'Model claude-haiku-4 không nằm trong danh sách model Crew',
    );
    expect(() => crewAgentCreateBody({ name: 'a', role: 'executor', model: '', pinDir: PIN })).toThrow();
  });

  it('tên agent không được trống', () => {
    expect(() => crewAgentCreateBody({ name: '  ', role: 'executor', model: 'claude-sonnet-5', pinDir: PIN })).toThrow(
      'Tên agent không được trống',
    );
  });

  it('hằng số cùng giá trị với app và server', () => {
    expect([...CREW_MODELS].sort()).toEqual(['claude-opus-5', 'claude-sonnet-5']);
    expect(ROLE_MODELS).toEqual({
      assistant: 'claude-opus-5',
      executor: 'claude-sonnet-5',
      reviewer: 'claude-sonnet-5',
      integrator: 'claude-sonnet-5',
    });
    for (const model of Object.values(ROLE_MODELS)) expect(CREW_MODELS).toContain(model);
    expect(CREW_AGENT_PERMISSIONS).toEqual({ canCreateAgents: false, canCreateSkills: false });
    expect(CREW_RUNTIME_CONFIG).toEqual({ heartbeat: { enabled: false, maxConcurrentRuns: 1 } });
    expect(ASSISTANT_GRANTS).toEqual(['tasks:assign']);
  });

  it('body là bản sao: sửa body không đổi hằng số dùng chung', () => {
    const body = crewAgentCreateBody({ name: 'a', role: 'executor', model: 'claude-sonnet-5', pinDir: PIN });
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
