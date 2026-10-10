// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/api';
import { CompanyContext, MeContext } from '@/app/hooks';
import { ForceDoneAction } from '@/features/issues/detail/crew/force-done-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { AGENTS, COMPANY, ISSUE, ME } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  // Checkbox của radix đo kích thước bằng ResizeObserver, jsdom không có.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const CHILDREN = [
  { id: 'k1', identifier: 'TPS-3', title: 'Con một', status: 'in_progress' },
  { id: 'k2', identifier: 'TPS-4', title: 'Con hai', status: 'done' },
  { id: 'k3', identifier: 'TPS-5', title: 'Con ba', status: 'todo' },
];
const LIVE = [{ id: 'r1', status: 'running', agentId: 'a1' }];
const REASON = 'Owner đã tự kiểm trên máy';
const FORCE = 'POST /api/plugins/crew.core/api/issues/i1/force-done';

function routes(over: Parameters<typeof mockServer>[0] = {}) {
  return mockServer({
    'GET /api/issues/i1': { body: ISSUE },
    'GET /api/issues/i1/live-runs': { body: LIVE },
    'GET /api/companies/c1/issues': { body: CHILDREN },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'PATCH /api/issues/k1': { body: { ...CHILDREN[0], status: 'cancelled' } },
    'PATCH /api/issues/k3': { body: { ...CHILDREN[2], status: 'cancelled' } },
    'POST /api/heartbeat-runs/r1/cancel': { body: {} },
    [FORCE]: { body: { issue: { ...ISSUE, status: 'done' }, violations: ['stage_unapproved:s2'], warnings: [] } },
    ...over,
  });
}

function mountAction(issue: Record<string, unknown> = ISSUE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MeContext.Provider value={ME}>
          <ForceDoneAction issue={issue as never} childIssues={CHILDREN} />
        </MeContext.Provider>
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
  return { qc, spy };
}

async function openDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ép Done' }));
  return screen.findByRole('dialog');
}

const writes = (s: ReturnType<typeof mockServer>) =>
  s.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.split('?')[0]}`);

describe('ForceDoneAction (S6.17)', () => {
  it('ẩn nút khi yêu cầu đã done hoặc cancelled', () => {
    routes();
    mountAction({ ...ISSUE, status: 'done' });
    expect(screen.queryByRole('button', { name: 'Ép Done' })).toBeNull();
    cleanup();
    mountAction({ ...ISSUE, status: 'cancelled' });
    expect(screen.queryByRole('button', { name: 'Ép Done' })).toBeNull();
  });

  it('dialog tóm tắt cổng bỏ qua, run đang chạy, ô hủy con bật sẵn kèm số con chưa xong', async () => {
    routes();
    mountAction();
    const dialog = await openDialog();
    expect(within(dialog).getByText(/Stage 2: Owner duyệt/)).toBeTruthy();
    expect(within(dialog).getByText(/đang chờ Bạn/)).toBeTruthy();
    expect(await within(dialog).findByText('1 run đang chạy của yêu cầu sẽ bị dừng.')).toBeTruthy();
    const box = within(dialog).getByRole('checkbox', { name: 'Hủy luôn 2 việc con chưa xong' });
    expect(box.getAttribute('data-state')).toBe('checked');
    expect(within(dialog).getByText('TPS-3')).toBeTruthy();
    expect(within(dialog).getByText('TPS-5')).toBeTruthy();
    expect(within(dialog).queryByText('TPS-4')).toBeNull();
  });

  it('nút xác nhận tắt khi lý do dưới 10 ký tự', async () => {
    routes();
    mountAction();
    const dialog = await openDialog();
    const submit = within(dialog).getByRole('button', { name: 'Ép Done' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '  123456789  ' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: REASON } });
    expect(submit.disabled).toBe(false);
  });

  it('xác nhận: hủy con chưa xong → dừng run → gọi route với lý do, rồi làm mới issue, lịch sử, danh sách', async () => {
    const s = routes();
    const { spy } = mountAction();
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: `  ${REASON} ` } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ép Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(s)).toEqual([
      'PATCH /api/issues/k1',
      'PATCH /api/issues/k3',
      'POST /api/heartbeat-runs/r1/cancel',
      FORCE,
    ]);
    expect(s.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'cancelled' });
    expect(s.calls.find((c) => c.url.endsWith('/force-done'))?.body).toEqual({ companyId: 'c1', reason: REASON });
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    for (const key of [queryKeys.issue('i1'), queryKeys.issueActivity('i1'), queryKeys.issues('c1')]) {
      expect(keys).toContain(JSON.stringify(key));
    }
  });

  it('bỏ chọn ô hủy con thì không PATCH con', async () => {
    const s = routes();
    mountAction();
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ép Done' }));
    await waitFor(() => expect(writes(s)).toContain(FORCE));
    expect(writes(s)).toEqual(['POST /api/heartbeat-runs/r1/cancel', FORCE]);
  });

  it('lỗi server hiện nguyên văn trong dialog, giữ lý do, không gửi tiếp', async () => {
    const s = routes({ [FORCE]: { status: 400, body: { error: 'reason_invalid' } } });
    mountAction();
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ép Done' }));
    expect(await within(dialog).findByText('reason_invalid')).toBeTruthy();
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe(REASON);
    expect(writes(s).filter((w) => w === FORCE)).toHaveLength(1);
  });

  it('yêu cầu đã đóng khi đọc lại thì đóng dialog, báo, không hủy con/run, không gọi route', async () => {
    const s = routes({ 'GET /api/issues/i1': { body: { ...ISSUE, status: 'done' } } });
    mountAction();
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ép Done' }));
    expect(await screen.findByText(/Yêu cầu vừa đổi trạng thái \(Hoàn thành\)/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(s)).toEqual([]);
  });

  it('route trả cảnh báo thì hiện câu cảnh báo sau khi đóng dialog', async () => {
    routes({
      [FORCE]: {
        body: {
          issue: { ...ISSUE, status: 'done' },
          violations: [],
          warnings: ['violations_unread', 'comment_failed'],
        },
      },
    });
    mountAction();
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ép Done' }));
    expect(await screen.findByText(/không ghi được bình luận lý do/)).toBeTruthy();
    expect(screen.queryByText(/không đọc được danh sách cổng/)).toBeNull();
  });

  it('chỉ có cảnh báo violations_unread (route luôn trả) thì không hiện gì', async () => {
    routes({
      [FORCE]: { body: { issue: { ...ISSUE, status: 'done' }, violations: [], warnings: ['violations_unread'] } },
    });
    mountAction();
    const dialog = await openDialog();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ép Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
