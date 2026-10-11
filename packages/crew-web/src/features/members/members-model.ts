// crew: tự dựng
import type { CompanyInvite, CompanyMember, JoinRequest, MemberUser } from '@/api';

/** Role lời mời mang dấu Phòng Marketing: `defaultsPayload.crew.role = 'contributor'`. */
export function isContributorInvite(invite: Pick<CompanyInvite, 'defaultsPayload'> | undefined): boolean {
  const crew = invite?.defaultsPayload?.crew;
  return typeof crew === 'object' && crew !== null && (crew as { role?: unknown }).role === 'contributor';
}

/** Link gửi cho khách: trang nhận lời mời nằm ở UI stock `/paperclip/`, không phải `/invite/` của UI Crew. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/paperclip/invite/${encodeURIComponent(token)}`;
}

/** Yêu cầu tham gia của người đang chờ duyệt, kèm cờ "lời mời khách góp ý" (nối bằng `inviteId`). */
export interface PendingJoin {
  request: JoinRequest;
  contributor: boolean;
}

/** Chỉ lấy yêu cầu của người (không phải agent) đang chờ duyệt, nối với lời mời của nó. */
export function pendingJoins(requests: JoinRequest[], invites: CompanyInvite[]): PendingJoin[] {
  const byId = new Map(invites.map((i) => [i.id, i]));
  return requests
    .filter((r) => r.status === 'pending_approval' && r.requestType === 'human')
    .map((request) => ({ request, contributor: isContributorInvite(byId.get(request.inviteId)) }));
}

export type MemberRole = 'owner' | 'admin' | 'operator' | 'viewer' | 'contributor' | 'other';

/** Role hiển thị: viewer có dấu hiện thành `contributor` (Phòng Marketing). */
export function displayRole(member: CompanyMember, contributorIds: ReadonlySet<string>): MemberRole {
  const role = member.membershipRole;
  if (role === 'viewer') return contributorIds.has(member.principalId) ? 'contributor' : 'viewer';
  return role === 'owner' || role === 'admin' || role === 'operator' ? role : 'other';
}

export function personName(user: MemberUser | null | undefined, fallbackId: string | null): string {
  return user?.name?.trim() || user?.email || fallbackId || '';
}

export interface ApproveDeps {
  approve: (requestId: string) => Promise<unknown>;
  enableContributor: (userId: string) => Promise<unknown>;
}

export interface ApproveOutcome {
  /** Lỗi ở bước bật dấu (đã duyệt tham gia nhưng người đó mới chỉ là viewer thuần); undefined khi trọn vẹn. */
  markError?: Error;
}

/**
 * Duyệt yêu cầu tham gia; nếu là lời mời khách góp ý thì bật dấu ngay sau đó. Bước một lỗi thì ném lỗi (chưa có gì
 * thay đổi). Bước hai lỗi thì người đó đã là viewer thuần (đóng khi lỗi), trả lỗi để UI báo và giữ nút "Đặt Phòng Marketing".
 */
export async function approveJoin(join: PendingJoin, deps: ApproveDeps): Promise<ApproveOutcome> {
  await deps.approve(join.request.id);
  const userId = join.request.requestingUserId;
  if (!join.contributor) return {};
  if (!userId) return { markError: new Error('missing_user') };
  try {
    await deps.enableContributor(userId);
    return {};
  } catch (err) {
    return { markError: err instanceof Error ? err : new Error(String(err)) };
  }
}
