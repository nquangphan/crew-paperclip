import { describe, expect, it } from 'vitest';
import { guideRoleFor, previewRole } from '@/features/guide/guide-roles';

const access = (over: Partial<Parameters<typeof guideRoleFor>[0]> = {}) => ({
  isOwner: false,
  isContributor: false,
  membershipRole: null,
  loading: false,
  error: null,
  ...over,
});

describe('guideRoleFor', () => {
  it('chọn bản theo vai trò đăng nhập', () => {
    expect(guideRoleFor(access({ isOwner: true, membershipRole: 'owner' }))).toBe('owner');
    expect(guideRoleFor(access({ membershipRole: 'admin' }))).toBe('operator');
    expect(guideRoleFor(access({ membershipRole: 'operator' }))).toBe('operator');
    expect(guideRoleFor(access({ membershipRole: 'viewer' }))).toBe('viewer');
    expect(guideRoleFor(access({ membershipRole: 'viewer', isContributor: true }))).toBe('contributor');
  });
  it('đang tải thì chưa chọn; lỗi tải hoặc không có membership thì bản việc hằng ngày', () => {
    expect(guideRoleFor(access({ loading: true }))).toBeNull();
    expect(guideRoleFor(access({ loading: true, error: new Error('x') }))).toBe('operator');
    expect(guideRoleFor(access())).toBe('operator');
  });
});

describe('previewRole', () => {
  it('chỉ owner xem thử bản khác, giá trị lạ bị bỏ qua', () => {
    expect(previewRole('owner', 'viewer')).toBe('viewer');
    expect(previewRole('owner', 'boss')).toBe('owner');
    expect(previewRole('owner', null)).toBe('owner');
    expect(previewRole('viewer', 'owner')).toBe('viewer');
    expect(previewRole('contributor', 'operator')).toBe('contributor');
  });
});
