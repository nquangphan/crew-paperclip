import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api';
import {
  awaitingMe,
  canRequestReopen,
  canVerify,
  displayStatus,
  qcDisplayStatus,
  qcErrorKey,
} from '@/features/qc/qc-status';
import { qcState } from './fixtures';

const map = (...states: ReturnType<typeof qcState>[]) => new Map(states.map((s) => [s.issueId, s]));

describe('trạng thái QC hiển thị', () => {
  it('chỉ yêu cầu đã Xong có vòng QC mới đổi nhãn: chờ, chờ owner mở lại, verified', () => {
    expect(qcDisplayStatus({ id: 'i1', status: 'done' }, map(qcState()))).toBe('qc_awaiting');
    expect(
      qcDisplayStatus({ id: 'i1', status: 'done' }, map(qcState({ reopenRequest: { id: 'k1', status: 'pending' } }))),
    ).toBe('qc_reopen');
    expect(qcDisplayStatus({ id: 'i1', status: 'done' }, map(qcState({ state: 'verified' })))).toBe('qc_verified');
    // Đã mở lại (lõi không còn done) hoặc không do QC gửi: giữ trạng thái lõi.
    expect(qcDisplayStatus({ id: 'i1', status: 'todo' }, map(qcState()))).toBeNull();
    expect(qcDisplayStatus({ id: 'i2', status: 'done' }, map(qcState()))).toBeNull();
    expect(displayStatus({ id: 'i2', status: 'done' }, map(qcState()))).toBe('done');
    expect(displayStatus({ id: 'i1', status: 'done' }, map(qcState()))).toBe('qc_awaiting');
  });

  it('Cần tôi duyệt: chỉ vòng đang chờ của chính người QC', () => {
    const items = [
      qcState({ issueId: 'a' }),
      qcState({ issueId: 'b', qcUserId: 'u-other' }),
      qcState({ issueId: 'c', state: 'verified' }),
      qcState({ issueId: 'd', reopenRequest: { id: 'k', status: 'approving' } }),
    ];
    expect(awaitingMe(items, 'u-qc').map((s) => s.issueId)).toEqual(['a', 'd']);
  });

  it('quyền nút: người QC được giao và owner xác nhận; chỉ người QC báo chưa đạt; chờ owner thì khóa cả hai', () => {
    const qc = { userId: 'u-qc', isOwner: false, isContributor: true };
    const otherQc = { userId: 'u-qc2', isOwner: false, isContributor: true };
    const owner = { userId: 'u1', isOwner: true, isContributor: false };
    const viewer = { userId: 'u-qc', isOwner: false, isContributor: false };
    const waiting = qcState();
    expect([
      canVerify(waiting, qc),
      canVerify(waiting, owner),
      canVerify(waiting, otherQc),
      canVerify(waiting, viewer),
    ]).toEqual([true, true, false, false]);
    expect([
      canRequestReopen(waiting, qc),
      canRequestReopen(waiting, owner),
      canRequestReopen(waiting, otherQc),
    ]).toEqual([true, false, false]);
    const pending = qcState({ reopenRequest: { id: 'k', status: 'pending' } });
    expect([canVerify(pending, qc), canVerify(pending, owner), canRequestReopen(pending, qc)]).toEqual([
      false,
      false,
      false,
    ]);
    const verified = qcState({ state: 'verified' });
    expect([canVerify(verified, qc), canRequestReopen(verified, qc)]).toEqual([false, false]);
  });

  it('mã lỗi QC có câu riêng, lỗi khác hiện nguyên văn', () => {
    expect(qcErrorKey(new ApiError(409, 'x', 'crew_qc_reopen_pending'))).toBe('errors.crew_qc_reopen_pending');
    expect(qcErrorKey(new ApiError(500, 'x'))).toBeNull();
  });
});
