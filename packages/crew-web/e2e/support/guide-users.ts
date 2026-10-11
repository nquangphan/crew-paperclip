// Tài khoản T1 cho ảnh trang Hướng dẫn: một Admin/Operator và một Viewer (Phòng Marketing dùng tài khoản khách có sẵn).
// Dựng bằng đúng luồng owner dùng: lời mời có `humanRole`, người mới đăng ký và nhận lời mời, owner duyệt yêu cầu tham
// gia. Chạy lại thì chỉ sửa vai trò nếu lệch. Chỉ cho stack cục bộ (T1); mật khẩu tạm ở `board.env` (quyền 600).
import { request } from '@playwright/test';
import type { Api } from './api';
import { baseUrl, isProd } from './env';

export type GuideAccountRole = 'operator' | 'viewer';

export const GUIDE_ACCOUNTS: Record<GuideAccountRole, { email: string; name: string }> = {
  operator: { email: 'guide-operator@crew-e2e.local', name: 'Vận hành (ảnh hướng dẫn)' },
  viewer: { email: 'guide-viewer@crew-e2e.local', name: 'Chỉ xem (ảnh hướng dẫn)' },
};

/** Đọc ngay lúc dùng, không lưu vào biến module, không đưa vào chuỗi lỗi. */
export function guidePassword(): string {
  const v = process.env.CREW_GUIDE_PASSWORD;
  if (!v) throw new Error('Thiếu CREW_GUIDE_PASSWORD (thêm vào board.env của stack T1)');
  return v;
}

interface Member {
  id: string;
  membershipRole: string | null;
  status: string;
  user: { email: string | null } | null;
}

async function members(owner: Api, companyId: string): Promise<Member[]> {
  return (await owner.get<{ members: Member[] }>(`/api/companies/${companyId}/members`)).members;
}

/** Đăng nhập (hoặc đăng ký nếu chưa có) bằng một context riêng, trả context đó để nhận lời mời. */
async function userSession(account: { email: string; name: string }) {
  const url = baseUrl();
  const ctx = await request.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const signIn = await ctx.post('/api/auth/sign-in/email', {
    data: { email: account.email, password: guidePassword() },
  });
  if (signIn.ok()) return ctx;
  const signUp = await ctx.post('/api/auth/sign-up/email', {
    data: { email: account.email, password: guidePassword(), name: account.name },
  });
  if (!signUp.ok()) {
    await ctx.dispose();
    throw new Error(`Không đăng ký được ${account.email}: HTTP ${signUp.status()}`);
  }
  return ctx;
}

/** Bảo đảm tài khoản là thành viên `active` đúng vai trò của company. Chỉ chạy trên stack cục bộ. */
export async function ensureGuideAccount(owner: Api, companyId: string, role: GuideAccountRole): Promise<void> {
  if (isProd()) throw new Error('Tài khoản ảnh hướng dẫn chỉ dựng trên stack T1');
  const account = GUIDE_ACCOUNTS[role];
  const find = async () => (await members(owner, companyId)).find((m) => m.user?.email === account.email);
  let member = await find();
  if (!member) {
    const invite = await owner.post<{ token: string }>(`/api/companies/${companyId}/invites`, {
      allowedJoinTypes: 'human',
      humanRole: role,
    });
    const session = await userSession(account);
    try {
      const accepted = await session.post(`/api/invites/${encodeURIComponent(invite.token)}/accept`, {
        data: { requestType: 'human' },
      });
      if (!accepted.ok()) throw new Error(`Không nhận được lời mời cho ${account.email}: HTTP ${accepted.status()}`);
    } finally {
      await session.dispose();
    }
    const pending = await owner.get<{ id: string; status: string; requesterUser: { email: string | null } | null }[]>(
      `/api/companies/${companyId}/join-requests?status=pending_approval`,
    );
    const req = pending.find((r) => r.requesterUser?.email === account.email);
    if (req) await owner.post(`/api/companies/${companyId}/join-requests/${req.id}/approve`, {});
    member = await find();
  }
  if (!member) throw new Error(`Chưa thấy ${account.email} trong company sau khi duyệt`);
  if (member.membershipRole !== role || member.status !== 'active') {
    await owner.patch(`/api/companies/${companyId}/members/${member.id}`, { membershipRole: role, status: 'active' });
  }
}
