// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CompanyContext, MeContext } from '@/app/hooks';
import {
  canStartWork,
  START_WORK_NOTICE_MS,
  StartWorkButton,
  StartWorkNotice,
} from '@/features/issues/detail/start-work';
import { useIssue } from '@/features/issues/detail/use-issue';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { COMPANY, ISSUE, ME } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Nháp gốc như dialog Yêu cầu mới tạo: `backlog`, giao Trợ Lý, chưa vào stage nào. */
const DRAFT = { ...ISSUE, parentId: null, ancestors: [], status: 'backlog', executionState: null };

function Harness() {
  const { data } = useIssue('TPS-2');
  return (
    <>
      {data ? <StartWorkButton issue={data} /> : null}
      <StartWorkNotice />
    </>
  );
}

function mountHarness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MeContext.Provider value={ME}>
          <Harness />
        </MeContext.Provider>
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return qc;
}

const patches = (s: ReturnType<typeof mockServer>) => s.calls.filter((c) => c.method === 'PATCH');
const issueGets = (s: ReturnType<typeof mockServer>) =>
  s.calls.filter((c) => c.method === 'GET' && c.url === '/api/issues/TPS-2');

describe('canStartWork', () => {
  it('chỉ nháp có agent nhận việc', () => {
    expect(canStartWork({ status: 'backlog', assigneeAgentId: 'a1' })).toBe(true);
    expect(canStartWork({ status: 'backlog', assigneeAgentId: null })).toBe(false);
    expect(canStartWork({ status: 'backlog' })).toBe(false);
    for (const status of ['todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled']) {
      expect(canStartWork({ status, assigneeAgentId: 'a1' }), status).toBe(false);
    }
  });
});

describe('Bắt đầu làm yêu cầu nháp', () => {
  it('owner bấm Bắt đầu làm: đọc lại issue, gửi đúng PATCH {status:"todo"}, báo thành công và tải lại issue', async () => {
    let current: unknown = DRAFT;
    const s = mockServer({
      'GET /api/issues/TPS-2': () => ({ body: current }),
      'GET /api/issues/i1': { body: DRAFT },
      'PATCH /api/issues/i1': () => {
        current = { ...DRAFT, status: 'todo' };
        return { body: current };
      },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu làm' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(patches(s)[0].body).toEqual({ status: 'todo' });
    expect(s.calls.some((c) => c.method === 'GET' && c.url === '/api/issues/i1')).toBe(true);
    expect(await screen.findByText('Đã bắt đầu TPS-2')).toBeTruthy();
    expect(screen.getByText('Trợ Lý đã được gọi và sẽ bắt đầu làm yêu cầu này.')).toBeTruthy();
    // Issue tải lại thành `todo`, nên nút biến mất.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Bắt đầu làm' })).toBeNull());
    expect(issueGets(s).length).toBeGreaterThanOrEqual(2);
  });

  it('thông báo thành công tự ẩn, nút Đóng cũng ẩn được', async () => {
    mockServer({
      'GET /api/issues/TPS-2': { body: DRAFT },
      'GET /api/issues/i1': { body: DRAFT },
      'PATCH /api/issues/i1': { body: { ...DRAFT, status: 'todo' } },
    });
    const qc = mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu làm' }));
    await screen.findByText('Đã bắt đầu TPS-2');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByText('Đã bắt đầu TPS-2')).toBeNull());

    vi.useFakeTimers();
    act(() => {
      qc.setQueryData(['start-work-notice', 'c1'], { kind: 'started', identifier: 'TPS-2' });
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText('Đã bắt đầu TPS-2')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(START_WORK_NOTICE_MS - 100);
    });
    expect(screen.getByText('Đã bắt đầu TPS-2')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Đã bắt đầu TPS-2')).toBeNull();
  });

  it('server từ chối thì hiện nguyên văn câu lỗi, giữ thông báo, không thử lại', async () => {
    const message = 'Crew: bạn chưa được owner cấp quyền xem project này.';
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: DRAFT },
      'GET /api/issues/i1': { body: DRAFT },
      'PATCH /api/issues/i1': { status: 403, body: { error: message } },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu làm' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('Không bắt đầu được TPS-2')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(patches(s)).toHaveLength(1);
    // Vẫn là nháp nên nút còn để thử lại khi người dùng muốn.
    expect(screen.getByRole('button', { name: 'Bắt đầu làm' })).toBeTruthy();
  });

  it('issue đã chạy ở nơi khác (trang cũ còn nút): không gửi PATCH, báo không còn là nháp', async () => {
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: DRAFT },
      'GET /api/issues/i1': { body: { ...DRAFT, status: 'in_progress' } },
      'PATCH /api/issues/i1': { body: { ...DRAFT, status: 'todo' } },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu làm' }));
    expect(
      await screen.findByText('Yêu cầu không còn là nháp (đang ở Đang làm), nên không gửi gì. Trang đã tải lại.'),
    ).toBeTruthy();
    expect(patches(s)).toHaveLength(0);
  });

  it.each([
    ['không phải nháp', { ...DRAFT, status: 'todo' }],
    ['nháp không có agent nhận việc', { ...DRAFT, assigneeAgentId: null }],
  ])('%s: không có nút', async (_name, issue) => {
    const s = mockServer({ 'GET /api/issues/TPS-2': { body: issue } });
    mountHarness();
    await waitFor(() => expect(issueGets(s).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Bắt đầu làm' })).toBeNull();
  });

  it.each([
    ['viewer', { userId: 'u3', membershipRole: 'viewer', contributor: false, canApprove: false }],
    ['khách góp ý', { userId: 'u4', membershipRole: 'viewer', contributor: true, canApprove: false }],
  ])('%s (server trả 403 cho mọi lệnh ghi): không có nút', async (_name, access) => {
    const s = mockServer({ 'GET /api/issues/TPS-2': { body: DRAFT }, ...accessRoute('c1', access) });
    mountHarness();
    await waitFor(() => expect(s.calls.some((c) => c.url.endsWith('/access'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Bắt đầu làm' })).toBeNull();
  });

  it('operator (thành viên ghi được) thấy nút', async () => {
    mockServer({
      'GET /api/issues/TPS-2': { body: DRAFT },
      ...accessRoute('c1', { userId: 'u2', membershipRole: 'operator', contributor: false, canApprove: false }),
    });
    mountHarness();
    expect(await screen.findByRole('button', { name: 'Bắt đầu làm' })).toBeTruthy();
  });
});
