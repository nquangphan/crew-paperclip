// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { queryKeys } from '@/api';
import { CompanyContext, MeContext } from '@/app/hooks';
import { ActionsSlot } from '@/features/issues/detail/crew/actions-slot';
import { useIssue } from '@/features/issues/detail/use-issue';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { COMPANY, ISSUE, ME } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

/** Trang thu gọn: lấy issue như IssuePage rồi gắn khe thao tác, để sự kiện trực tiếp (invalidate) render lại. */
function Harness() {
  const { data } = useIssue('TPS-2');
  return data ? <ActionsSlot issue={data} /> : null;
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

describe('ActionsSlot (S6.7, S6.8, S6.10, S6.11)', () => {
  it('owner đang ở stage duyệt thấy Duyệt, Yêu cầu sửa, Hủy yêu cầu', async () => {
    mockServer({ 'GET /api/issues/TPS-2': { body: ISSUE } });
    mountHarness();
    expect(await screen.findByRole('button', { name: 'Duyệt' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yêu cầu sửa' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hủy yêu cầu' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mở lại' })).toBeNull();
  });

  it('Duyệt gửi PATCH {status:"done", comment} và không gửi policy/assignee', async () => {
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: ISSUE },
      'PATCH /api/issues/i1': { body: { ...ISSUE, status: 'in_review' } },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    const dialog = await screen.findByRole('dialog');
    const box = within(dialog).getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Ổn, cho push' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(patches(s)[0].body).toEqual({ status: 'done', comment: 'Ổn, cho push' });
  });

  it('Yêu cầu sửa tắt nút gửi khi lý do dưới 5 ký tự, gửi {status:"in_progress", comment}', async () => {
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: ISSUE },
      'PATCH /api/issues/i1': { body: { ...ISSUE, status: 'in_progress' } },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Yêu cầu sửa' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Gửi yêu cầu sửa' }) as HTMLButtonElement;
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'abc' } });
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Thiếu test cho ca lỗi' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(patches(s)[0].body).toEqual({ status: 'in_progress', comment: 'Thiếu test cho ca lỗi' });
  });

  it('Hủy mở ConfirmDialog rồi gửi PATCH {status:"cancelled"}', async () => {
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: ISSUE },
      'PATCH /api/issues/i1': { body: { ...ISSUE, status: 'cancelled' } },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy yêu cầu' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(patches(s)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy yêu cầu' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(patches(s)[0].body).toEqual({ status: 'cancelled' });
  });

  it('bấm Không trong hộp xác nhận thì không hủy', async () => {
    const s = mockServer({ 'GET /api/issues/TPS-2': { body: ISSUE } });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy yêu cầu' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hủy' }));
    expect(patches(s)).toHaveLength(0);
  });

  it('server trả 422 thì hiện nguyên văn câu lỗi, không gọi lại API', async () => {
    const message = 'Crew: chưa đủ điều kiện để hoàn tất: docs_missing.';
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: ISSUE },
      'PATCH /api/issues/i1': { status: 422, body: { error: message } },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Hủy yêu cầu' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hủy yêu cầu' }));
    expect(await screen.findByText(message)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(patches(s)).toHaveLength(1);
  });

  it('server từ chối Duyệt (409) thì lỗi hiện trong hộp, giữ lời nhắn, không thử lại', async () => {
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: ISSUE },
      'PATCH /api/issues/i1': {
        status: 422,
        body: { error: 'Only the active reviewer or approver can advance the current execution stage' },
      },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Duyệt' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Ok' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    expect(
      await within(dialog).findByText('Only the active reviewer or approver can advance the current execution stage'),
    ).toBeTruthy();
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Ok');
    expect(patches(s)).toHaveLength(1);
  });

  it('issue đã xong chỉ có Mở lại, gửi {status:"todo"} sau xác nhận', async () => {
    const done = { ...ISSUE, status: 'done', executionState: null };
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: done },
      'PATCH /api/issues/i1': { body: { ...done, status: 'todo' } },
    });
    mountHarness();
    fireEvent.click(await screen.findByRole('button', { name: 'Mở lại' }));
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hủy yêu cầu' })).toBeNull();
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Mở lại' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    expect(patches(s)[0].body).toEqual({ status: 'todo' });
  });

  it('sự kiện trực tiếp đổi executionState thì nút Duyệt biến mất', async () => {
    let current: unknown = ISSUE;
    mockServer({ 'GET /api/issues/TPS-2': () => ({ body: current }) });
    const qc = mountHarness();
    await screen.findByRole('button', { name: 'Duyệt' });
    current = {
      ...ISSUE,
      assigneeAgentId: 'a3',
      executionState: {
        ...ISSUE.executionState,
        currentStageId: 's3',
        currentStageType: 'review',
        currentParticipant: { type: 'agent', agentId: 'a3' },
      },
    };
    await act(() => qc.invalidateQueries({ queryKey: queryKeys.issue('TPS-2') }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Hủy yêu cầu' })).toBeTruthy();
  });

  it('thành công thì làm mới issue (theo mã và uuid), danh sách và bình luận', async () => {
    const s = mockServer({
      'GET /api/issues/TPS-2': { body: ISSUE },
      'PATCH /api/issues/i1': { body: { ...ISSUE, status: 'cancelled' } },
    });
    const qc = mountHarness();
    await screen.findByRole('button', { name: 'Hủy yêu cầu' });
    const seen: string[] = [];
    qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'invalidate') seen.push(JSON.stringify(e.query.queryKey));
    });
    qc.setQueryData(queryKeys.issue('i1'), ISSUE);
    qc.setQueryData(queryKeys.issues('c1'), []);
    qc.setQueryData(queryKeys.comments('i1'), []);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy yêu cầu' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hủy yêu cầu' }));
    await waitFor(() => expect(patches(s)).toHaveLength(1));
    await waitFor(() => {
      expect(seen).toContain(JSON.stringify(queryKeys.issue('TPS-2')));
      expect(seen).toContain(JSON.stringify(queryKeys.issue('i1')));
      expect(seen).toContain(JSON.stringify(queryKeys.issues('c1')));
      expect(seen).toContain(JSON.stringify(queryKeys.comments('i1')));
    });
  });
});
