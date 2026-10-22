// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { CompanyContext, MeContext } from '@/app/hooks';
import { ActionsSlot } from '@/features/issues/detail/crew/actions-slot';
import { useIssue } from '@/features/issues/detail/use-issue';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { COMPANY, ISSUE, ME } from '../issues/detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const JUDGE = '/api/crew/companies/c1/jev/judge/approval-note';
const OUTCOME = '/api/crew/companies/c1/jev/judgments/7/outcome';

function Harness() {
  const { data } = useIssue('TPS-2');
  return data ? <ActionsSlot issue={data} /> : null;
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CompanyContext.Provider value={{ company: COMPANY, companies: [COMPANY] }}>
        <MeContext.Provider value={ME}>
          <Harness />
        </MeContext.Provider>
      </CompanyContext.Provider>
    </QueryClientProvider>,
  );
}

const base = {
  'GET /api/issues/TPS-2': { body: ISSUE },
  'GET /api/issues/i1': { body: ISSUE },
  'PATCH /api/issues/i1': { body: { ...ISSUE, status: 'done' } },
  [`POST ${OUTCOME}`]: { body: { ok: true } },
};
const patches = (s: ReturnType<typeof mockServer>) => s.calls.filter((c) => c.method === 'PATCH');
const judgeCalls = (s: ReturnType<typeof mockServer>) => s.calls.filter((c) => c.url === JUDGE);
const outcomes = (s: ReturnType<typeof mockServer>) => s.calls.filter((c) => c.url === OUTCOME);

async function writeNote(button: string, note: string) {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: note } });
  return dialog;
}

const verdict = (over: Record<string, unknown> = {}) => ({
  ok: true,
  mode: 'on',
  label: 'request_changes',
  confidence: 0.9,
  mismatch: true,
  judgmentId: '7',
  ...over,
});

describe('Jev kiểm lời nhắn Duyệt / Yêu cầu sửa', () => {
  it('chế độ on và lệch ý: hỏi lại một lần, chưa gửi; Vẫn gửi thì gửi và ghi outcome sent', async () => {
    const s = mockServer({ ...base, [`POST ${JUDGE}`]: { body: verdict() } });
    mount();
    const dialog = await writeNote('Duyệt', 'Sai nhiều chỗ, cần sửa lại');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    const confirm = await screen.findByTestId('jev-approval-confirm');
    expect(within(confirm).getByText('Lời nhắn có vẻ là: yêu cầu sửa. Vẫn duyệt?')).toBeTruthy();
    expect(patches(s)).toHaveLength(0);
    expect(judgeCalls(s)[0].body).toEqual({ issueId: 'i1', action: 'approve', note: 'Sai nhiều chỗ, cần sửa lại' });

    fireEvent.click(within(confirm).getByRole('button', { name: 'Vẫn gửi' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(patches(s)[0].body).toEqual({ status: 'done', comment: 'Sai nhiều chỗ, cần sửa lại' });
    await waitFor(() => expect(outcomes(s)).toHaveLength(1));
    expect(outcomes(s)[0].body).toEqual({ outcome: 'sent' });
    expect(judgeCalls(s)).toHaveLength(1);
  });

  it('Sửa lại: không gửi, giữ nguyên lời nhắn trong hộp, ghi outcome changed', async () => {
    const s = mockServer({ ...base, [`POST ${JUDGE}`]: { body: verdict() } });
    mount();
    const dialog = await writeNote('Duyệt', 'Sai nhiều chỗ, cần sửa lại');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    const confirm = await screen.findByTestId('jev-approval-confirm');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sửa lại' }));
    await waitFor(() => expect(outcomes(s)).toHaveLength(1));
    expect(outcomes(s)[0].body).toEqual({ outcome: 'changed' });
    expect(patches(s)).toHaveLength(0);
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Sai nhiều chỗ, cần sửa lại');
  });

  it.each([
    ['shadow, không lệch', { body: verdict({ mode: 'shadow', label: null, mismatch: false, judgmentId: null }) }],
    ['on nhưng không lệch', { body: verdict({ mismatch: false }) }],
    ['ok:false', { body: { ok: false, reason: 'off' } }],
    ['HTTP 500', { status: 500, body: { error: 'boom' } }],
    ['HTTP 404 (server cũ chưa có route)', { status: 404, body: { error: 'no' } }],
    ['response sai dạng', { body: { ok: true, mode: 'on', label: 'vui', mismatch: 'có' } }],
    ['response không phải object', { body: 'xin chào' }],
  ])('%s: gửi ngay như cũ, không hỏi lại', async (_name, reply) => {
    const s = mockServer({ ...base, [`POST ${JUDGE}`]: reply });
    mount();
    const dialog = await writeNote('Yêu cầu sửa', 'Thiếu test cho ca lỗi');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gửi yêu cầu sửa' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(patches(s)[0].body).toEqual({ status: 'in_progress', comment: 'Thiếu test cho ca lỗi' });
    expect(screen.queryByTestId('jev-approval-confirm')).toBeNull();
    expect(outcomes(s)).toHaveLength(0);
  });

  it('Jev quá 1500 ms: hủy request và gửi như cũ', async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(api.jev, 'judgeApprovalNote').mockImplementation((_c, _b, sig) => {
      signal = sig;
      return new Promise(() => {});
    });
    const s = mockServer(base);
    mount();
    const dialog = await writeNote('Duyệt', 'Ổn, cho push');
    const started = Date.now();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1), { timeout: 4000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(signal?.aborted).toBe(true);
    expect(patches(s)[0].body).toEqual({ status: 'done', comment: 'Ổn, cho push' });
  });

  it('câu duyệt mặc định chưa sửa thì không gọi Jev', async () => {
    const s = mockServer({ ...base, [`POST ${JUDGE}`]: { body: verdict() } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(judgeCalls(s)).toHaveLength(0);
  });

  it('bấm gửi hai lần liên tiếp chỉ gọi Jev một lần và gửi một lần', async () => {
    let release: (v: unknown) => void = () => {};
    const spy = vi
      .spyOn(api.jev, 'judgeApprovalNote')
      .mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const s = mockServer(base);
    mount();
    const dialog = await writeNote('Duyệt', 'Ổn, cho push');
    const submit = within(dialog).getByRole('button', { name: 'Duyệt' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(spy).toHaveBeenCalledTimes(1);
    release({ ok: false, reason: 'off' });
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(patches(s)).toHaveLength(1);
  });

  it('đóng hộp lời nhắn trong lúc chờ Jev thì không gửi sau lưng người dùng', async () => {
    let release: (v: unknown) => void = () => {};
    vi.spyOn(api.jev, 'judgeApprovalNote').mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const s = mockServer(base);
    mount();
    const dialog = await writeNote('Duyệt', 'Ổn, cho push');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Đóng' })[0]);
    release({ ok: false, reason: 'off' });
    await new Promise((r) => setTimeout(r, 80));
    expect(patches(s)).toHaveLength(0);
  });
});
