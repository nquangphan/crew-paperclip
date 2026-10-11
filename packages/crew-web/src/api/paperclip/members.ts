// Thành viên, lời mời, yêu cầu tham gia của company (route stock Paperclip, chỉ owner gọi được).
import { call } from '../endpoints';

export interface MemberUser {
  id: string;
  name: string | null;
  email: string | null;
  image?: string | null;
}

export interface CompanyMember {
  id: string;
  /** User id của thành viên (khớp `userId` ở dấu khách góp ý). */
  principalId: string;
  membershipRole: string | null;
  status: string;
  user: MemberUser | null;
}

export interface CompanyInvite {
  id: string;
  state: 'active' | 'revoked' | 'accepted' | 'expired';
  humanRole: string | null;
  allowedJoinTypes: string;
  expiresAt: string;
  createdAt: string;
  /** Giữ nguyên bản ghi tự do của lời mời; khách góp ý có `crew.role = 'contributor'`. */
  defaultsPayload: Record<string, unknown> | null;
}

export interface CreatedInvite extends CompanyInvite {
  token: string;
}

export interface JoinRequest {
  id: string;
  inviteId: string;
  requestType: string;
  status: 'pending_approval' | 'approved' | 'rejected';
  requestingUserId: string | null;
  createdAt: string;
  requesterUser: MemberUser | null;
}

export interface DirectoryEntry {
  principalId: string;
  status: string;
  user: MemberUser | null;
}

export const membersApi = {
  members: async (companyId: string): Promise<CompanyMember[]> => {
    const res: { members: CompanyMember[] } = await call('members.list', { companyId });
    return res.members;
  },
  /** Tên hiển thị của mọi thành viên đang hoạt động; viewer cũng đọc được. */
  userDirectory: async (companyId: string): Promise<DirectoryEntry[]> => {
    const res: { users: DirectoryEntry[] } = await call('members.directory', { companyId });
    return res.users;
  },
};

export const invitesApi = {
  /** Lời mời khách góp ý: viewer kèm `defaultsPayload.crew.role = 'contributor'`. */
  createContributor: (companyId: string): Promise<CreatedInvite> =>
    call(
      'invites.create',
      { companyId },
      {
        body: {
          allowedJoinTypes: 'human',
          humanRole: 'viewer',
          defaultsPayload: { crew: { role: 'contributor' } },
        },
      },
    ),
  /**
   * Mọi lời mời của company (mới nhất trước), đọc hết các trang theo `nextOffset`, để nối được yêu cầu tham gia với lời
   * mời cũ. Dừng ở `maxPages` trang (100 lời mời mỗi trang) để một company bất thường không làm treo trang.
   */
  listAll: async (companyId: string, maxPages = 50): Promise<CompanyInvite[]> => {
    const all: CompanyInvite[] = [];
    let offset: number | null = 0;
    for (let page = 0; offset !== null && page < maxPages; page += 1) {
      const res: { invites: CompanyInvite[]; nextOffset: number | null } = await call(
        'invites.list',
        { companyId },
        { query: { limit: 100, offset } },
      );
      all.push(...res.invites);
      offset = typeof res.nextOffset === 'number' ? res.nextOffset : null;
    }
    return all;
  },
  revoke: (inviteId: string): Promise<CompanyInvite> => call('invites.revoke', { inviteId }),
};

export const joinRequestsApi = {
  list: (companyId: string, status?: JoinRequest['status']): Promise<JoinRequest[]> =>
    call('joinRequests.list', { companyId }, { query: { status } }),
  approve: (companyId: string, requestId: string): Promise<JoinRequest> =>
    call('joinRequests.approve', { companyId, requestId }),
  reject: (companyId: string, requestId: string): Promise<JoinRequest> =>
    call('joinRequests.reject', { companyId, requestId }),
};

export const __endpoints = [
  'invites.create',
  'invites.list',
  'invites.revoke',
  'joinRequests.approve',
  'joinRequests.list',
  'joinRequests.reject',
  'members.directory',
  'members.list',
];
