// crew: tự dựng
import { ApiError, type CompanyInvite, type CompanyMember, type JoinRequest, type MemberUser } from '@/api';

function crewDefaults(invite: Pick<CompanyInvite, 'defaultsPayload'> | undefined): Record<string, unknown> | null {
  const crew = invite?.defaultsPayload?.crew;
  return typeof crew === 'object' && crew !== null && !Array.isArray(crew) ? (crew as Record<string, unknown>) : null;
}

/** Role lời mời mang dấu Phòng Marketing: `defaultsPayload.crew.role = 'contributor'`. */
export function isContributorInvite(invite: Pick<CompanyInvite, 'defaultsPayload'> | undefined): boolean {
  return crewDefaults(invite)?.role === 'contributor';
}

/** Project owner chọn sẵn lúc mời (`defaultsPayload.crew.projectIds`): chỉ nhận mảng, bỏ phần tử không phải chuỗi và bỏ trùng. */
export function inviteProjectIds(invite: Pick<CompanyInvite, 'defaultsPayload'> | undefined): string[] {
  const raw = crewDefaults(invite)?.projectIds;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

/** Link gửi cho khách: trang nhận lời mời nằm ở UI stock `/paperclip/`, không phải `/invite/` của UI Crew. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/paperclip/invite/${encodeURIComponent(token)}`;
}

/** Yêu cầu tham gia của người đang chờ duyệt, kèm cờ "lời mời khách góp ý" (nối bằng `inviteId`). */
export interface PendingJoin {
  request: JoinRequest;
  contributor: boolean;
  /** false: không tìm thấy lời mời của yêu cầu nên không biết có phải lời mời Phòng Marketing hay không. */
  inviteFound: boolean;
  /** Project chọn sẵn trên lời mời, cấp ngay sau khi duyệt; rỗng khi không chọn hoặc không tìm thấy lời mời. */
  projectIds: string[];
}

/** Chỉ lấy yêu cầu của người (không phải agent) đang chờ duyệt, nối với lời mời của nó. */
export function pendingJoins(requests: JoinRequest[], invites: CompanyInvite[]): PendingJoin[] {
  const byId = new Map(invites.map((i) => [i.id, i]));
  return requests
    .filter((r) => r.status === 'pending_approval' && r.requestType === 'human')
    .map((request) => {
      const invite = byId.get(request.inviteId);
      return {
        request,
        contributor: isContributorInvite(invite),
        inviteFound: invite !== undefined,
        projectIds: inviteProjectIds(invite),
      };
    });
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
  /** Thay cả danh sách project user được xem (chỉ gọi được sau khi user đã là thành viên). */
  setProjectAccess: (userId: string, projectIds: string[]) => Promise<unknown>;
}

export interface ApproveOutcome {
  /** Lỗi ở bước bật dấu (đã duyệt tham gia nhưng người đó mới chỉ là viewer thuần); undefined khi trọn vẹn. */
  markError?: Error;
  /** Lỗi ở bước cấp project chọn sẵn (đã duyệt nhưng người đó chưa xem được project nào); undefined khi trọn vẹn. */
  accessError?: Error;
}

const asError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

/**
 * Duyệt yêu cầu tham gia; nếu là lời mời khách góp ý thì bật dấu ngay sau đó, rồi cấp các project chọn sẵn trên lời
 * mời. Bước một lỗi thì ném lỗi (chưa có gì thay đổi). Các bước sau lỗi thì không ném: người đó đã là viewer thuần
 * (đóng khi lỗi), trả lỗi để UI báo và owner làm lại bằng nút "Đặt Phòng Marketing" hoặc cột "Project được xem".
 * Cấp project thay cả danh sách; người vừa vào chưa có quyền nào nên không mất gì.
 */
export async function approveJoin(join: PendingJoin, deps: ApproveDeps): Promise<ApproveOutcome> {
  await deps.approve(join.request.id);
  const userId = join.request.requestingUserId;
  const outcome: ApproveOutcome = {};
  if (join.contributor) {
    if (!userId) outcome.markError = new Error('missing_user');
    else
      await deps.enableContributor(userId).catch((err: unknown) => {
        outcome.markError = asError(err);
      });
  }
  if (join.projectIds.length > 0) {
    if (!userId) outcome.accessError = new Error('missing_user');
    else
      await deps.setProjectAccess(userId, join.projectIds).catch((err: unknown) => {
        outcome.accessError = asError(err);
      });
  }
  return outcome;
}

/** Mã lỗi của router Crew ở trang Thành viên có câu riêng (khóa `errors.<mã>` của namespace members). */
const MEMBER_ERROR_CODES = new Set([
  'crew_contributor_requires_viewer',
  'crew_contribution_forbidden',
  'crew_contributions_unavailable',
  'crew_contribution_store_failed',
  'crew_project_access_not_member',
  'crew_project_access_invalid',
  'crew_project_access_unavailable',
]);

/** Khóa i18n cho lỗi đặt/gỡ dấu Phòng Marketing, hoặc null khi nên hiện nguyên văn (lỗi mạng, route stock). */
export function memberErrorKey(error: unknown): string | null {
  return error instanceof ApiError && error.code && MEMBER_ERROR_CODES.has(error.code) ? `errors.${error.code}` : null;
}
