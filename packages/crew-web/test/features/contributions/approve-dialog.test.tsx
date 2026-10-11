// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApproveIssueDialog } from '@/features/contributions/approve-issue-dialog';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { wrap } from '../issues/detail-fixtures';
import { contribution, DIRECTORY } from './fixtures';

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

const open = (onApproved = vi.fn(), onOpenChange = vi.fn()) => {
  render(wrap(<ApproveIssueDialog contribution={ITEM} open onOpenChange={onOpenChange} onApproved={onApproved} />));
  return { onApproved, onOpenChange };
};

describe('dialog duyệt yêu cầu góp ý', () => {
  it('hiện nội dung nguyên văn, người gửi; agent nhận việc mặc định là Trợ Lý của project', async () => {
    server();
    open();
    expect(await screen.findByText('Cần banner mới')).toBeTruthy();
    expect(await screen.findByText(/Lan Marketing/)).toBeTruthy();
    const assignee = await screen.findByRole('combobox', { name: 'Agent nhận việc' });
    await waitFor(() => expect(assignee.textContent).toContain('Trợ Lý Alpha'));
    expect(screen.getByRole('combobox', { name: 'Project' }).textContent).toContain('Alpha');
  });

  it('Lưu nháp: tạo issue backlog qua route stock với idempotencyKey, rồi complete', async () => {
    const { calls } = server();
    const { onApproved, onOpenChange } = open();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Agent nhận việc' }).textContent).toContain('Trợ Lý Alpha'),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const create = calls.find((c) => c.method === 'POST' && c.url === '/api/companies/c1/issues');
    expect(create?.body).toEqual({
      title: 'Cần banner mới',
      description: 'Banner cho chiến dịch tháng 11',
      projectId: 'p1',
      assigneeAgentId: 'a-assistant',
      status: 'backlog',
      idempotencyKey: 'crew-contribution:k1',
    });
    const order = calls
      .filter((c) => c.method === 'POST' && !c.url.startsWith('/api/plugins/crew.core/data/'))
      .map((c) => c.url);
    expect(order).toEqual([`${CREW}/k1/approve`, '/api/companies/c1/issues', `${CREW}/k1/approve/complete`]);
  });

  it('không nháp thì issue là todo (agent được đánh thức như board đăng)', async () => {
    const { calls } = server();
    const { onApproved } = open();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Agent nhận việc' }).textContent).toContain('Trợ Lý Alpha'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(calls.find((c) => c.url === '/api/companies/c1/issues' && c.method === 'POST')?.body).toMatchObject({
      status: 'todo',
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
    const { onApproved } = open();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Agent nhận việc' }).textContent).toContain('Trợ Lý Alpha'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duyệt' }));
    expect(await screen.findByText('Chưa thấy bản ghi đã đăng, bấm Duyệt lại.')).toBeTruthy();
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('project chưa có Trợ Lý: báo chọn agent, nút Duyệt tắt', async () => {
    server({ 'GET /api/plugins/crew.core/api/projects/p1/roles': { status: 404, body: { error: 'không có' } } });
    open();
    expect(await screen.findByText('Project chưa có Trợ Lý, hãy chọn agent nhận việc.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Duyệt' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
