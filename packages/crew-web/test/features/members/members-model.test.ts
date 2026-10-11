import { describe, expect, it, vi } from 'vitest';
import type { CompanyInvite, CompanyMember, JoinRequest } from '@/api';
import {
  approveJoin,
  displayRole,
  inviteLink,
  isContributorInvite,
  type PendingJoin,
  pendingJoins,
} from '@/features/members/members-model';

const invite = (over: Partial<CompanyInvite>): CompanyInvite => ({
  id: 'inv1',
  state: 'active',
  humanRole: 'viewer',
  allowedJoinTypes: 'human',
  expiresAt: '2026-10-18T00:00:00.000Z',
  createdAt: '2026-10-11T00:00:00.000Z',
  defaultsPayload: null,
  ...over,
});
const CONTRIBUTOR = { crew: { role: 'contributor' } };
const request = (over: Partial<JoinRequest>): JoinRequest => ({
  id: 'jr1',
  inviteId: 'inv1',
  requestType: 'human',
  status: 'pending_approval',
  requestingUserId: 'u2',
  createdAt: '2026-10-11T01:00:00.000Z',
  requesterUser: null,
  ...over,
});

describe('inviteLink', () => {
  it('trỏ tới trang nhận lời mời của UI stock, không phải /invite/', () => {
    expect(inviteLink('https://crew.example.com', 'tok-1')).toBe('https://crew.example.com/paperclip/invite/tok-1');
  });
  it('mã hóa ký tự đặc biệt trong token', () => {
    expect(inviteLink('https://x', 'a/b?c')).toBe('https://x/paperclip/invite/a%2Fb%3Fc');
  });
});

describe('isContributorInvite', () => {
  it('chỉ đúng khi defaultsPayload.crew.role là contributor', () => {
    expect(isContributorInvite(invite({ defaultsPayload: CONTRIBUTOR }))).toBe(true);
    expect(isContributorInvite(invite({ defaultsPayload: { crew: { role: 'x' } } }))).toBe(false);
    expect(isContributorInvite(invite({ defaultsPayload: { crew: 'contributor' } }))).toBe(false);
    expect(isContributorInvite(invite({ defaultsPayload: null }))).toBe(false);
    expect(isContributorInvite(undefined)).toBe(false);
  });
});

describe('pendingJoins', () => {
  it('nối yêu cầu với lời mời bằng inviteId và chỉ giữ yêu cầu của người đang chờ', () => {
    const invites = [invite({ id: 'inv1', defaultsPayload: CONTRIBUTOR }), invite({ id: 'inv2' })];
    const joins = pendingJoins(
      [
        request({ id: 'a', inviteId: 'inv1' }),
        request({ id: 'b', inviteId: 'inv2' }),
        request({ id: 'c', inviteId: 'missing' }),
        request({ id: 'd', status: 'approved' }),
        request({ id: 'e', requestType: 'agent' }),
      ],
      invites,
    );
    expect(joins.map((j) => [j.request.id, j.contributor])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ]);
  });
});

describe('displayRole', () => {
  const member = (membershipRole: string | null, principalId = 'u2'): CompanyMember => ({
    id: 'm',
    principalId,
    membershipRole,
    status: 'active',
    user: null,
  });
  it('viewer có dấu thành contributor, viewer thuần giữ nguyên', () => {
    expect(displayRole(member('viewer'), new Set(['u2']))).toBe('contributor');
    expect(displayRole(member('viewer'), new Set())).toBe('viewer');
  });
  it('dấu không đổi role khác viewer', () => {
    expect(displayRole(member('operator'), new Set(['u2']))).toBe('operator');
    expect(displayRole(member('owner'), new Set())).toBe('owner');
    expect(displayRole(member(null), new Set())).toBe('other');
  });
});

describe('approveJoin', () => {
  const join = (contributor: boolean, requestingUserId: string | null = 'u2'): PendingJoin => ({
    request: request({ requestingUserId }),
    contributor,
  });

  it('lời mời khách: duyệt rồi bật dấu theo đúng thứ tự', async () => {
    const order: string[] = [];
    const deps = {
      approve: vi.fn(async (id: string) => void order.push(`approve:${id}`)),
      enableContributor: vi.fn(async (id: string) => void order.push(`enable:${id}`)),
    };
    expect(await approveJoin(join(true), deps)).toEqual({});
    expect(order).toEqual(['approve:jr1', 'enable:u2']);
  });

  it('lời mời thường: chỉ duyệt, không bật dấu', async () => {
    const deps = { approve: vi.fn(async () => {}), enableContributor: vi.fn(async () => {}) };
    expect(await approveJoin(join(false), deps)).toEqual({});
    expect(deps.enableContributor).not.toHaveBeenCalled();
  });

  it('bước hai lỗi: không ném, trả lỗi để UI báo', async () => {
    const deps = {
      approve: vi.fn(async () => {}),
      enableContributor: vi.fn(async () => {
        throw new Error('crew_contributor_requires_viewer');
      }),
    };
    const out = await approveJoin(join(true), deps);
    expect(out.markError?.message).toBe('crew_contributor_requires_viewer');
  });

  it('bước một lỗi: ném lỗi và không bật dấu', async () => {
    const deps = {
      approve: vi.fn(async () => {
        throw new Error('boom');
      }),
      enableContributor: vi.fn(async () => {}),
    };
    await expect(approveJoin(join(true), deps)).rejects.toThrow('boom');
    expect(deps.enableContributor).not.toHaveBeenCalled();
  });

  it('thiếu userId của người xin tham gia: duyệt xong nhưng báo lỗi bật dấu', async () => {
    const deps = { approve: vi.fn(async () => {}), enableContributor: vi.fn(async () => {}) };
    const out = await approveJoin(join(true, null), deps);
    expect(out.markError).toBeInstanceOf(Error);
    expect(deps.enableContributor).not.toHaveBeenCalled();
  });
});
