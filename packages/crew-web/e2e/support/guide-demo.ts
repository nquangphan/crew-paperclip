// Dữ liệu mẫu dễ đọc cho ảnh trang Hướng dẫn (chỉ stack T1): một yêu cầu đang chờ owner duyệt, một yêu cầu và một bình
// luận của Phòng Marketing đang chờ, một yêu cầu bị từ chối. Tìm theo tiêu đề trước khi tạo nên chạy lại không sinh
// bản trùng; dữ liệu được giữ lại để lần chụp sau dùng tiếp (không `trackIssue`).
import type { Api } from './api';
import { ensurePlaceholderAgent, type IssueLite, meId, TRACKING_PROJECT_NAME } from './data';
import { isProd } from './env';

export const DEMO = {
  issueTitle: 'Thêm nút xuất Excel ở trang báo cáo',
  issueBody:
    'Trang **Báo cáo doanh thu** cần nút **Xuất Excel**.\n\n- File có cột Ngày, Đơn hàng, Tổng tiền.\n- Không đổi cách tính tổng hiện có.',
  stageComment: 'Executor đã làm xong, Reviewer đã duyệt. Mời owner xem lại và duyệt.',
  requestTitle: 'Đổi ảnh banner trang chủ cho chiến dịch tháng 11',
  requestBody: 'Dùng bộ ảnh mới của chiến dịch tháng 11, giữ nguyên chữ trên banner.',
  commentBody: 'Nhờ thêm cột Tổng tiền đã giảm giá vào file Excel.',
  rejectedTitle: 'Viết lại toàn bộ trang chủ bằng tiếng Anh',
} as const;

export interface GuideDemo {
  issue: IssueLite;
}

interface Contribution {
  id: string;
  kind: 'issue' | 'comment';
  status: string;
  title: string | null;
  body: string | null;
  targetIssueId: string | null;
}

interface Project {
  id: string;
  name: string;
  archivedAt?: string | null;
}

async function projectNamed(api: Api, companyId: string, name: string): Promise<Project> {
  const all = await api.get<Project[]>(`/api/companies/${companyId}/projects`);
  const found = all.find((p) => p.name === name && !p.archivedAt);
  if (!found) throw new Error(`Stack T1 thiếu project "${name}"`);
  return found;
}

/** Yêu cầu mẫu ở stage "Owner duyệt" (cùng cách dựng với `createOwnerStageIssue`), dùng lại nếu còn đang chờ. */
async function ensureDemoIssue(api: Api, companyId: string): Promise<IssueLite> {
  const found = await api.get<IssueLite[]>(
    `/api/companies/${companyId}/issues?q=${encodeURIComponent(DEMO.issueTitle)}`,
  );
  const live = found.find((i) => i.title === DEMO.issueTitle && i.status === 'in_review');
  if (live) return live;
  const project = await projectNamed(api, companyId, TRACKING_PROJECT_NAME);
  const me = await meId(api);
  const worker = await ensurePlaceholderAgent(api, companyId, 'crew-e2e-worker', { wake: false });
  const issue = await api.post<IssueLite>(`/api/companies/${companyId}/issues`, {
    title: DEMO.issueTitle,
    description: DEMO.issueBody,
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
  const moved = await api.patch<IssueLite>(`/api/issues/${issue.id}`, { status: 'done', comment: DEMO.stageComment });
  if (moved.status !== 'in_review') throw new Error(`Yêu cầu mẫu không vào in_review: ${moved.status}`);
  return moved;
}

/** Dựng (hoặc tìm lại) dữ liệu mẫu. `owner`: phiên owner; `guest`: phiên Phòng Marketing. */
export async function ensureGuideDemo(owner: Api, guest: Api, companyId: string): Promise<GuideDemo> {
  if (isProd()) throw new Error('Dữ liệu mẫu của ảnh hướng dẫn chỉ dựng trên stack T1');
  const issue = await ensureDemoIssue(owner, companyId);
  const route = `/api/crew/companies/${companyId}/contributions`;
  // Mục mới nhất nằm ở trang đầu, nên đọc trang đầu của từng trạng thái là đủ.
  const page = async (status: string) =>
    (await guest.get<{ items: Contribution[] }>(`${route}?status=${status}`)).items;
  const mine = [...(await page('pending')), ...(await page('rejected'))];
  const has = (pred: (c: Contribution) => boolean) => mine.some(pred);
  const project = await projectNamed(owner, companyId, 'E2E T1 project');

  if (!has((c) => c.kind === 'issue' && c.title === DEMO.requestTitle && c.status === 'pending')) {
    await guest.post(route, {
      kind: 'issue',
      projectId: project.id,
      title: DEMO.requestTitle,
      description: DEMO.requestBody,
    });
  }
  if (!has((c) => c.kind === 'comment' && c.targetIssueId === issue.id && c.status === 'pending')) {
    await guest.post(route, { kind: 'comment', issueId: issue.id, body: DEMO.commentBody });
  }
  if (!has((c) => c.kind === 'issue' && c.title === DEMO.rejectedTitle && c.status === 'rejected')) {
    const made = await guest.post<Contribution>(route, {
      kind: 'issue',
      projectId: project.id,
      title: DEMO.rejectedTitle,
    });
    await owner.post(`${route}/${made.id}/reject`, {});
  }
  return { issue };
}
