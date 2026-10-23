// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { MachinesTab } from '@/features/projects/detail/machines-tab';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const URL = '/api/crew/companies/c1/projects/p1/machines';
const DATA = {
  repo: {
    originUrl: 'git@github.com:nquangphan/kidy_school.git',
    branch: 'main',
    companions: [{ name: 'kidy_school_2.0_docs', originUrl: 'git@github.com:nquangphan/kidy_school_2.0_docs.git' }],
  },
  machines: [
    {
      machineId: 'm-book',
      hostname: 'Phans-MacBook-Pro',
      online: true,
      status: 'ready',
      error: null,
      repoPath: '/Users/a/Documents/projects/kidy_school',
      updatedAt: '2026-10-24T01:00:00.000Z',
    },
    {
      machineId: 'm-mini',
      hostname: 'Phans-Mac-mini',
      online: true,
      status: null,
      error: null,
      repoPath: null,
      updatedAt: null,
    },
    {
      machineId: 'm-old',
      hostname: 'Mac-cu',
      online: false,
      status: 'failed',
      error: 'GitHub từ chối key SSH',
      repoPath: null,
      updatedAt: '2026-10-23T01:00:00.000Z',
    },
  ],
};
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MachinesTab projectId="p1" />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );

describe('tab Máy của project', () => {
  it('liệt kê máy với trạng thái, lỗi dựng, repo; owner thấy Thêm máy ở máy online chưa dựng', async () => {
    mockServer({ [`GET ${URL}`]: { body: DATA } });
    mount();
    const list = within(await screen.findByTestId('project-machines'));
    expect(list.getByText('Phans-MacBook-Pro')).toBeTruthy();
    expect(list.getByText('Sẵn sàng')).toBeTruthy();
    expect(list.getByText('Chưa dựng project')).toBeTruthy();
    expect(list.getByText(/GitHub từ chối key SSH/)).toBeTruthy();
    expect(list.getAllByRole('button', { name: 'Thêm máy' })).toHaveLength(1);
  });

  it('Thêm máy gửi đúng máy rồi đọc lại', async () => {
    const { calls } = mockServer({
      [`GET ${URL}`]: { body: DATA },
      [`POST ${URL}`]: { status: 202, body: { status: 'provisioning' } },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm máy' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url.startsWith(URL))).toHaveLength(2));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ machineId: 'm-mini' });
  });

  it('owner sửa origin và repo đi kèm', async () => {
    const { calls } = mockServer({
      [`GET ${URL}`]: { body: { ...DATA, repo: null } },
      'PUT /api/crew/companies/c1/projects/p1/repo': {
        body: { originUrl: 'git@github.com:o/r.git', branch: 'main', companions: [] },
      },
    });
    mount();
    fireEvent.change(await screen.findByLabelText('Origin repo'), { target: { value: 'git@github.com:o/r.git' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu repo' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      originUrl: 'git@github.com:o/r.git',
      branch: 'main',
      companions: [],
    });
  });

  it('repo sai thì hiện lời server', async () => {
    mockServer({
      [`GET ${URL}`]: () => ({ body: { ...DATA, repo: null } }),
      'PUT /api/crew/companies/c1/projects/p1/repo': () => ({
        status: 422,
        body: { error: 'Origin không hợp lệ', code: 'crew_machine_invalid' },
      }),
    });
    mount();
    fireEvent.change(await screen.findByLabelText('Origin repo'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu repo' }));
    expect(await screen.findByText(/Origin không hợp lệ/)).toBeTruthy();
  });

  it('không phải owner: chỉ xem, không có nút ghi; chưa có máy nào thì hướng dẫn ghép', async () => {
    mockServer({
      ...accessRoute('c1', { userId: 'u3', membershipRole: 'viewer', contributor: false, canApprove: false }),
      [`GET ${URL}`]: { body: { repo: null, machines: [] } },
    });
    mount();
    expect(
      await screen.findByText('Chưa có máy nào được ghép. Máy chưa ghép, mở app 2P Crew → Máy → Ghép.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lưu repo' })).toBeNull();
  });
});
