// Thành viên của company mẫu cho ảnh trang Hướng dẫn (chỉ stack T1): Admin/Vận hành, Chỉ xem và Phòng Marketing. Dựng
// bằng đúng luồng owner dùng: lời mời có `humanRole` (Phòng Marketing là viewer có `defaultsPayload.crew.role`), người
// được mời đăng ký hoặc đăng nhập rồi nhận lời mời, owner duyệt yêu cầu tham gia, rồi bật dấu Phòng Marketing. Chạy lại
// thì chỉ sửa vai trò nếu lệch. Mật khẩu tạm của hai tài khoản ảnh ở `board.env` (quyền 600).
import { request } from '@playwright/test';
import { Api } from './api';
import { baseUrl, contributorEmail, contributorPassword, isProd } from './env';
import { grantMemberProjects } from './project-access';

export type GuideAccountRole = 'operator' | 'viewer' | 'contributor';

/**
 * Tài khoản theo vai trò của company mẫu (chỉ T1). Owner là tài khoản board đã tạo company; Phòng Marketing là tài khoản
 * khách góp ý có sẵn của T1 (`CREW_E2E_CONTRIBUTOR_*`), hai tài khoản còn lại dùng mật khẩu `CREW_GUIDE_PASSWORD`.
 */
export const GUIDE_ACCOUNTS: Record<GuideAccountRole, { email: () => string; name: string; password: () => string }> = {
  operator: { email: () => 'guide-operator@crew-e2e.local', name: 'Trần Minh', password: () => guidePassword() },
  viewer: { email: () => 'guide-viewer@crew-e2e.local', name: 'Lê Lan', password: () => guidePassword() },
  contributor: { email: () => contributorEmail(), name: 'Phòng Marketing', password: () => contributorPassword() },
};
/** Tên hiển thị của owner trên ảnh (đặt lại cho tài khoản board của T1). */
export const GUIDE_OWNER_NAME = 'Nguyễn Quang';

/** Đọc ngay lúc dùng, không lưu vào biến module, không đưa vào chuỗi lỗi. */
export function guidePassword(): string {
  const v = process.env.CREW_GUIDE_PASSWORD;
  if (!v) throw new Error('Thiếu CREW_GUIDE_PASSWORD (thêm vào board.env của stack T1)');
  return v;
}

interface Member {
  id: string;
  principalId: string;
  membershipRole: string | null;
  status: string;
  user: { email: string | null } | null;
}

type Account = (typeof GUIDE_ACCOUNTS)[GuideAccountRole];

async function members(owner: Api, companyId: string): Promise<Member[]> {
  return (await owner.get<{ members: Member[] }>(`/api/companies/${companyId}/members`)).members;
}

/** Đăng nhập (hoặc đăng ký nếu chưa có) bằng một context riêng, trả context đó để nhận lời mời. */
async function userSession(account: Account) {
  const url = baseUrl();
  const ctx = await request.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  // Better Auth giới hạn khoảng 4 lần đăng nhập mỗi phút: gặp 429 thì đợi hết cửa sổ rồi thử lại.
  let signIn = await ctx.post('/api/auth/sign-in/email', {
    data: { email: account.email(), password: account.password() },
  });
  for (let attempt = 0; signIn.status() === 429 && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    signIn = await ctx.post('/api/auth/sign-in/email', {
      data: { email: account.email(), password: account.password() },
    });
  }
  if (signIn.ok()) return ctx;
  const signUp = await ctx.post('/api/auth/sign-up/email', {
    data: { email: account.email(), password: account.password(), name: account.name },
  });
  if (!signUp.ok()) {
    await ctx.dispose();
    throw new Error(`Không đăng nhập hay đăng ký được ${account.email()}: HTTP ${signUp.status()}`);
  }
  return ctx;
}

/** Bảo đảm tài khoản là thành viên `active` đúng vai trò; `contributor` là viewer có dấu Phòng Marketing. */
async function ensureMember(owner: Api, companyId: string, account: Account, role: GuideAccountRole): Promise<void> {
  if (isProd()) throw new Error('Thành viên của company mẫu chỉ dựng trên stack T1');
  const coreRole = role === 'contributor' ? 'viewer' : role;
  const find = async () => (await members(owner, companyId)).find((m) => m.user?.email === account.email());
  let member = await find();
  if (!member) {
    const invite = await owner.post<{ id: string; token: string }>(`/api/companies/${companyId}/invites`, {
      allowedJoinTypes: 'human',
      humanRole: coreRole,
      ...(role === 'contributor' ? { defaultsPayload: { crew: { role: 'contributor' } } } : {}),
    });
    try {
      const session = await userSession(account);
      try {
        const accepted = await session.post(`/api/invites/${encodeURIComponent(invite.token)}/accept`, {
          data: { requestType: 'human' },
        });
        if (!accepted.ok())
          throw new Error(`Không nhận được lời mời cho ${account.email()}: HTTP ${accepted.status()}`);
      } finally {
        await session.dispose();
      }
    } catch (error) {
      // Lời mời không dùng được thì thu hồi, để trang Thành viên không còn lời mời treo.
      await owner.post(`/api/invites/${invite.id}/revoke`, {}).catch(() => undefined);
      throw error;
    }
    const pending = await owner.get<{ id: string; requesterUser: { email: string | null } | null }[]>(
      `/api/companies/${companyId}/join-requests?status=pending_approval`,
    );
    const req = pending.find((r) => r.requesterUser?.email === account.email());
    if (req) await owner.post(`/api/companies/${companyId}/join-requests/${req.id}/approve`, {});
    member = await find();
  }
  if (!member) throw new Error(`Chưa thấy ${account.email()} trong company sau khi duyệt`);
  if (member.membershipRole !== coreRole || member.status !== 'active') {
    await owner.patch(`/api/companies/${companyId}/members/${member.id}`, {
      membershipRole: coreRole,
      status: 'active',
    });
  }
  if (role === 'contributor') {
    await owner.put(`/api/crew/companies/${companyId}/contributors/${member.principalId}`, {});
  }
  // Thành viên không phải owner chỉ thấy project được cấp: ảnh hướng dẫn cần cả hai project mẫu.
  const projects = await owner.get<{ id: string; archivedAt?: string | null }[]>(
    `/api/companies/${companyId}/projects`,
  );
  await grantMemberProjects(
    owner,
    companyId,
    member.principalId,
    projects.filter((p) => !p.archivedAt).map((p) => p.id),
  );
}

/** Ba tài khoản theo vai trò của company mẫu; owner là tài khoản board đã tạo company. */
export async function ensureGuideMembers(owner: Api, companyId: string): Promise<void> {
  for (const role of ['operator', 'viewer', 'contributor'] as const) {
    await ensureMember(owner, companyId, GUIDE_ACCOUNTS[role], role);
  }
}

/** REST bằng phiên của một tài khoản ảnh (đăng nhập qua API, không qua form). */
export async function guideAccountApi(role: GuideAccountRole): Promise<Api> {
  return new Api(await userSession(GUIDE_ACCOUNTS[role]));
}
