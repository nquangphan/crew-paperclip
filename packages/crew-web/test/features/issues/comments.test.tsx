// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { AGENTS, ISSUE, mount, PROJECTS } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Nguồn: GET /api/issues/:id/comments (IssueComment).
const COMMENTS = [
  {
    id: 'cm1',
    authorType: 'agent',
    authorAgentId: 'a1',
    authorUserId: null,
    body: 'Em đã sửa **xong**',
    createdAt: '2026-10-10T01:00:00.000Z',
  },
  {
    id: 'cm2',
    authorType: 'user',
    authorAgentId: null,
    authorUserId: 'u1',
    body: 'Cảm ơn',
    createdAt: '2026-10-10T02:00:00.000Z',
  },
];

function server(over: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/issues/TPS-2': { body: ISSUE },
    'GET /api/issues/i1/comments': { body: COMMENTS },
    'GET /api/issues/i1/attachments': { body: [] },
    'GET /api/issues/i1/documents': { body: [] },
    'GET /api/issues/i1/runs': { body: [] },
    'GET /api/issues/i1/live-runs': { body: [] },
    'POST /api/issues/i1/read': { body: { id: 'i1', lastReadAt: '2026-10-10T03:00:00.000Z' } },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/issues': { body: [] },
    ...over,
  } as Parameters<typeof mockServer>[0]);
}

describe('IssuePage luồng bình luận (S6.4)', () => {
  it('liệt kê bình luận theo thứ tự kèm tên người viết', async () => {
    server();
    mount(<IssuePage />);
    const items = await screen.findAllByTestId('comment');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Executor Alpha');
    expect(items[0].textContent).toContain('xong');
    expect(items[1].textContent).toContain('Bạn');
  });

  it('run đang chạy hiện transcript thu gọn', async () => {
    server({
      'GET /api/issues/i1/live-runs': { body: [{ id: 'r1', status: 'running', agentId: 'a1' }] },
      'GET /api/heartbeat-runs/r1/events': {
        body: [{ id: 1, seq: 1, eventType: 'log', stream: 'stdout', message: 'đang chạy test', payload: null }],
      },
    });
    mount(<IssuePage />);
    const toggle = await screen.findByRole('button', { name: 'Xem nội dung chạy' });
    expect(screen.queryByText('đang chạy test')).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText('đang chạy test')).toBeTruthy();
  });

  it('mở trang gọi POST /issues/:id/read đúng một lần (S6.16)', async () => {
    const s = server();
    mount(<IssuePage />);
    await screen.findAllByTestId('comment');
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/read'))).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa tiêu đề' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/read'))).toHaveLength(1);
  });

  it('đánh dấu đã đọc xong thì làm mới danh sách Hộp thư và badge sidebar (S3.3)', async () => {
    const invalidated: unknown[] = [];
    const orig = QueryClient.prototype.invalidateQueries;
    vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockImplementation(function (
      this: QueryClient,
      filters?: { queryKey?: unknown },
    ) {
      invalidated.push(filters?.queryKey);
      return orig.call(this, filters as never);
    } as never);
    server();
    mount(<IssuePage />);
    await screen.findAllByTestId('comment');
    await waitFor(() => expect(invalidated).toContainEqual(['sidebar-badges', 'c1']));
    expect(invalidated).toContainEqual(['issues', 'c1']);
  });

  it('copy mã và copy link dùng navigator.clipboard (S6.16)', async () => {
    server();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(<IssuePage />);
    await screen.findAllByTestId('comment');
    fireEvent.click(screen.getByRole('button', { name: 'Copy mã' }));
    expect(writeText).toHaveBeenLastCalledWith('TPS-2');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/TPS/issues/TPS-2`);
  });

  it('không tải được issue thì hiện lỗi nguyên văn', async () => {
    mockServer({ 'GET /api/issues/TPS-2': { status: 404, body: { error: 'Issue not found' } } });
    mount(<IssuePage />);
    expect(await screen.findByText(/Issue not found/)).toBeTruthy();
  });

  it('tài liệu của issue chỉ đọc, mở ra thì render markdown (S6.14)', async () => {
    server({
      'GET /api/issues/i1/documents': { body: [{ id: 'd1', key: 'plan', title: 'Kế hoạch', format: 'markdown' }] },
      'GET /api/issues/i1/documents/plan': { body: { id: 'd1', key: 'plan', title: 'Kế hoạch', body: '## Bước một' } },
    });
    mount(<IssuePage />);
    fireEvent.click(await screen.findByRole('button', { name: /Kế hoạch/ }));
    expect(await screen.findByRole('heading', { name: 'Bước một' })).toBeTruthy();
    expect(screen.queryAllByRole('textbox', { name: /tài liệu/i })).toEqual([]);
  });
});
