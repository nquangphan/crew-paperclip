// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupApi } from '@/api/crew/setup';
import type { SetupRun } from '@/api/crew/types';
import { ENDPOINTS } from '@/api/endpoints';

afterEach(() => vi.restoreAllMocks());

const mockFetch = (payload: unknown) => {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(payload), { status: 200 }),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe('setup.abandon', () => {
  it('có dòng ENDPOINTS gắn mã S9 (BA chưa có mã riêng cho nút Bỏ lần dở)', () => {
    expect(ENDPOINTS['setup.abandon']).toMatchObject({
      ids: ['S9'],
      method: 'POST',
      path: '/api/plugins/crew.core/api/setup-runs/:id/abandon',
    });
  });

  it('gửi POST .../abandon với body {companyId} của run', async () => {
    const fetchMock = mockFetch({ id: 'r1', status: 'abandoned' });
    const res = await setupApi.abandon('c1', 'r 1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/setup-runs/r%201/abandon');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ companyId: 'c1' });
    expect(res.status).toBe('abandoned');
  });
});

describe('khóa bước (lockToken)', () => {
  it('kiểu SetupRun nhận trạng thái abandoned', () => {
    const status: SetupRun['status'] = 'abandoned';
    expect(status).toBe('abandoned');
  });

  it('begin trả lockToken và finish gửi lại lockToken trong body', async () => {
    mockFetch({ id: 'r1', status: 'running', lockToken: 'tok-1' });
    const begun = await setupApi.begin('c1', 'r1', 'project');
    expect(begun.lockToken).toBe('tok-1');

    const fetchMock = mockFetch({ id: 'r1', status: 'running' });
    await setupApi.finish('c1', 'r1', 'project', { status: 'done', lockToken: begun.lockToken });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      companyId: 'c1',
      status: 'done',
      lockToken: 'tok-1',
    });
  });
});
