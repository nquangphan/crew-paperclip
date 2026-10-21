// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { contribution } from '../contributions/fixtures';
import { AGENTS, ISSUE, mount, PROJECTS } from '../issues/detail-fixtures';
import { DIRECTORY, MARKETING_ACCESS, OWNER_ACCESS, QC_ACCESS, QC_LIST, qcState } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const DONE = { ...ISSUE, status: 'done', executionState: null, completedAt: '2026-10-21T03:00:00.000Z' };
const CREW = '/api/crew/companies/c1/contributions';

function server(access: Record<string, unknown>, states = [qcState()], extra: Record<string, unknown> = {}) {
  return mockServer({
    ...accessRoute('c1', access),
    'GET /api/issues/TPS-2': { body: DONE },
    'GET /api/issues/i1/comments': { body: [] },
    'GET /api/issues/i1/attachments': { body: [] },
    'GET /api/issues/i1/documents': { body: [] },
    'GET /api/issues/i1/runs': { body: [] },
    'GET /api/issues/i1/live-runs': { body: [] },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/issues': { body: [] },
    'GET /api/companies/c1/user-directory': { body: DIRECTORY },
    [`GET ${QC_LIST}`]: { body: { items: states } },
    [`GET ${CREW}`]: { body: { items: [], nextBefore: null } },
    ...extra,
  } as Parameters<typeof mockServer>[0]);
}

describe('yêu cầu của Phòng QC đã Xong trên trang chi tiết', () => {
  it('hiện Chờ QC duyệt thay cho Hoàn thành, người QC duyệt; QC thấy Xác nhận đạt và Chưa đạt', async () => {
    server(QC_ACCESS);
    mount(<IssuePage />);
    const panel = await screen.findByTestId('qc-panel');
    expect(panel.getAttribute('data-qc')).toBe('qc_awaiting');
    expect(within(panel).getByText('Người QC duyệt: Bạn')).toBeTruthy();
    expect(screen.getAllByText('Chờ QC duyệt').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('properties-panel')).queryByText('Hoàn thành')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Xác nhận đạt' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Chưa đạt' })).toBeTruthy();
  });

  it('Xác nhận đạt chỉ gọi route QC, không ghi yêu cầu hay bình luận; khối chuyển sang QC verified', async () => {
    const verified = qcState({ state: 'verified', verifiedByUserId: 'u-qc', verifiedAt: '2026-10-21T04:00:00.000Z' });
    let list = [qcState()];
    const { calls } = server(QC_ACCESS, undefined, {
      [`GET ${QC_LIST}`]: () => ({ body: { items: list } }),
      [`POST ${QC_LIST}/issues/i1/verify`]: () => {
        list = [verified];
        return { body: verified };
      },
    });
    mount(<IssuePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận đạt' }));
    await waitFor(() => expect(screen.getByTestId('qc-panel').getAttribute('data-qc')).toBe('qc_verified'));
    // Đọc data plugin cũng là POST (`/data/…`), không phải lệnh ghi.
    const writes = calls
      .filter((c) => c.method !== 'GET' && !c.url.includes('/api/plugins/crew.core/data/'))
      .map((c) => `${c.method} ${c.url}`);
    expect(writes).toEqual([`POST ${QC_LIST}/issues/i1/verify`]);
    expect(screen.queryByRole('button', { name: 'Xác nhận đạt' })).toBeNull();
    expect(screen.getAllByText('QC verified').length).toBeGreaterThan(0);
  });

  it('Chưa đạt: lý do bắt buộc, gửi góp ý kind reopen chờ owner duyệt', async () => {
    let list = [qcState()];
    const { calls } = server(QC_ACCESS, undefined, {
      [`GET ${QC_LIST}`]: () => ({ body: { items: list } }),
      [`POST ${CREW}`]: () => {
        list = [qcState({ reopenRequest: { id: 'k9', status: 'pending' } })];
        return {
          status: 201,
          body: contribution({ id: 'k9', kind: 'reopen', targetIssueId: 'i1', body: 'Nút lưu hỏng' }),
        };
      },
    });
    mount(<IssuePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chưa đạt' }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Gửi để owner duyệt' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Lý do'), { target: { value: '   ' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Lý do'), { target: { value: '  Nút lưu hỏng  ' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByTestId('qc-panel').getAttribute('data-qc')).toBe('qc_reopen'));
    expect(calls.find((c) => c.method === 'POST' && c.url === CREW)?.body).toEqual({
      kind: 'reopen',
      issueId: 'i1',
      body: 'Nút lưu hỏng',
    });
    expect(screen.getAllByText('Chờ owner duyệt mở lại').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Xác nhận đạt' })).toBeNull();
  });

  it('Phòng Marketing chỉ thấy trạng thái, không có nút', async () => {
    server(MARKETING_ACCESS);
    mount(<IssuePage />);
    const panel = await screen.findByTestId('qc-panel');
    expect(within(panel).getByText('Người QC duyệt: Hà QC')).toBeTruthy();
    expect(within(panel).queryByRole('button')).toBeNull();
  });

  it('owner: Xác nhận đạt thay QC; khi QC báo chưa đạt thì thấy lý do và duyệt/từ chối ngay tại đây', async () => {
    server(OWNER_ACCESS);
    mount(<IssuePage />);
    const panel = await screen.findByTestId('qc-panel');
    expect(within(panel).getByRole('button', { name: 'Xác nhận đạt' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Chưa đạt' })).toBeNull();
    cleanup();

    const reopen = contribution({
      id: 'k9',
      kind: 'reopen',
      targetIssueId: 'i1',
      authorUserId: 'u-qc',
      body: 'Nút lưu hỏng',
    });
    server(OWNER_ACCESS, [qcState({ reopenRequest: { id: 'k9', status: 'pending' } })], {
      [`GET ${CREW}?kind=reopen&issueId=i1`]: { body: { items: [reopen], nextBefore: null } },
    });
    mount(<IssuePage />);
    const request = await screen.findByTestId('qc-reopen-request');
    expect(await within(request).findByText('Nút lưu hỏng')).toBeTruthy();
    expect(within(request).getByRole('button', { name: /^Duyệt/ })).toBeTruthy();
    expect(within(request).getByRole('button', { name: /^Từ chối/ })).toBeTruthy();
    expect(within(screen.getByTestId('qc-panel')).queryByRole('button', { name: 'Xác nhận đạt' })).toBeNull();
  });

  it('yêu cầu không ở vòng QC: không có khối QC, trạng thái giữ Hoàn thành', async () => {
    server(OWNER_ACCESS, []);
    mount(<IssuePage />);
    expect(await within(await screen.findByTestId('properties-panel')).findByText('Hoàn thành')).toBeTruthy();
    expect(screen.queryByTestId('qc-panel')).toBeNull();
  });
});
