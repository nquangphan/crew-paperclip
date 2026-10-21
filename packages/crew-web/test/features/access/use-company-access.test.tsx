// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { deriveAccess, useCompanyAccess } from '@/features/access';
import { accessRoute, mockServer } from '../../app/fetch-mock';

afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>{children}</CompanyContext.Provider>
  </QueryClientProvider>
);

const access = (membershipRole: string | null, contributor = false) => ({
  userId: 'u1',
  membershipRole,
  contributor,
  canApprove: membershipRole === 'owner',
});

async function load(body: Record<string, unknown> | null) {
  const server = mockServer(body ? accessRoute('c1', body) : { 'GET /api/crew/companies/c1/access': { status: 500 } });
  const hook = renderHook(() => useCompanyAccess(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { hook, server };
}

describe('useCompanyAccess', () => {
  it('đang tải thì chỉ đọc để nút ghi không chớp lên', () => {
    mockServer(accessRoute('c1', access('owner')));
    const { result } = renderHook(() => useCompanyAccess(), { wrapper });
    expect(result.current).toMatchObject({
      isOwner: false,
      isContributor: false,
      readOnly: true,
      loading: true,
      error: null,
    });
  });

  it('owner: ghi được, duyệt được', async () => {
    const { hook, server } = await load(access('owner'));
    expect(hook.result.current).toMatchObject({
      isOwner: true,
      isContributor: false,
      readOnly: false,
      loading: false,
      error: null,
    });
    expect(server.calls[0]).toMatchObject({ method: 'GET', url: '/api/crew/companies/c1/access' });
  });

  it('viewer có dấu là khách góp ý, chỉ đọc', async () => {
    const { hook } = await load(access('viewer', true));
    expect(hook.result.current).toMatchObject({ isOwner: false, isContributor: true, readOnly: true, loading: false });
  });

  it('viewer không dấu: chỉ đọc, không phải khách góp ý', async () => {
    const { hook } = await load(access('viewer', false));
    expect(hook.result.current).toMatchObject({ isContributor: false, readOnly: true });
  });

  it('operator và admin ghi được, không phải owner', async () => {
    for (const role of ['operator', 'admin']) {
      const { hook } = await load(access(role));
      expect(hook.result.current).toMatchObject({
        isOwner: false,
        isContributor: false,
        readOnly: false,
        loading: false,
      });
      cleanup();
    }
  });

  it('trả vai trò lõi để trang Hướng dẫn chọn bản đúng (admin, operator, viewer)', async () => {
    for (const role of ['admin', 'operator', 'viewer']) {
      const { hook } = await load(access(role));
      expect(hook.result.current.membershipRole).toBe(role);
      cleanup();
    }
    expect(deriveAccess(undefined, true).membershipRole).toBeNull();
  });

  it('dấu khách của người đã nâng role không có tác dụng', () => {
    expect(deriveAccess({ membershipRole: 'operator', contributor: true }, false).isContributor).toBe(false);
    expect(
      deriveAccess({ membershipRole: 'operator', contributor: true, department: 'qc' }, false).department,
    ).toBeNull();
  });

  it('phòng của khách góp ý: qc, marketing; server cũ chưa trả phòng thì là marketing; không phải khách thì null', () => {
    const viewer = (contributor: boolean, department?: 'marketing' | 'qc' | null) =>
      deriveAccess({ membershipRole: 'viewer', contributor, department }, false);
    expect(viewer(true, 'qc')).toMatchObject({ isContributor: true, department: 'qc' });
    expect(viewer(true, 'marketing')).toMatchObject({ isContributor: true, department: 'marketing' });
    expect(viewer(true)).toMatchObject({ isContributor: true, department: 'marketing' });
    expect(viewer(false, null)).toMatchObject({ isContributor: false, department: null });
  });

  it('lỗi tải vai trò thì không khóa UI (server vẫn là cổng thật) và trả lỗi để route cần vai trò báo', async () => {
    const { hook } = await load(null);
    expect(hook.result.current).toMatchObject({
      isOwner: false,
      isContributor: false,
      readOnly: false,
      loading: false,
    });
    expect(hook.result.current.error).toBeInstanceOf(Error);
  });
});
