import { describe, expect, it } from 'vitest';
import type { QcIssueState } from '@/api';
import { AWAITING_OWNER, awaitingOwnerStatus, issueDisplayStatus } from '@/features/awaiting-owner';

const AWAITING = new Set(['i1']);
const qc = new Map<string, QcIssueState>([
  [
    'i1',
    {
      issueId: 'i1',
      identifier: 'TPS-1',
      title: 'x',
      roundId: 'r1',
      state: 'awaiting',
      qcUserId: 'u-qc',
      startedAt: '2026-11-01T00:00:00.000Z',
      verifiedAt: null,
      verifiedByUserId: null,
      reopenRequest: null,
    },
  ],
]);

describe('awaitingOwnerStatus', () => {
  it('issue chưa đóng có thẻ chờ owner: awaiting_owner, mọi trạng thái lõi', () => {
    for (const status of ['in_progress', 'blocked', 'in_review', 'todo', 'backlog']) {
      expect(awaitingOwnerStatus({ id: 'i1', status }, AWAITING)).toBe(AWAITING_OWNER);
    }
  });

  it('issue đã đóng hoặc không có thẻ chờ: null', () => {
    expect(awaitingOwnerStatus({ id: 'i1', status: 'done' }, AWAITING)).toBeNull();
    expect(awaitingOwnerStatus({ id: 'i1', status: 'cancelled' }, AWAITING)).toBeNull();
    expect(awaitingOwnerStatus({ id: 'i2', status: 'in_progress' }, AWAITING)).toBeNull();
  });
});

describe('issueDisplayStatus', () => {
  it('chờ owner thay cho trạng thái lõi; không có thì giữ lõi', () => {
    expect(issueDisplayStatus({ id: 'i1', status: 'in_progress' }, new Map(), AWAITING)).toBe('awaiting_owner');
    expect(issueDisplayStatus({ id: 'i2', status: 'blocked' }, new Map(), AWAITING)).toBe('blocked');
  });

  it('issue đã Xong vẫn theo trạng thái QC dù còn sót thẻ chờ', () => {
    expect(issueDisplayStatus({ id: 'i1', status: 'done' }, qc, AWAITING)).toBe('qc_awaiting');
    expect(issueDisplayStatus({ id: 'i1', status: 'done' }, new Map(), AWAITING)).toBe('done');
  });
});
