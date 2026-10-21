import { describe, expect, it, vi } from 'vitest';
import type { CompanyInvite, CompanyMember, JoinRequest } from '@/api';
import {
  approveJoin,
  displayRole,
  inviteDepartment,
  inviteLink,
  inviteProjectIds,
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
const QC = { crew: { role: 'contributor', department: 'qc' } };
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
    expect(isContributorInvite(invite({ defaultsPayload: QC }))).toBe(true);
  });
});

describe('inviteDepartment', () => {
  it('lời mời khách có department qc là Phòng QC; marketing, thiếu hay lạ là Phòng Marketing', () => {
    expect(inviteDepartment(invite({ defaultsPayload: QC }))).toBe('qc');
    expect(
      inviteDepartment(invite({ defaultsPayload: { crew: { role: 'contributor', department: 'marketing' } } })),
    ).toBe('marketing');
    expect(inviteDepartment(invite({ defaultsPayload: CONTRIBUTOR }))).toBe('marketing');
    expect(inviteDepartment(invite({ defaultsPayload: { crew: { role: 'contributor', department: 'sales' } } }))).toBe(
      'marketing',
    );
  });
  it('không phải lời mời khách góp ý thì null, kể cả khi có department', () => {
    expect(inviteDepartment(invite({ defaultsPayload: { crew: { department: 'qc' } } }))).toBeNull();
    expect(inviteDepartment(invite({ defaultsPayload: null }))).toBeNull();
    expect(inviteDepartment(undefined)).toBeNull();
  });
});

describe('inviteProjectIds', () => {
  it('đọc defaultsPayload.crew.projectIds, bỏ trùng và phần tử không phải chuỗi', () => {
    const payload = { crew: { role: 'contributor', projectIds: ['p1', 'p2', 'p1', 3, null, ''] } };
    expect(inviteProjectIds(invite({ defaultsPayload: payload }))).toEqual(['p1', 'p2']);
  });
  it('không phải mảng, thiếu crew hoặc không có lời mời thì rỗng', () => {
    expect(inviteProjectIds(invite({ defaultsPayload: { crew: { projectIds: 'p1' } } }))).toEqual([]);
    expect(inviteProjectIds(invite({ defaultsPayload: { crew: ['p1'] } }))).toEqual([]);
    expect(inviteProjectIds(invite({ defaultsPayload: CONTRIBUTOR }))).toEqual([]);
    expect(inviteProjectIds(invite({ defaultsPayload: null }))).toEqual([]);
    expect(inviteProjectIds(undefined)).toEqual([]);
  });
});

describe('pendingJoins', () => {
  it('nối yêu cầu với lời mời bằng inviteId và chỉ giữ yêu cầu của người đang chờ', () => {
    const invites = [
      invite({ id: 'inv1', defaultsPayload: CONTRIBUTOR }),
      invite({ id: 'inv2' }),
      invite({ id: 'inv3', defaultsPayload: QC }),
    ];
    const joins = pendingJoins(
      [
        request({ id: 'a', inviteId: 'inv1' }),
        request({ id: 'b', inviteId: 'inv2' }),
        request({ id: 'q', inviteId: 'inv3' }),
        request({ id: 'c', inviteId: 'missing' }),
        request({ id: 'd', status: 'approved' }),
        request({ id: 'e', requestType: 'agent' }),
      ],
      invites,
    );
    expect(joins.map((j) => [j.request.id, j.department, j.inviteFound])).toEqual([
      ['a', 'marketing', true],
      ['b', null, true],
      ['q', 'qc', true],
      ['c', null, false],
    ]);
  });

  it('mang project chọn sẵn của lời mời; không tìm thấy lời mời thì rỗng', () => {
    const invites = [invite({ id: 'inv1', defaultsPayload: { crew: { role: 'contributor', projectIds: ['p1'] } } })];
    const joins = pendingJoins([request({ id: 'a' }), request({ id: 'c', inviteId: 'missing' })], invites);
    expect(joins.map((j) => j.projectIds)).toEqual([['p1'], []]);
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
  it('viewer có dấu thành phòng của dấu, viewer thuần giữ nguyên', () => {
    expect(displayRole(member('viewer'), new Map([['u2', 'marketing']]))).toBe('marketing');
    expect(displayRole(member('viewer'), new Map([['u2', 'qc']]))).toBe('qc');
    expect(displayRole(member('viewer'), new Map())).toBe('viewer');
  });
  it('dấu không đổi role khác viewer', () => {
    expect(displayRole(member('operator'), new Map([['u2', 'qc']]))).toBe('operator');
    expect(displayRole(member('owner'), new Map())).toBe('owner');
    expect(displayRole(member(null), new Map())).toBe('other');
  });
});

describe('approveJoin', () => {
  const join = (
    contributor: boolean | 'qc',
    requestingUserId: string | null = 'u2',
    projectIds: string[] = [],
  ): PendingJoin => ({
    request: request({ requestingUserId }),
    department: contributor === 'qc' ? 'qc' : contributor ? 'marketing' : null,
    inviteFound: true,
    projectIds,
  });
  const okDeps = () => ({
    approve: vi.fn(async () => {}),
    enableContributor: vi.fn(async () => {}),
    setProjectAccess: vi.fn(async () => {}),
  });

  it('lời mời khách: duyệt rồi bật dấu theo đúng thứ tự', async () => {
    const order: string[] = [];
    const deps = {
      approve: vi.fn(async (id: string) => void order.push(`approve:${id}`)),
      enableContributor: vi.fn(async (id: string, department: string) => void order.push(`enable:${id}:${department}`)),
      setProjectAccess: vi.fn(async () => {}),
    };
    expect(await approveJoin(join(true), deps)).toEqual({});
    expect(order).toEqual(['approve:jr1', 'enable:u2:marketing']);
    expect(deps.setProjectAccess).not.toHaveBeenCalled();
  });

  it('lời mời Phòng QC: bật dấu với đúng phòng qc', async () => {
    const deps = okDeps();
    expect(await approveJoin(join('qc', 'u2', ['p1']), deps)).toEqual({});
    expect(deps.enableContributor).toHaveBeenCalledWith('u2', 'qc');
    expect(deps.setProjectAccess).toHaveBeenCalledWith('u2', ['p1']);
  });

  it('lời mời có project chọn sẵn: duyệt, bật dấu rồi cấp đúng các project', async () => {
    const order: string[] = [];
    const deps = {
      approve: vi.fn(async (id: string) => void order.push(`approve:${id}`)),
      enableContributor: vi.fn(async (id: string) => void order.push(`enable:${id}`)),
      setProjectAccess: vi.fn(async (id: string, ids: string[]) => void order.push(`access:${id}:${ids.join(',')}`)),
    };
    expect(await approveJoin(join(true, 'u2', ['p1', 'p2']), deps)).toEqual({});
    expect(order).toEqual(['approve:jr1', 'enable:u2', 'access:u2:p1,p2']);
  });

  it('cấp project lỗi: không ném, trả accessError, dấu vẫn đã bật', async () => {
    const deps = {
      ...okDeps(),
      setProjectAccess: vi.fn(async () => {
        throw new Error('crew_project_access_invalid');
      }),
    };
    const out = await approveJoin(join(true, 'u2', ['p1']), deps);
    expect(out.accessError?.message).toBe('crew_project_access_invalid');
    expect(out.markError).toBeUndefined();
    expect(deps.enableContributor).toHaveBeenCalledWith('u2', 'marketing');
  });

  it('bật dấu lỗi vẫn thử cấp project, trả cả hai lỗi riêng', async () => {
    const deps = {
      ...okDeps(),
      enableContributor: vi.fn(async () => {
        throw new Error('crew_contributor_requires_viewer');
      }),
    };
    const out = await approveJoin(join(true, 'u2', ['p1']), deps);
    expect(out.markError?.message).toBe('crew_contributor_requires_viewer');
    expect(out.accessError).toBeUndefined();
    expect(deps.setProjectAccess).toHaveBeenCalledWith('u2', ['p1']);
  });

  it('lời mời thường: chỉ duyệt, không bật dấu', async () => {
    const deps = okDeps();
    expect(await approveJoin(join(false), deps)).toEqual({});
    expect(deps.enableContributor).not.toHaveBeenCalled();
    expect(deps.setProjectAccess).not.toHaveBeenCalled();
  });

  it('bước hai lỗi: không ném, trả lỗi để UI báo', async () => {
    const deps = {
      ...okDeps(),
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
      setProjectAccess: vi.fn(async () => {}),
    };
    await expect(approveJoin(join(true, 'u2', ['p1']), deps)).rejects.toThrow('boom');
    expect(deps.enableContributor).not.toHaveBeenCalled();
    expect(deps.setProjectAccess).not.toHaveBeenCalled();
  });

  it('thiếu userId của người xin tham gia: duyệt xong nhưng báo lỗi bật dấu và cấp project', async () => {
    const deps = okDeps();
    const out = await approveJoin(join(true, null, ['p1']), deps);
    expect(out.markError).toBeInstanceOf(Error);
    expect(out.accessError).toBeInstanceOf(Error);
    expect(deps.enableContributor).not.toHaveBeenCalled();
    expect(deps.setProjectAccess).not.toHaveBeenCalled();
  });
});
