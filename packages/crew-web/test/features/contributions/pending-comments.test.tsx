// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
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

const REAL = [
  {
    id: 'cm1',
    authorType: 'user',
    authorAgentId: null,
    authorUserId: 'u1',
    body: 'Bình luận sớm',
    createdAt: '2026-10-10T01:00:00.000Z',
  },
  {
    id: 'cm2',
    authorType: 'user',
    authorAgentId: null,
    authorUserId: 'u1',
    body: 'Bình luận muộn',
    createdAt: '2026-10-10T03:00:00.000Z',
  },
];

const CONTRIBUTIONS = [
  contribution({ id: 'k1', body: 'Đang chờ', createdAt: '2026-10-10T02:00:00.000Z' }),
  contribution({ id: 'k2', status: 'rejected', body: 'Bị loại', createdAt: '2026-10-10T02:30:00.000Z' }),
  contribution({
    id: 'k3',
    status: 'approved',
    body: 'Muộn',
    createdAt: '2026-10-10T02:45:00.000Z',
    resultCommentId: 'cm2',
  }),
];

function server(access?: Record<string, unknown>, items = CONTRIBUTIONS) {
  return mockServer({
    ...(access ? accessRoute('c1', access) : {}),
    'GET /api/issues/TPS-2': { body: ISSUE },
    'GET /api/issues/i1/comments': { body: REAL },
    'GET /api/issues/i1/attachments': { body: [] },
    'GET /api/issues/i1/documents': { body: [] },
    'GET /api/issues/i1/runs': { body: [] },
    'GET /api/issues/i1/live-runs': { body: [] },
    'GET /api/companies/c1/agents': { body: AGENTS },
    'GET /api/companies/c1/projects': { body: PROJECTS },
    'GET /api/companies/c1/issues': { body: [] },
    'GET /api/companies/c1/user-directory': { body: DIRECTORY },
    'GET /api/crew/companies/c1/contributions': { body: { items } },
  } as Parameters<typeof mockServer>[0]);
}

describe('bình luận chờ trong luồng bình luận', () => {
  it('xếp xen theo giờ, có badge, không có nút Duyệt cho khách', async () => {
    const { calls } = server(GUEST_ACCESS);
    mount(<IssuePage />);
    const pending = await screen.findAllByTestId('pending-comment');
    expect(pending).toHaveLength(2);
    expect(within(pending[0]).getByText('Chờ duyệt')).toBeTruthy();
    expect(within(pending[1]).getByText('Bị từ chối')).toBeTruthy();
    expect(pending[0].textContent).toContain('Đang chờ');

    const order = [...document.querySelectorAll('[data-testid="comment"], [data-testid="pending-comment"]')].map(
      (el) => el.textContent ?? '',
    );
    expect(order).toHaveLength(4);
    expect(order[0]).toContain('Bình luận sớm');
    expect(order[1]).toContain('Đang chờ');
    expect(order[2]).toContain('Bị loại');
    expect(order[3]).toContain('Bình luận muộn');
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Từ chối' })).toBeNull();
    expect(calls.some((c) => c.url.includes('/contributions?issueId=i1'))).toBe(true);
  });

  it('bình luận thật sinh từ góp ý có chip tên người góp ý', async () => {
    server();
    mount(<IssuePage />);
    const chip = await screen.findByTestId('contribution-chip');
    expect(chip.textContent).toBe('Góp ý của Lan Marketing');
    const late = (await screen.findAllByTestId('comment'))[1];
    expect(within(late).getByTestId('contribution-chip')).toBeTruthy();
  });

  it('owner thấy bình luận chờ của khách với tên tác giả', async () => {
    server(undefined, [CONTRIBUTIONS[0]]);
    mount(<IssuePage />);
    const [item] = await screen.findAllByTestId('pending-comment');
    expect(item.textContent).toContain('Lan Marketing');
    expect(item.textContent).toContain('Chờ duyệt');
  });
});
