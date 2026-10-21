import type { QcIssueState } from '@/api';

export const QC_ACCESS = {
  userId: 'u-qc',
  membershipRole: 'viewer',
  contributor: true,
  department: 'qc',
  canApprove: false,
};
export const MARKETING_ACCESS = { ...QC_ACCESS, userId: 'u-mk', department: 'marketing' };
export const OWNER_ACCESS = {
  userId: 'u1',
  membershipRole: 'owner',
  contributor: false,
  department: null,
  canApprove: true,
};

/** Vòng QC đang mở theo hợp đồng `GET /qc` của router Crew. */
export const qcState = (over: Partial<QcIssueState> = {}): QcIssueState => ({
  issueId: 'i1',
  identifier: 'TPS-1',
  title: 'Sửa form đăng ký',
  roundId: 'r1',
  state: 'awaiting',
  qcUserId: 'u-qc',
  startedAt: '2026-10-21T03:00:00.000Z',
  verifiedAt: null,
  verifiedByUserId: null,
  reopenRequest: null,
  ...over,
});

export const QC_LIST = '/api/crew/companies/c1/qc';

export const DIRECTORY = {
  users: [
    { principalId: 'u1', status: 'active', user: { id: 'u1', name: 'Owner', email: 'o@example.com' } },
    { principalId: 'u-qc', status: 'active', user: { id: 'u-qc', name: 'Hà QC', email: 'ha@example.com' } },
  ],
};
