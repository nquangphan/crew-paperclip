// Điều phối duyệt góp ý ở trình duyệt owner, ba bước:
//   1. `approve`: server khóa mục (pending → approving) và trả nội dung cần đăng kèm khóa idempotent;
//   2. đăng qua route stock của board (issue: `idempotencyKey`; bình luận: `clientRequestId`), nên wake và policy
//      chạy y như board tự đăng;
//   3. `complete`: server tự tìm bản ghi đã đăng ở bảng lõi rồi chuyển `approved`.
// Bước 2 lỗi thì không gọi bước 3: mục giữ `approving` ("Đang duyệt dở"), owner bấm Duyệt lại thì server trả cùng khóa,
// route stock trả lại bản ghi cũ thay vì tạo bản trùng.
import { ApiError, api, type Contribution, type ContributionApproval } from '@/api';
import type { RequestKind } from '@/features/issues/new/kinds';
import { buildCreateBody } from '@/features/issues/new/use-create-request';

/** Lựa chọn của owner trong dialog duyệt yêu cầu. */
export interface IssueApprovalChoices {
  projectId: string;
  assigneeAgentId: string;
  kind: RequestKind;
  researchLabelId: string | null;
  /** true: lưu nháp (backlog, chưa đánh thức agent). */
  draft: boolean;
}

export interface ApproveDeps {
  approve: (companyId: string, id: string) => Promise<ContributionApproval>;
  createIssue: (companyId: string, body: Record<string, unknown>) => Promise<unknown>;
  addComment: (issueId: string, body: string, clientRequestId: string) => Promise<unknown>;
  complete: (companyId: string, id: string) => Promise<Contribution>;
}

export const defaultApproveDeps: ApproveDeps = {
  approve: (companyId, id) => api.contributions.approve(companyId, id),
  createIssue: (companyId, body) => api.issues.create(companyId, body),
  // Cờ giống composer của owner: chỉ nội dung, không reopen/resume/interrupt, không đính kèm.
  addComment: (issueId, body, clientRequestId) => api.comments.add(issueId, body, undefined, clientRequestId),
  complete: (companyId, id) => api.contributions.complete(companyId, id),
};

export type ApproveStep = 'lock' | 'post' | 'complete';

/** Lỗi ở một bước duyệt; `cause` là lỗi gốc (thường là ApiError) để UI chọn câu báo. */
export class ApproveError extends Error {
  readonly step: ApproveStep;
  override readonly cause: unknown;

  constructor(step: ApproveStep, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ApproveError';
    this.step = step;
    this.cause = cause;
  }
}

async function runStep<T>(step: ApproveStep, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new ApproveError(step, error);
  }
}

/**
 * Duyệt một mục góp ý. Yêu cầu (kind = issue) cần `choices`; bình luận thì bỏ qua. Lỗi kiểm lựa chọn (thiếu nhãn
 * research) ném trước khi khóa, để không để lại mục "Đang duyệt dở" vô cớ.
 */
export async function approveContribution(
  companyId: string,
  contribution: Contribution,
  choices: IssueApprovalChoices | null,
  deps: ApproveDeps = defaultApproveDeps,
): Promise<Contribution> {
  if (contribution.kind === 'issue') {
    if (!choices) throw new Error('approveContribution: thiếu lựa chọn duyệt cho yêu cầu');
    buildCreateBody({ ...choices, title: contribution.title ?? '', description: contribution.body ?? '' });
  }

  const { materialize } = await runStep('lock', () => deps.approve(companyId, contribution.id));

  await runStep('post', async () => {
    if (materialize.kind === 'issue') {
      if (!choices) throw new Error('approveContribution: thiếu lựa chọn duyệt cho yêu cầu');
      const body = buildCreateBody({
        ...choices,
        title: materialize.title,
        description: materialize.description ?? '',
        idempotencyKey: materialize.idempotencyKey,
      });
      await deps.createIssue(materialize.companyId, body);
    } else {
      await deps.addComment(materialize.issueId, materialize.body, materialize.clientRequestId);
    }
  });

  return runStep('complete', () => deps.complete(companyId, contribution.id));
}

/** Mã lỗi của router góp ý có câu báo riêng (khóa i18n `errors.<mã>` của namespace contributions). */
const KNOWN_CODES = new Set([
  'crew_contribution_not_materialized',
  'crew_contribution_decided',
  'crew_contribution_locked',
  'crew_contribution_not_approving',
  'crew_contribution_already_approved',
  'crew_contribution_invalid',
  'crew_contribution_invalid_target',
  'crew_contribution_forbidden',
]);

/**
 * Khóa i18n (namespace contributions) cho lỗi duyệt/từ chối, hoặc null khi nên hiện nguyên văn câu server
 * (lỗi của route stock ở bước đăng, lỗi mạng...).
 */
export function contributionErrorKey(error: unknown): string | null {
  const cause = error instanceof ApproveError ? error.cause : error;
  if (!(cause instanceof ApiError)) return null;
  if (cause.code && KNOWN_CODES.has(cause.code)) return `errors.${cause.code}`;
  // Bước đăng đi qua route stock: 404 ở đó là issue đích, không phải mục góp ý.
  const fromRouter = !(error instanceof ApproveError) || error.step !== 'post';
  if (fromRouter && cause.status === 404) return 'errors.notFound';
  return null;
}

/** Mục góp ý mới nhất server gửi kèm lỗi 409 (`{ error, code, contribution }`), để UI làm tươi tại chỗ. */
export function contributionFromError(error: unknown): Contribution | null {
  const cause = error instanceof ApproveError ? error.cause : error;
  if (!(cause instanceof ApiError) || cause.status !== 409) return null;
  const body = cause.body;
  if (!body || typeof body !== 'object') return null;
  const c = (body as { contribution?: unknown }).contribution;
  if (!c || typeof c !== 'object') return null;
  const candidate = c as Partial<Contribution>;
  return typeof candidate.id === 'string' && typeof candidate.status === 'string' ? (c as Contribution) : null;
}
