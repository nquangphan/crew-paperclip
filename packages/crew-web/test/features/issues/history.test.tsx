// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { History } from '@/features/issues/detail/history';
import { initI18n, setLanguage } from '@/i18n';
import { mockServer } from '../../app/fetch-mock';
import { ISSUE, mount } from './detail-fixtures';

beforeAll(async () => {
  await initI18n();
  await setLanguage('vi');
});
afterEach(cleanup);

const base = { companyId: 'c1', entityType: 'issue', entityId: 'i1', agentId: null, runId: null };
// GET /issues/:id/activity trả mới nhất trước.
const EVENTS = [
  {
    ...base,
    id: 'e3',
    actorType: 'plugin',
    actorId: 'plugin-1',
    action: 'crew.issue.force_done',
    details: { reason: 'Owner tự kiểm trên máy', violations: [], actorUserId: 'u1' },
    createdAt: '2026-10-10T03:00:02.000Z',
  },
  {
    ...base,
    id: 'e2',
    actorType: 'user',
    actorId: 'u1',
    action: 'crew.policy.board_override',
    details: { violations: ['stage_unapproved:s2', 'push_stale'], toStatus: 'done' },
    createdAt: '2026-10-10T03:00:01.000Z',
  },
  {
    ...base,
    id: 'e1',
    actorType: 'agent',
    actorId: 'a1',
    action: 'issue.comment_added',
    details: {},
    createdAt: '2026-10-10T01:00:00.000Z',
  },
];

describe('History (S6.18)', () => {
  it('hiện dòng gộp Ép Done có badge, lý do, cổng bỏ qua, người làm và giờ Việt Nam', async () => {
    mockServer({ 'GET /api/issues/i1/activity': { body: EVENTS } });
    mount(<History issue={ISSUE as never} agentNames={{ a1: 'Executor Alpha' }} />);
    const section = await screen.findByRole('region', { name: 'Lịch sử' });
    const rows = await within(section).findAllByTestId('history-row');
    expect(rows).toHaveLength(2);
    const forced = rows[0];
    expect(within(forced).getAllByText('Ép Done').length).toBeGreaterThan(0);
    expect(within(forced).getByText('Lý do: Owner tự kiểm trên máy')).toBeTruthy();
    expect(
      within(forced).getByText('Cổng bỏ qua: thiếu duyệt stage Owner duyệt (Bạn), push cũ hơn lần owner duyệt'),
    ).toBeTruthy();
    expect(within(forced).getByText('Bạn · 10/10/2026 10:00')).toBeTruthy();
    expect(within(rows[1]).getByText(/Executor Alpha/)).toBeTruthy();
    expect(within(rows[1]).getByText(/Bình luận/)).toBeTruthy();
  });

  it('chưa có hoạt động thì báo trống', async () => {
    mockServer({ 'GET /api/issues/i1/activity': { body: [] } });
    mount(<History issue={ISSUE as never} agentNames={{}} />);
    expect(await screen.findByText('Chưa có hoạt động nào.')).toBeTruthy();
  });

  it('lỗi tải hiện câu lỗi nguyên văn', async () => {
    mockServer({ 'GET /api/issues/i1/activity': { status: 500, body: { error: 'db down' } } });
    mount(<History issue={ISSUE as never} agentNames={{}} />);
    expect(await screen.findByText('db down')).toBeTruthy();
  });
});
