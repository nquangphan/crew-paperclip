import { describe, expect, it } from 'vitest';
import { exclusiveEnvironments } from '@/features/wizards/remove/exclusive-environments';

const HOME = '/Users/owner';
const env = (id: string, name: string, path: string, status = 'active') => ({
  id,
  name,
  status,
  driver: 'ssh',
  config: { remoteWorkspacePath: path },
  metadata: { workspaceRealizationMode: 'in_place' },
});
const roleEnv = (id: string, key: string, slot: string, status = 'active') =>
  env(id, `${key}-${slot}`, `${HOME}/crew-agents/${key}/${slot}`, status);
const TEMPLATE = env('env-template', 'mac-mini', `${HOME}/crew-agents/old/assistant`);
const agent = (id: string, environmentId: string | null, status = 'paused') => ({
  id,
  name: id,
  status,
  defaultEnvironmentId: environmentId,
});

describe('exclusiveEnvironments', () => {
  it('environment chỉ agent trong phạm vi dùng → archive', () => {
    const out = exclusiveEnvironments({
      environments: [roleEnv('e1', 'demo', 'assistant'), roleEnv('e2', 'demo', 'executor')],
      agents: [agent('a1', 'e1'), agent('a2', 'e2')],
      scope: ['a1', 'a2'],
      projectKey: 'demo',
    });
    expect(out).toEqual([
      { agentId: 'a1', environmentId: 'e1' },
      { agentId: 'a2', environmentId: 'e2' },
    ]);
  });

  it('environment mẫu (giữ secret SSH) không bao giờ bị chạm, kể cả khi agent trong phạm vi trỏ tới', () => {
    expect(
      exclusiveEnvironments({
        environments: [TEMPLATE],
        agents: [agent('a1', 'env-template')],
        scope: ['a1'],
        projectKey: null,
      }),
    ).toEqual([]);
  });

  it('environment có agent ngoài phạm vi (chưa terminated) dùng → giữ; agent ngoài đã terminated thì không tính', () => {
    const environments = [roleEnv('e1', 'demo', 'executor')];
    expect(
      exclusiveEnvironments({
        environments,
        agents: [agent('a1', 'e1'), agent('other', 'e1', 'idle')],
        scope: ['a1'],
        projectKey: 'demo',
      }),
    ).toEqual([]);
    expect(
      exclusiveEnvironments({
        environments,
        agents: [agent('a1', 'e1'), agent('other', 'e1', 'terminated')],
        scope: ['a1'],
        projectKey: 'demo',
      }),
    ).toEqual([{ agentId: 'a1', environmentId: 'e1' }]);
  });

  it('environment đã archived → bỏ qua', () => {
    expect(
      exclusiveEnvironments({
        environments: [roleEnv('e1', 'demo', 'executor', 'archived')],
        agents: [agent('a1', 'e1')],
        scope: ['a1'],
        projectKey: 'demo',
      }),
    ).toEqual([]);
  });

  it('environment checkout của project khác → giữ; không có projectKey thì nhận checkout của mọi khóa', () => {
    const environments = [roleEnv('e1', 'other', 'executor')];
    const agents = [agent('a1', 'e1')];
    expect(exclusiveEnvironments({ environments, agents, scope: ['a1'], projectKey: 'demo' })).toEqual([]);
    expect(exclusiveEnvironments({ environments, agents, scope: ['a1'], projectKey: null })).toEqual([
      { agentId: 'a1', environmentId: 'e1' },
    ]);
  });

  it('tên không khớp đường checkout → giữ; hai agent cùng environment trong phạm vi → archive một lần', () => {
    expect(
      exclusiveEnvironments({
        environments: [env('e1', 'tay', `${HOME}/crew-agents/demo/executor`)],
        agents: [agent('a1', 'e1')],
        scope: ['a1'],
        projectKey: 'demo',
      }),
    ).toEqual([]);
    expect(
      exclusiveEnvironments({
        environments: [roleEnv('e1', 'demo', 'executor')],
        agents: [agent('a1', 'e1'), agent('a2', 'e1')],
        scope: ['a1', 'a2'],
        projectKey: 'demo',
      }),
    ).toEqual([{ agentId: 'a1', environmentId: 'e1' }]);
  });

  it('environment của ô runtime (executor-codex, executor-opencode, reviewer-codex) → archive', () => {
    const slots = ['executor-codex', 'executor-opencode', 'reviewer-codex'];
    const out = exclusiveEnvironments({
      environments: slots.map((slot, i) => roleEnv(`e${i}`, 'demo', slot)),
      agents: slots.map((_, i) => agent(`a${i}`, `e${i}`)),
      scope: ['a0', 'a1', 'a2'],
      projectKey: 'demo',
    });
    expect(out.map((o) => o.environmentId)).toEqual(['e0', 'e1', 'e2']);
  });
});
