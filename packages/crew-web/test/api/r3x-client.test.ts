// @vitest-environment jsdom
import { globSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import type { ForceDoneResult, JobPayload, JobResult, SetupRun, SetupStepId } from '@/api/crew/types';
import { ENDPOINTS } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';

afterEach(() => vi.restoreAllMocks());

const mockFetch = (payload: unknown = {}) => {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(payload), { status: 200 }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

/** Lời gọi đầu: [method, url (cả query), body đã parse]. */
const first = (m: ReturnType<typeof mockFetch>) => {
  const [url, init] = m.mock.calls[0];
  return [init?.method, String(url), init?.body ? JSON.parse(String(init.body)) : undefined] as const;
};

describe('bảng ENDPOINTS R3X: mã nút BA', () => {
  const rows: [string, string[], string, string][] = [
    ['issues.activity', ['S6.18'], 'GET', '/api/issues/:id/activity'],
    ['crew.forceDone', ['S6.17'], 'POST', '/api/plugins/crew.core/api/issues/:issueId/force-done'],
    ['skills.update', ['S14.5'], 'PATCH', '/api/companies/:companyId/skills/:skillId'],
    ['skills.readFile', ['S14.5'], 'GET', '/api/companies/:companyId/skills/:skillId/files'],
    ['skills.writeFile', ['S14.5'], 'PATCH', '/api/companies/:companyId/skills/:skillId/files'],
    ['skills.deleteFile', ['S14.5'], 'DELETE', '/api/companies/:companyId/skills/:skillId/files'],
    ['skills.updateStatus', ['S14.6'], 'GET', '/api/companies/:companyId/skills/:skillId/update-status'],
    ['skills.installUpdate', ['S14.6'], 'POST', '/api/companies/:companyId/skills/:skillId/install-update'],
    ['skills.forkPrecheck', ['S14.6'], 'GET', '/api/companies/:companyId/skills/:skillId/fork-precheck'],
    ['skills.fork', ['S14.6'], 'POST', '/api/companies/:companyId/skills/:skillId/fork'],
    ['skills.remove', ['S14.7'], 'DELETE', '/api/companies/:companyId/skills/:skillId'],
    ['skillSources.get', ['S14.7'], 'GET', '/api/companies/:companyId/skill-sources/:sourceId'],
    ['skillSources.select', ['S14.7'], 'PATCH', '/api/companies/:companyId/skill-sources/:sourceId'],
    ['environments.update', ['S8.7', 'S11.9'], 'PATCH', '/api/environments/:id'],
  ];
  it.each(rows)('%s', (key, ids, method, path) => {
    expect(ENDPOINTS[key as keyof typeof ENDPOINTS]).toMatchObject({ ids, method, path });
  });

  it('projects.update thêm mã S8.7 (gỡ project = PATCH archivedAt)', () => {
    expect(ENDPOINTS['projects.update'].ids).toEqual(expect.arrayContaining(['S8.6', 'S8.7']));
  });

  it('không có lời gọi DELETE tới environments, projects/:id, agents/:id', () => {
    for (const [key, def] of Object.entries(ENDPOINTS)) {
      if (def.method !== 'DELETE') continue;
      expect(def.path, key).not.toMatch(/\/environments(\/|$)/);
      expect(def.path, key).not.toMatch(/\/projects\/:\w+$/);
      expect(def.path, key).not.toMatch(/\/agents\/:\w+$/);
    }
    const src = globSync('src/api/**/*.ts')
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    expect(src).not.toMatch(/DELETE[^\n]*\/(environments|agents)/);
  });
});

describe('client', () => {
  it('issues.activity', async () => {
    const m = mockFetch([]);
    await api.issues.activity('TPS 1');
    expect(first(m).slice(0, 2)).toEqual(['GET', '/api/issues/TPS%201/activity']);
  });

  it('crew.forceDone gửi {companyId, reason}', async () => {
    const result: ForceDoneResult = { issue: { id: 'i1' } as never, violations: ['docs_missing'], warnings: [] };
    const m = mockFetch(result);
    const res = await api.crew.forceDone('i1', { companyId: 'c1', reason: 'lý do đủ dài' });
    expect(first(m)).toEqual([
      'POST',
      '/api/plugins/crew.core/api/issues/i1/force-done',
      { companyId: 'c1', reason: 'lý do đủ dài' },
    ]);
    expect(res.violations).toEqual(['docs_missing']);
  });

  it('skills.update', async () => {
    const m = mockFetch();
    await api.skills.update('c1', 's1', { description: 'x', categories: ['a'] });
    expect(first(m)).toEqual(['PATCH', '/api/companies/c1/skills/s1', { description: 'x', categories: ['a'] }]);
  });

  it('skills.readFile mặc định SKILL.md, truyền path khi có', async () => {
    const m = mockFetch();
    await api.skills.readFile('c1', 's1');
    expect(first(m).slice(0, 2)).toEqual(['GET', '/api/companies/c1/skills/s1/files?path=SKILL.md']);
    const m2 = mockFetch();
    await api.skills.readFile('c1', 's1', 'refs/a b.md');
    expect(first(m2)[1]).toBe('/api/companies/c1/skills/s1/files?path=refs%2Fa+b.md');
  });

  it('skills.writeFile / deleteFile', async () => {
    const m = mockFetch();
    await api.skills.writeFile('c1', 's1', { path: 'SKILL.md', content: '# x' });
    expect(first(m)).toEqual(['PATCH', '/api/companies/c1/skills/s1/files', { path: 'SKILL.md', content: '# x' }]);
    const m2 = mockFetch();
    await api.skills.deleteFile('c1', 's1', { path: 'a.md', target: 'file' });
    expect(first(m2)).toEqual(['DELETE', '/api/companies/c1/skills/s1/files', { path: 'a.md', target: 'file' }]);
  });

  it('skills.updateStatus / installUpdate / forkPrecheck / fork / remove', async () => {
    let m = mockFetch();
    await api.skills.updateStatus('c1', 's1');
    expect(first(m).slice(0, 2)).toEqual(['GET', '/api/companies/c1/skills/s1/update-status']);
    m = mockFetch();
    await api.skills.installUpdate('c1', 's1', { force: true });
    expect(first(m)).toEqual(['POST', '/api/companies/c1/skills/s1/install-update', { force: true }]);
    m = mockFetch();
    await api.skills.forkPrecheck('c1', 's1');
    expect(first(m).slice(0, 2)).toEqual(['GET', '/api/companies/c1/skills/s1/fork-precheck']);
    m = mockFetch();
    await api.skills.fork('c1', 's1', { reassignAgentIds: ['a1'] });
    expect(first(m)).toEqual(['POST', '/api/companies/c1/skills/s1/fork', { reassignAgentIds: ['a1'] }]);
    m = mockFetch();
    await api.skills.remove('c1', 's1');
    expect(first(m).slice(0, 2)).toEqual(['DELETE', '/api/companies/c1/skills/s1']);
  });

  it('skillSources.get / select', async () => {
    let m = mockFetch();
    await api.skillSources.get('c1', 'src1');
    expect(first(m).slice(0, 2)).toEqual(['GET', '/api/companies/c1/skill-sources/src1']);
    m = mockFetch();
    await api.skillSources.select('c1', 'src1', { revision: 3, selectedPaths: ['a'], excludedFolders: [] });
    expect(first(m)).toEqual([
      'PATCH',
      '/api/companies/c1/skill-sources/src1',
      { revision: 3, selectedPaths: ['a'], excludedFolders: [] },
    ]);
  });

  it('environments.archive là PATCH {status:archived}, không có hàm delete', async () => {
    const m = mockFetch();
    await api.environments.archive('e1');
    expect(first(m)).toEqual(['PATCH', '/api/environments/e1', { status: 'archived' }]);
    expect('delete' in api.environments || 'remove' in api.environments).toBe(false);
  });

  it('projects.archive là PATCH {archivedAt: ISO}', async () => {
    const m = mockFetch();
    await api.projects.archive('p1', 'c1');
    const [method, url, body] = first(m);
    expect(method).toBe('PATCH');
    expect(url).toBe('/api/projects/p1?companyId=c1');
    expect(new Date((body as { archivedAt: string }).archivedAt).toISOString()).toBe(
      (body as { archivedAt: string }).archivedAt,
    );
  });

  it('agents/projects không có hàm xóa', () => {
    expect('delete' in api.agents || 'remove' in api.agents).toBe(false);
    expect('delete' in api.projects || 'remove' in api.projects).toBe(false);
  });
});

describe('queryKeys', () => {
  it('issueActivity nằm dưới khóa issue, skillFile dưới skill', () => {
    expect(queryKeys.issueActivity('i1')).toEqual(['issue', 'i1', 'activity']);
    expect(queryKeys.skillFile('c1', 's1', 'SKILL.md')).toEqual(['skills', 'c1', 's1', 'files', 'SKILL.md']);
    expect(queryKeys.skillSource('c1', 'src1')).toEqual(['skill-sources', 'c1', 'src1']);
  });
});

describe('kiểu IX1/IX2', () => {
  it('payload/kết quả hai kind việc máy mới và kind setup run gỡ', () => {
    const p: JobPayload = {
      kind: 'remove-checkouts',
      projectId: 'p',
      projectKey: 'k',
      roles: ['executor'],
      removeStatusRepo: false,
    };
    const q: JobPayload = { kind: 'skill-remove', skillId: 's', slug: 'x' };
    const r: JobResult = {
      kind: 'remove-checkouts',
      removed: [{ role: 'executor', path: '/a' }],
      kept: [{ role: 'reviewer', path: '/b', reason: 'dirty' }],
      absent: ['integrator'],
    };
    const r2: JobResult = { kind: 'skill-remove', removed: true };
    const kinds: SetupRun['kind'][] = ['remove-project', 'remove-agent'];
    const steps: SetupStepId[] = ['pause-agents', 'pause-agent'];
    expect([p.kind, q.kind, r.kind, r2.kind, kinds, steps]).toBeTruthy();
  });

  it('setup.create nhận input gỡ project/agent', async () => {
    const m = mockFetch({});
    await api.setup.create({
      companyId: 'c1',
      kind: 'remove-project',
      projectKey: 'k',
      machineId: 'm1',
      input: { projectId: 'p1', projectName: 'P' },
    });
    expect(first(m)[2]).toMatchObject({ kind: 'remove-project', input: { projectId: 'p1' } });
  });
});

describe('hợp đồng setup run gỡ của plugin', () => {
  it('setup.create gỡ project gửi projectId trong input, không ở cấp trên cùng', async () => {
    const m = mockFetch({});
    await api.setup.create({
      companyId: 'c1',
      kind: 'remove-project',
      projectKey: 'demo',
      machineId: 'm1',
      input: { projectId: 'p1', projectName: 'Demo' },
    });
    const body = first(m)[2] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['companyId', 'input', 'kind', 'machineId', 'projectKey']);
    expect(body.input).toEqual({ projectId: 'p1', projectName: 'Demo' });
  });

  it('setup.create gỡ agent gửi {agentId, agentName, projectId, role}', async () => {
    const m = mockFetch({});
    await api.setup.create({
      companyId: 'c1',
      kind: 'remove-agent',
      projectKey: 'agent-a1111111',
      machineId: 'm1',
      input: { agentId: 'a1', agentName: 'A', projectId: null, role: null },
    });
    expect(first(m)[2]).toEqual({
      companyId: 'c1',
      kind: 'remove-agent',
      projectKey: 'agent-a1111111',
      machineId: 'm1',
      input: { agentId: 'a1', agentName: 'A', projectId: null, role: null },
    });
  });

  it('roles.remove là DELETE vai trò project (S8.7) kèm companyId', async () => {
    expect(ENDPOINTS['roles.delete']).toMatchObject({
      ids: ['S8.7'],
      method: 'DELETE',
      path: '/api/plugins/crew.core/api/projects/:projectId/roles',
    });
    const m = mockFetch({ deleted: true });
    expect(await api.roles.remove('c1', 'p1')).toEqual({ deleted: true });
    expect(first(m).slice(0, 2)).toEqual(['DELETE', '/api/plugins/crew.core/api/projects/p1/roles?companyId=c1']);
  });
});
