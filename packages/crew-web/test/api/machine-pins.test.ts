import { describe, expect, it } from 'vitest';
import { api } from '@/api';
import { mockServer } from '../app/fetch-mock';

const BASE = '/api/crew/companies/c1';

describe('machinePins', () => {
  it('danh sách máy cho form gửi projectId ở query và trả items', async () => {
    const item = { machineId: 'm1', hostname: 'Phans-Mac-mini', online: true, status: null, running: 0, load1: 1, cpuCount: 10, memFreePct: 54 };
    const { calls } = mockServer({ [`GET ${BASE}/machines`]: { body: { items: [item] } } });
    expect(await api.machinePins.candidates('c1', 'p1')).toEqual([item]);
    expect(calls[0]?.url).toBe(`${BASE}/machines?projectId=p1`);
  });

  it('ghim máy gửi đúng body; đọc máy của yêu cầu', async () => {
    const view = { rootIssueId: 'i1', isRoot: true, locked: false, pin: null };
    const { calls } = mockServer({
      [`PUT ${BASE}/issues/i1/machine`]: { body: view },
      [`GET ${BASE}/issues/i1/machine`]: { body: view },
    });
    expect(await api.machinePins.set('c1', 'i1', 'm1')).toEqual(view);
    expect(await api.machinePins.get('c1', 'i1')).toEqual(view);
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { machineId: 'm1' } });
  });

  it('máy của project: đọc, thêm máy, lưu repo', async () => {
    const repo = { originUrl: 'git@github.com:o/r.git', branch: 'main', companions: [] };
    const { calls } = mockServer({
      [`GET ${BASE}/projects/p1/machines`]: { body: { repo, machines: [] } },
      [`POST ${BASE}/projects/p1/machines`]: { status: 202, body: { status: 'provisioning' } },
      [`PUT ${BASE}/projects/p1/repo`]: { body: repo },
    });
    expect(await api.machinePins.projectMachines('c1', 'p1')).toEqual({ repo, machines: [] });
    expect(await api.machinePins.addMachine('c1', 'p1', 'm1')).toEqual({ status: 'provisioning' });
    expect(await api.machinePins.setRepo('c1', 'p1', repo)).toEqual(repo);
    expect(calls.map((c) => [c.method, c.body])).toEqual([['GET', null], ['POST', { machineId: 'm1' }], ['PUT', repo]]);
  });

  it('blockers, release, provisionOthers: đúng đường, query và body', async () => {
    const { calls } = mockServer({
      [`GET ${BASE}/projects/p1/machines/blockers`]: { body: { blockers: [] } },
      [`POST ${BASE}/projects/p1/machines/release`]: { body: { archivedEnvironmentIds: [], jobs: [] } },
      [`POST ${BASE}/projects/p1/machines/provision`]: { body: { queued: [], skipped: [] } },
    });
    expect(await api.machinePins.blockers('c1', 'p1', ['a1', 'a2'])).toEqual([]);
    expect(calls[0]?.url).toBe(`${BASE}/projects/p1/machines/blockers?agentIds=a1%2Ca2`);
    await api.machinePins.release('c1', 'p1', { agentIds: ['a1'], wholeProject: false, primaryMachineId: 'm1' });
    await api.machinePins.provisionOthers('c1', 'p1', { exceptMachineId: 'm1', includeReady: true, repo: null });
    expect(calls.slice(1).map((c) => c.body)).toEqual([
      { agentIds: ['a1'], wholeProject: false, primaryMachineId: 'm1' },
      { exceptMachineId: 'm1', includeReady: true, repo: null },
    ]);
  });
});
