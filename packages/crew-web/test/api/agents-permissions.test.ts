// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@/api/endpoints';
import { agentsApi } from '@/api/paperclip/agents';

afterEach(() => vi.restoreAllMocks());

describe('agents.setPermissions', () => {
  it('có dòng ENDPOINTS gắn mã S9.5 và S13.1', () => {
    expect(ENDPOINTS['agents.setPermissions']).toMatchObject({
      ids: ['S9.5', 'S13.1'],
      method: 'PATCH',
      path: '/api/agents/:id/permissions',
    });
  });

  it('gửi PATCH /api/agents/:id/permissions với body quyền và companyId ở query', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"id":"a1"}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const body = { canCreateAgents: false, canCreateSkills: false, canAssignTasks: true };
    const res = await agentsApi.setPermissions('a1', body, 'c1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/agents/a1/permissions');
    expect(String(url)).toContain('companyId=c1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual(body);
    expect(res).toMatchObject({ id: 'a1' });
  });
});
