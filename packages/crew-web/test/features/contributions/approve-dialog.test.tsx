// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ContributionPopupHost } from '@/features/contributions';
import { ContributionActions } from '@/features/contributions/contribution-actions';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { wrap } from '../issues/detail-fixtures';
import { contribution, DIRECTORY, holdPost } from './fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const CREW = '/api/crew/companies/c1/contributions';
const ITEM = contribution({
  id: 'k1',
  kind: 'issue',
  projectId: 'p1',
  targetIssueId: null,
  title: 'Cần banner mới',
  body: 'Banner cho chiến dịch tháng 11',
});

const ROLES = {
  assistantAgentId: 'a-assistant',
  executorAgentIds: ['a-exec'],
  reviewerAgentId: 'a-rev',
  integratorAgentId: 'a-int',
};

function server(extra: Record<string, unknown> = {}) {
  return mockServer({
    'GET /api/companies/c1/projects': { body: [{ id: 'p1', name: 'Alpha', archivedAt: null }] },
    'GET /api/companies/c1/agents': {
      body: [
        { id: 'a-assistant', name: 'Trợ Lý Alpha' },
        { id: 'a-exec', name: 'Executor Alpha' },
      ],
    },
    'GET /api/companies/c1/labels': { body: [] },
    'GET /api/companies/c1/user-directory': { body: DIRECTORY },
    'GET /api/plugins/crew.core/api/projects/p1/roles': { body: { roles: ROLES } },
    [`POST ${CREW}/k1/approve`]: {
      body: {
        contribution: { ...ITEM, status: 'approving' },
        materialize: {
          kind: 'issue',
          companyId: 'c1',
          projectId: 'p1',
          title: 'Cần banner mới',
          description: 'Banner cho chiến dịch tháng 11',
          idempotencyKey: 'crew-contribution:k1',
        },
      },
    },
    'POST /api/companies/c1/issues': { status: 201, body: { id: 'i-new', identifier: 'TPS-9' } },
    [`POST ${CREW}/k1/approve/complete`]: { body: { ...ITEM, status: 'approved', resultIssueId: 'i-new' } },
    ...extra,
  } as Parameters<typeof mockServer>[0]);
}

/** Mở dialog duyệt từ nút Duyệt của dòng (dòng và dialog dùng chung một mutation). */
const open = async () => {
  render(
    wrap(
      <MemoryRouter>
        <ContributionActions contribution={ITEM} />
        <ContributionPopupHost />
      </MemoryRouter>,
    ),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Duyệt: Cần banner mới' }));
  return screen.findByRole('dialog');
};

const assigneeReady = () =>
  waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Agent nhận việc' }).textContent).toContain('Trợ Lý Alpha'),
  );

describe('dialog duyệt yêu cầu góp ý', () => {
  it('hiện nội dung nguyên văn, người gửi; agent nhận việc mặc định là Trợ Lý của project', async () => {
    server();
    const dialog = await open();
    expect(within(dialog).getByText('Cần banner mới')).toBeTruthy();
    expect(await screen.findByText(/Lan Marketing/)).toBeTruthy();
    const assignee = await screen.findByRole('combobox', { name: 'Agent nhận việc' });
    await waitFor(() => expect(assignee.textContent).toContain('Trợ Lý Alpha'));
    expect(screen.getByRole('combobox', { name: 'Project' }).textContent).toContain('Alpha');
  });

  it('Lưu nháp: tạo issue backlog qua route stock với idempotencyKey, rồi complete', async () => {
    const { calls } = server();
    await open();
    await assigneeReady();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    // Xong thì dialog tự đóng.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const create = calls.find((c) => c.method === 'POST' && c.url === '/api/companies/c1/issues');
    expect(create?.body).toEqual({
      title: 'Cần banner mới',
      description: 'Banner cho chiến dịch tháng 11',
      projectId: 'p1',
      assigneeAgentId: 'a-assistant',
      status: 'backlog',
      idempotencyKey: 'crew-contribution:k1',
      allowDuplicate: true,
    });
    const order = calls
      .filter((c) => c.method === 'POST' && !c.url.startsWith('/api/plugins/crew.core/data/'))
      .map((c) => c.url);
    expect(order).toEqual([`${CREW}/k1/approve`, '/api/companies/c1/issues', `${CREW}/k1/approve/complete`]);
  });

  it('không nháp thì issue là todo (agent được đánh thức như board đăng)', async () => {
    const { calls } = server();
    await open();
    await assigneeReady();
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(calls.some((c) => c.url === `${CREW}/k1/approve/complete`)).toBe(true));
    expect(calls.find((c) => c.url === '/api/companies/c1/issues' && c.method === 'POST')?.body).toMatchObject({
      status: 'todo',
      allowDuplicate: true,
    });
  });

  it('complete trả 409 chưa thấy bản ghi: dialog báo bấm Duyệt lại, không đóng', async () => {
    server({
      [`POST ${CREW}/k1/approve/complete`]: {
        status: 409,
        body: {
          error: 'chưa thấy',
          code: 'crew_contribution_not_materialized',
          contribution: { ...ITEM, status: 'approving' },
        },
      },
    });
    const dialog = await open();
    await assigneeReady();
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(await within(dialog).findByText('Chưa thấy bản ghi đã đăng, bấm Duyệt lại.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('project chưa có Trợ Lý: báo chọn agent, nút Duyệt tắt', async () => {
    server({ 'GET /api/plugins/crew.core/api/projects/p1/roles': { status: 404, body: { error: 'không có' } } });
    await open();
    expect(await screen.findByText('Project chưa có Trợ Lý, hãy chọn agent nhận việc.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Duyệt' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('đang duyệt: không đóng được dialog (Esc, Hủy), có vòng xoay; đóng sau khi xong thì Từ chối mới mở lại', async () => {
    const { calls } = server();
    const release = holdPost('/api/companies/c1/issues');
    const dialog = await open();
    await assigneeReady();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duyệt' }));
    const submitting = await within(dialog).findByRole('button', { name: 'Đang duyệt' });
    expect(submitting.getAttribute('aria-busy')).toBe('true');
    expect(submitting.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect((within(dialog).getByRole('button', { name: 'Hủy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Nút của dòng (sau dialog) cũng bị khóa trong lúc này.
    const rowReject = screen.getByRole('button', {
      name: 'Từ chối: Cần banner mới',
      hidden: true,
    }) as HTMLButtonElement;
    expect(rowReject.disabled).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/reject'))).toBe(false);
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.some((c) => c.url === `${CREW}/k1/approve/complete`)).toBe(true);
  });

  it('Duyệt lại mà issue đã tạo từ lần trước: dialog đóng, báo đã duyệt, không tạo issue lại', async () => {
    const approved = { ...ITEM, status: 'approved' as const, resultIssueId: 'i-old' };
    const { calls } = server({
      [`POST ${CREW}/k1/approve`]: {
        status: 409,
        body: { error: 'đã duyệt', code: 'crew_contribution_decided', contribution: approved },
      },
    });
    await open();
    await assigneeReady();
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findByTestId('contribution-notice')).getAttribute('data-kind')).toBe('alreadyPosted');
    expect(screen.queryByText('Không duyệt được')).toBeNull();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/companies/c1/issues')).toBe(false);
  });

  it('không tải được project hay agent: báo lỗi kèm Thử lại thay vì để ô chọn trống', async () => {
    server({
      'GET /api/companies/c1/projects': { status: 500, body: { error: 'hỏng project' } },
      'GET /api/companies/c1/agents': { status: 500, body: { error: 'hỏng agent' } },
    });
    const dialog = await open();
    expect(await within(dialog).findByText('Không tải được danh sách project')).toBeTruthy();
    expect(await within(dialog).findByText('Không tải được danh sách agent')).toBeTruthy();
  });
});
