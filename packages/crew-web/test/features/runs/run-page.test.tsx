// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CompanyContext } from '@/app/hooks';
import { routes } from '@/features/runs/routes';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  // nạp sẵn trang lazy để ca đầu không chờ biên dịch
  await import('@/features/runs/run-page');
});
afterEach(cleanup);

const COMPANY = { id: 'c1', name: '2P', issuePrefix: 'TPS' };
const RUN_ID = '11111111-aaaa-4aaa-8aaa-111111111111';

// Nguồn: GET /api/heartbeat-runs/:id (HeartbeatRun), /events (HeartbeatRunEvent), /log (heartbeat.readLog),
// /issues (activity.ts issuesForRun), GET /api/agents/:id (Agent).
const run = (over: Record<string, unknown> = {}) => ({
  id: RUN_ID,
  companyId: 'c1',
  agentId: 'a1',
  status: 'running',
  startedAt: '2026-10-10T01:00:00.000Z',
  finishedAt: null,
  error: null,
  errorCode: null,
  exitCode: null,
  contextSnapshot: { issueId: 'i1' },
  ...over,
});

function server(runOver: Record<string, unknown> = {}, extra: Record<string, never | object> = {}) {
  return mockServer({
    [`GET /api/heartbeat-runs/${RUN_ID}`]: { body: run(runOver) },
    [`GET /api/heartbeat-runs/${RUN_ID}/events`]: {
      body: [
        { id: 1, seq: 1, eventType: 'assistant', stream: 'stdout', message: 'Đang sửa trang đăng nhập' },
        { id: 2, seq: 2, eventType: 'error', stream: 'stderr', message: 'cảnh báo nhỏ' },
      ],
    },
    [`GET /api/heartbeat-runs/${RUN_ID}/log`]: {
      body: { content: '{"ts":"t","stream":"stdout","chunk":"dòng log một"}\n', nextOffset: 50 },
    },
    [`GET /api/heartbeat-runs/${RUN_ID}/issues`]: {
      body: [{ issueId: 'i1', identifier: 'TPS-2', title: 'Sửa trang đăng nhập', status: 'in_progress' }],
    },
    'GET /api/agents/a1': { body: { id: 'a1', name: 'Executor Alpha', urlKey: 'executor-alpha' } },
    ...extra,
  });
}

function mount(at = `/TPS/runs/${RUN_ID}`) {
  const router = createMemoryRouter(
    [
      { path: '/:companyPrefix', children: routes },
      { path: '/:companyPrefix/*', element: <div>đích khác</div> },
    ],
    { initialEntries: [at] },
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <RouterProvider router={router} />
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

describe('RunPage (S12.1)', () => {
  it('hiện agent, trạng thái, nội dung chạy, log và yêu cầu liên quan', async () => {
    server();
    mount();
    expect(await screen.findByText('Executor Alpha')).toBeTruthy();
    expect(await screen.findByText('Đang sửa trang đăng nhập')).toBeTruthy();
    expect(screen.getByText('cảnh báo nhỏ')).toBeTruthy();
    expect(await screen.findByText('dòng log một')).toBeTruthy();
    const link = await screen.findByRole('link', { name: /Sửa trang đăng nhập/ });
    expect(link.getAttribute('href')).toBe('/TPS/issues/TPS-2');
  });

  it('cùng một trang cho đường agents/:agentRef/runs/:runId', async () => {
    server();
    mount(`/TPS/agents/executor-alpha/runs/${RUN_ID}`);
    expect(await screen.findByText('Executor Alpha')).toBeTruthy();
    expect(await screen.findByText('dòng log một')).toBeTruthy();
  });

  it('run không có log (404) hiện chú thích chứ không báo lỗi', async () => {
    server({}, { [`GET /api/heartbeat-runs/${RUN_ID}/log`]: { status: 404, body: { error: 'Run log not found' } } });
    mount();
    expect(await screen.findByText('Run chưa có log')).toBeTruthy();
    expect(screen.queryByText('Không tải được log')).toBeNull();
  });

  it('lỗi tải run hiện nguyên văn', async () => {
    mockServer({ [`GET /api/heartbeat-runs/${RUN_ID}`]: { status: 500, body: { error: 'cơ sở dữ liệu hỏng' } } });
    mount();
    expect(await screen.findByText(/cơ sở dữ liệu hỏng/)).toBeTruthy();
  });
});

describe('RunPage thao tác (S12.2–S12.4)', () => {
  it('Dừng run phải xác nhận rồi POST /heartbeat-runs/:id/cancel', async () => {
    const s = server({ status: 'running' }, { [`POST /api/heartbeat-runs/${RUN_ID}/cancel`]: { body: {} } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Dừng run' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(s.calls.some((c) => c.url.endsWith('/cancel'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dừng run' }));
    await waitFor(() =>
      expect(s.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/cancel'))).toHaveLength(1),
    );
  });

  it('Hủy trong hộp xác nhận thì không gọi gì', async () => {
    const s = server({ status: 'running' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Dừng run' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hủy' }));
    expect(s.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('lỗi dừng run hiện nguyên văn', async () => {
    server(
      { status: 'running' },
      { [`POST /api/heartbeat-runs/${RUN_ID}/cancel`]: { status: 409, body: { error: 'run đã kết thúc' } } },
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Dừng run' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Dừng run' }));
    expect(await screen.findByText(/run đã kết thúc/)).toBeTruthy();
  });

  it('Chạy lại run lỗi: xác nhận rồi wakeup retry_failed_run, chuyển sang run mới', async () => {
    const s = server(
      { status: 'failed', errorCode: 'adapter_failed', error: 'claude thoát mã 1' },
      { 'POST /api/agents/a1/wakeup': { status: 202, body: { id: 'new-run-9999' } } },
    );
    const router = mount();
    expect(await screen.findByText(/claude thoát mã 1/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Chạy lại' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(s.calls.some((c) => c.url.includes('/wakeup'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chạy lại' }));
    await waitFor(() => expect(s.calls.some((c) => c.url.includes('/wakeup'))).toBe(true));
    const call = s.calls.find((c) => c.url.includes('/wakeup'));
    expect(call?.body).toMatchObject({ reason: 'retry_failed_run', failedRunId: RUN_ID, source: 'on_demand' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/TPS/runs/new-run-9999'));
  });

  it('Tiếp tục run mất tiến trình: wakeup resume_process_lost_run kèm resumeFromRunId', async () => {
    const s = server(
      { status: 'failed', errorCode: 'process_lost' },
      { 'POST /api/agents/a1/wakeup': { status: 202, body: { id: 'new-run-8888' } } },
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục run' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Tiếp tục run' }));
    await waitFor(() => expect(s.calls.some((c) => c.url.includes('/wakeup'))).toBe(true));
    expect(s.calls.find((c) => c.url.includes('/wakeup'))?.body).toMatchObject({
      reason: 'resume_process_lost_run',
      payload: { resumeFromRunId: RUN_ID, issueId: 'i1' },
    });
  });

  it('server bỏ qua wakeup (skipped) thì báo lỗi, không chuyển trang', async () => {
    server(
      { status: 'timed_out' },
      { 'POST /api/agents/a1/wakeup': { status: 202, body: { status: 'skipped', message: 'agent đang tạm dừng' } } },
    );
    const router = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Chạy lại' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Chạy lại' }));
    expect(await screen.findByText(/agent đang tạm dừng/)).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/TPS/runs/${RUN_ID}`);
  });

  it('chạy lại run gắn chat được nhận nhưng chưa có run mới: báo đã xếp hàng, không báo lỗi, khóa nút', async () => {
    const s = server(
      { status: 'failed', errorCode: 'adapter_failed' },
      {
        'POST /api/agents/a1/wakeup': {
          status: 202,
          body: { actionId: 'act-1', issueId: 'i1', runId: null, status: 'queued' },
        },
      },
    );
    const router = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Chạy lại' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Chạy lại' }));
    expect(
      await screen.findByText('Đã nhận yêu cầu chạy lại. Run mới sẽ bắt đầu khi tới lượt, không cần bấm lại.'),
    ).toBeTruthy();
    expect(screen.queryByText('Thao tác không thành công')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((screen.getByRole('button', { name: 'Chạy lại' }) as HTMLButtonElement).disabled).toBe(true);
    expect(router.state.location.pathname).toBe(`/TPS/runs/${RUN_ID}`);
    expect(s.calls.filter((c) => c.url.includes('/wakeup'))).toHaveLength(1);
  });

  it('chạy lại run gắn chat bị từ chối (runId null, status failed) thì báo lỗi', async () => {
    server(
      { status: 'failed', errorCode: 'adapter_failed' },
      {
        'POST /api/agents/a1/wakeup': {
          status: 202,
          body: { actionId: 'act-1', issueId: 'i1', runId: null, status: 'failed' },
        },
      },
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Chạy lại' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Chạy lại' }));
    expect(await screen.findByText('Thao tác không thành công')).toBeTruthy();
  });

  it('run thành công không có nút thao tác', async () => {
    server({ status: 'succeeded', finishedAt: '2026-10-10T02:00:00.000Z' });
    mount();
    await screen.findByText('Executor Alpha');
    for (const name of ['Dừng run', 'Chạy lại', 'Tiếp tục run']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});
