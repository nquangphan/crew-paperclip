// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';

afterEach(() => vi.restoreAllMocks());

function stub(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('api.runtimes', () => {
  it('get: GET runtime-switches kèm companyId, trả danh sách máy', async () => {
    const f = stub({ machines: [{ machineId: 'm1', hostname: 'h', runtimes: {} }] });
    const machines = await api.runtimes.get('c1');
    expect(machines).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/plugins/crew.core/api/runtime-switches?companyId=c1');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('set: POST (không PUT) runtime-switches với companyId, machineId, runtime, enabled', async () => {
    const f = stub({ ok: true, runtimes: {} });
    await api.runtimes.set({ companyId: 'c1', machineId: 'm1', runtime: 'codex_local', enabled: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/plugins/crew.core/api/runtime-switches');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      companyId: 'c1',
      machineId: 'm1',
      runtime: 'codex_local',
      enabled: true,
    });
  });
});
