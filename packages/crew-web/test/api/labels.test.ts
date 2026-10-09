// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ENDPOINTS, queryKeys } from '@/api';

afterEach(() => vi.restoreAllMocks());

describe('api.labels', () => {
  it('dòng ENDPOINTS labels.list gắn mã S5 và đường của server', () => {
    expect(ENDPOINTS['labels.list']).toMatchObject({
      ids: ['S5.2'],
      method: 'GET',
      path: '/api/companies/:companyId/labels',
    });
  });

  it('list gọi GET đúng đường và trả mảng nhãn', async () => {
    const body = [{ id: 'l1', name: 'research' }];
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(api.labels.list('c1')).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/companies/c1/labels');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('có query key theo company', () => {
    expect(queryKeys.labels('c1')).toEqual(['labels', 'c1']);
  });
});
