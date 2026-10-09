// Dựng dữ liệu cho ca bằng API board: issue, bình luận của agent (để có mục chưa đọc), issue ở stage owner.
// Mọi thứ nằm trong company e2e; issue ca tạo ra phải `trackIssue` để cuối ca được hủy.
import { expect } from '@playwright/test';
import type { Api } from './api';
import { trackIssue } from './cleanup';

export interface IssueLite {
  id: string;
  identifier: string;
  title: string;
  status: string;
  projectId?: string | null;
  parentId?: string | null;
  isUnreadForMe?: boolean;
  executionState?: {
    status?: string | null;
    currentStageType?: string | null;
    currentParticipant?: { type?: string | null; userId?: string | null } | null;
  } | null;
}

interface AgentLite {
  id: string;
  name: string;
  status: string;
}

/** Id người dùng board đang đăng nhập. */
export async function meId(api: Api): Promise<string> {
  const session = await api.get<{ user: { id: string } }>('/api/auth/get-session');
  return session.user.id;
}

/** Tên duy nhất cho dữ liệu của ca (khóa tìm kiếm không đụng dữ liệu cũ). */
export function uniqueToken(prefix = 'e2e'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Agent giữ chỗ: adapter `process` lệnh `true`, heartbeat tắt. `wake` bật thì agent được đánh thức theo yêu cầu. */
export async function ensurePlaceholderAgent(
  api: Api,
  companyId: string,
  name: string,
  opts: { wake: boolean },
): Promise<AgentLite> {
  const agents = await api.get<AgentLite[]>(`/api/companies/${companyId}/agents`);
  const found = agents.find((a) => a.name === name && a.status !== 'terminated');
  if (found) return found;
  return api.post<AgentLite>(`/api/companies/${companyId}/agents`, {
    name,
    role: 'engineer',
    adapterType: 'process',
    adapterConfig: { command: 'true' },
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: opts.wake } },
  });
}

/** Tạo issue (board) và ghi để cuối ca hủy. */
export async function createIssue(
  api: Api,
  companyId: string,
  body: { title: string } & Record<string, unknown>,
): Promise<IssueLite> {
  const issue = await api.post<IssueLite>(`/api/companies/${companyId}/issues`, { status: 'todo', ...body });
  trackIssue(issue.id);
  return issue;
}

/**
 * Issue chưa đọc: có bình luận từ người khác sau lần board chạm cuối. Bình luận đó do job `attachments-audit` của
 * plugin đăng (không có tác giả) khi issue có file đính kèm agent không đọc được (.zip), chạy mỗi phút, nên mỗi
 * lần dựng mất tới khoảng 1 phút; dựng nhiều issue một lượt để chia chung một vòng chờ. Không dùng bình luận của
 * agent vì cần một run thật, mà run agent giữ chỗ làm hỏng worker plugin của stack cục bộ.
 */
export async function createUnreadIssues(api: Api, companyId: string, titles: string[]): Promise<IssueLite[]> {
  const issues: IssueLite[] = [];
  for (const title of titles) {
    const issue = await createIssue(api, companyId, { title });
    const res = await api.ctx.post(`/api/companies/${companyId}/issues/${issue.id}/attachments`, {
      multipart: { file: { name: 'goi-e2e.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0005\u0006') } },
    });
    if (res.status() >= 400) throw new Error(`Không đính kèm được file thử vào ${issue.identifier}: ${res.status()}`);
    issues.push(issue);
  }
  await expect
    .poll(
      async () => {
        const list = await inboxIssues(api, companyId);
        return issues.every((i) => list.find((x) => x.id === i.id)?.isUnreadForMe === true);
      },
      { timeout: 150_000, intervals: [3_000], message: 'job attachments-audit chưa đăng bình luận cảnh báo' },
    )
    .toBe(true);
  return issues;
}

export async function createUnreadIssue(api: Api, companyId: string, title: string): Promise<IssueLite> {
  return (await createUnreadIssues(api, companyId, [title]))[0];
}

/** Project theo dõi của stack T1 (nằm trong `trackingProjectIds` của CREW_POLICY_CONFIG): issue gốc ở đó không nhận gate Crew. */
export const TRACKING_PROJECT_NAME = 'E2E T1 theo dõi';

export async function trackingProject(api: Api, companyId: string): Promise<{ id: string; name: string } | null> {
  const projects = await api.get<{ id: string; name: string; archivedAt?: string | null }[]>(
    `/api/companies/${companyId}/projects`,
  );
  return projects.find((p) => p.name === TRACKING_PROJECT_NAME && !p.archivedAt) ?? null;
}

/**
 * Issue đang chờ board duyệt ở stage approval (owner = board hiện tại). Dựng bằng chính cơ chế policy của Paperclip:
 * issue có `executionPolicy` chỉ một stage approval, giao cho agent giữ chỗ, board đưa sang done thì issue vào
 * `in_review` chờ board. Chỉ làm được trong project theo dõi (không dính gate Crew), nên trả null khi company
 * không có project đó.
 */
export async function createOwnerStageIssue(api: Api, companyId: string, title: string): Promise<IssueLite | null> {
  const project = await trackingProject(api, companyId);
  if (!project) return null;
  const me = await meId(api);
  const worker = await ensurePlaceholderAgent(api, companyId, 'crew-e2e-worker', { wake: false });
  const issue = await createIssue(api, companyId, {
    title,
    projectId: project.id,
    assigneeAgentId: worker.id,
    status: 'todo',
    executionPolicy: {
      mode: 'normal',
      commentRequired: true,
      maxReviewRounds: 5,
      stages: [{ type: 'approval', approvalsNeeded: 1, participants: [{ type: 'user', userId: me }] }],
    },
  });
  await api.patch(`/api/issues/${issue.id}`, { status: 'in_progress' });
  const moved = await api.patch<IssueLite>(`/api/issues/${issue.id}`, {
    status: 'done',
    comment: 'Dựng sẵn cho ca e2e.',
  });
  if (moved.status !== 'in_review') throw new Error(`Issue ${issue.identifier} không vào in_review: ${moved.status}`);
  return moved;
}

/** Issue còn mở của board ở stage approval — cùng điều kiện nút Duyệt và thẻ "Chờ bạn duyệt". */
export function isAwaitingMyApproval(issue: IssueLite, meUserId: string): boolean {
  const s = issue.executionState;
  return (
    issue.status === 'in_review' &&
    s?.status === 'pending' &&
    s.currentStageType === 'approval' &&
    s.currentParticipant?.type === 'user' &&
    s.currentParticipant.userId === meUserId
  );
}

/** Danh sách Hộp thư của board như UI gọi: chưa lưu trữ, gắn `isUnreadForMe`. */
export function inboxIssues(api: Api, companyId: string): Promise<IssueLite[]> {
  return api.get<IssueLite[]>(`/api/companies/${companyId}/issues?inboxArchivedByUserId=me&limit=200`);
}

/** Project thử của ca (không có vai trò Crew nên không "sẵn sàng"). Gọi `archiveProject` ở cuối ca. */
export async function createProject(api: Api, companyId: string, name: string): Promise<{ id: string; name: string }> {
  return api.post<{ id: string; name: string }>(`/api/companies/${companyId}/projects`, { name });
}

export async function archiveProject(api: Api, projectId: string): Promise<void> {
  await api.patch(`/api/projects/${projectId}`, { archivedAt: new Date().toISOString() });
}

/** Id nhãn `research` của company; null khi chưa có. */
export async function researchLabelId(api: Api, companyId: string): Promise<string | null> {
  const labels = await api.get<{ id: string; name: string }[]>(`/api/companies/${companyId}/labels`);
  return labels.find((l) => l.name === 'research')?.id ?? null;
}

/**
 * Issue đang chờ board duyệt theo API. Danh sách issue của server luôn trả `executionState: null`
 * (server/src/services/issues.ts), nên phải đọc từng issue `in_review` để biết stage và người tham gia.
 */
export async function awaitingApprovalIssues(api: Api, companyId: string): Promise<IssueLite[]> {
  const me = await meId(api);
  const reviewing = (await inboxIssues(api, companyId)).filter((i) => i.status === 'in_review');
  const full = await Promise.all(reviewing.map((i) => api.get<IssueLite>(`/api/issues/${i.id}`)));
  return full.filter((i) => isAwaitingMyApproval(i, me));
}

/**
 * Danh sách dạng compact (trang Yêu cầu) được server cache ngắn (2 giây tươi, tới 5 giây cũ), nên issue vừa ghi có thể
 * chưa có mặt. Chờ tới khi các issue đã có trong danh sách rồi mới mở trang.
 */
export async function waitInCompactList(api: Api, companyId: string, ids: string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const list = await api.get<{ id: string }[]>(`/api/companies/${companyId}/issues?view=compact&limit=1000`);
        const have = new Set(list.map((i) => i.id));
        return ids.every((id) => have.has(id));
      },
      { timeout: 15_000, intervals: [1_000], message: 'danh sách compact chưa có issue vừa tạo' },
    )
    .toBe(true);
}
