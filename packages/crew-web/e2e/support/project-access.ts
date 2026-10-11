// Quyền xem project theo thành viên (router Crew `…/project-access`). Owner thấy mọi project; thành viên khác chỉ thấy
// project owner đã cấp. Ca e2e cấp thêm project cần dùng, không gỡ quyền có sẵn.
import type { Api } from './api';

interface MemberAccess {
  userId: string;
  all: boolean;
  projectIds: string[];
}

const route = (companyId: string, suffix = '') => `/api/crew/companies/${companyId}/project-access${suffix}`;

/** Project thành viên đang được xem (owner: `all`). */
export async function memberProjects(owner: Api, companyId: string, userId: string): Promise<MemberAccess | null> {
  const { items } = await owner.get<{ items: MemberAccess[] }>(route(companyId));
  return items.find((item) => item.userId === userId) ?? null;
}

/** Thay toàn bộ danh sách project thành viên được xem. */
export async function setMemberProjects(owner: Api, companyId: string, userId: string, projectIds: string[]) {
  await owner.put(route(companyId, `/${encodeURIComponent(userId)}`), { projectIds });
}

/** Cấp thêm project (giữ project đã cấp); owner thì bỏ qua vì đã thấy tất cả. */
export async function grantMemberProjects(owner: Api, companyId: string, userId: string, projectIds: string[]) {
  const current = await memberProjects(owner, companyId, userId);
  if (!current || current.all) return;
  const next = [...new Set([...current.projectIds, ...projectIds])];
  if (next.length !== current.projectIds.length) await setMemberProjects(owner, companyId, userId, next);
}
