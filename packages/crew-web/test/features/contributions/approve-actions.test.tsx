// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IssuePage } from '@/features/issues/detail/issue-page';
import { initI18n, setLanguage } from '@/i18n';
import { accessRoute, mockServer } from '../../app/fetch-mock';
import { AGENTS, ISSUE, mount, PROJECTS } from '../issues/detail-fixtures';
import { contribution, DIRECTORY, GUEST_ACCESS } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const CREW = '/api/crew/companies/c1/contributions';
const PENDING = contribution({ id: 'k1', body: 'Thêm ảnh minh họa', createdAt: '2026-10-10T02:00:00.000Z' });

function server(items = [PENDING], extra: Record<string, unknown> = {}, access?: Record<string, unknown>) {
  return mockServer({
    ...(access ? accessRoute('c1', access) : {}),
    'GET /api/issues/TPS-2': { body: ISSUE },
    'GET /api/issues/i1/comments': { body: [] },
    'GET /api/issues/i1/attachments': { body: [] },
    'GET /api/issues/i1/documents': { body: [] },
    'GET /api/issues/i1/runs': { body: [] },
    'GET /api/issues/i1/live-runs': { body: [] },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/issues': { body: [] },
    'GET /api/companies/c1/user-directory': { body: DIRECTORY },
    [`GET ${CREW}`]: { body: { items } },
    ...extra,
  } as Parameters<typeof mockServer>[0]);
}

const approveOk = {
  [`POST ${CREW}/k1/approve`]: {
    body: {
      contribution: { ...PENDING, status: 'approving' },
      materialize: { kind: 'comment', issueId: 'i1', body: 'Thêm ảnh minh họa', clientRequestId: 'k1' },
    },
  },
  'POST /api/issues/i1/comments': { status: 201, body: { id: 'cm-new', body: 'Thêm ảnh minh họa' } },
  [`POST ${CREW}/k1/approve/complete`]: { body: { ...PENDING, status: 'approved', resultCommentId: 'cm-new' } },
};

describe('owner duyệt, từ chối bình luận góp ý trong luồng bình luận', () => {
  it('Duyệt chạy đủ ba bước theo thứ tự, bình luận đăng với clientRequestId = id mục', async () => {
    const { calls } = server([PENDING], approveOk);
    mount(<IssuePage />);
    const item = await screen.findByTestId('pending-comment');
    fireEvent.click(within(item).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/approve/complete'))).toBe(true));
    const writes = calls
      .filter((c) => c.method === 'POST' && (c.url.includes('/contributions/') || c.url.endsWith('/comments')))
      .map((c) => c.url);
    expect(writes).toEqual([`${CREW}/k1/approve`, '/api/issues/i1/comments', `${CREW}/k1/approve/complete`]);
    expect(calls.find((c) => c.url === '/api/issues/i1/comments')?.body).toEqual({
      body: 'Thêm ảnh minh họa',
      clientRequestId: 'k1',
    });
  });

  it('bước đăng lỗi: hiện lỗi nguyên văn, không gọi complete', async () => {
    const { calls } = server([PENDING], {
      ...approveOk,
      'POST /api/issues/i1/comments': { status: 500, body: { error: 'Máy chủ bận' } },
    });
    mount(<IssuePage />);
    const item = await screen.findByTestId('pending-comment');
    fireEvent.click(within(item).getByRole('button', { name: 'Duyệt' }));
    expect(await screen.findByText('Máy chủ bận')).toBeTruthy();
    expect(screen.getByText('Không duyệt được')).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/approve/complete'))).toBe(false);
  });

  it('owner khác đang giữ khóa: báo câu tiếng Việt dễ hiểu, không đăng gì', async () => {
    const { calls } = server([PENDING], {
      [`POST ${CREW}/k1/approve`]: {
        status: 409,
        body: { error: 'locked', code: 'crew_contribution_locked', contribution: { ...PENDING, status: 'approving' } },
      },
    });
    mount(<IssuePage />);
    const item = await screen.findByTestId('pending-comment');
    fireEvent.click(within(item).getByRole('button', { name: 'Duyệt' }));
    expect(await screen.findByText(/Một owner khác đang duyệt mục này/)).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/issues/i1/comments' && c.method === 'POST')).toBe(false);
  });

  it('mục đang duyệt dở: nhãn Đang duyệt dở, nút Duyệt lại và Từ chối', async () => {
    server([{ ...PENDING, status: 'approving' }]);
    mount(<IssuePage />);
    const item = await screen.findByTestId('pending-comment');
    expect(await within(item).findByText('Đang duyệt dở')).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Duyệt lại' })).toBeTruthy();
    expect(within(item).getByRole('button', { name: 'Từ chối' })).toBeTruthy();
  });

  it('Từ chối hỏi xác nhận trước rồi mới gọi reject', async () => {
    const { calls } = server([PENDING], {
      [`POST ${CREW}/k1/reject`]: { body: { ...PENDING, status: 'rejected' } },
    });
    mount(<IssuePage />);
    const item = await screen.findByTestId('pending-comment');
    fireEvent.click(within(item).getByRole('button', { name: 'Từ chối' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Từ chối mục góp ý?')).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/reject'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === `${CREW}/k1/reject`)).toBe(true));
  });

  it('từ chối khi mục đã được duyệt: báo câu dễ hiểu và cập nhật mục theo server', async () => {
    const approved = { ...PENDING, status: 'approved' as const, resultCommentId: 'cm-x' };
    let current = PENDING;
    server([PENDING], {
      [`GET ${CREW}`]: () => ({ body: { items: [current] } }),
      [`POST ${CREW}/k1/reject`]: () => {
        current = approved;
        return {
          status: 409,
          body: { error: 'approved', code: 'crew_contribution_already_approved', contribution: approved },
        };
      },
    });
    mount(<IssuePage />);
    const item = await screen.findByTestId('pending-comment');
    fireEvent.click(within(item).getByRole('button', { name: 'Từ chối' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Từ chối' }));
    // Mục đã duyệt không còn là bình luận chờ nên rời khỏi luồng chờ.
    await waitFor(() => expect(screen.queryByTestId('pending-comment')).toBeNull());
  });

  it('khách không có nút nào', async () => {
    server([PENDING], {}, GUEST_ACCESS);
    mount(<IssuePage />);
    await screen.findByTestId('pending-comment');
    expect(screen.queryByTestId('contribution-actions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
  });
});
