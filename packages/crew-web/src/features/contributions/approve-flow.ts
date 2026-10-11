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

/** Kết quả duyệt: mục đã `approved`; `alreadyPosted` khi bản ghi lõi đã có từ lần duyệt trước (Duyệt lại). */
export interface ApproveResult {
  contribution: Contribution;
  alreadyPosted: boolean;
}

/** Mã 409 mà server trả kèm mục đã `approved`: lần duyệt trước đã đăng xong, chỉ chưa kịp báo về trình duyệt. */
const ALREADY_APPROVED_CODES = new Set(['crew_contribution_decided', 'crew_contribution_already_approved']);

/**
 * Duyệt một mục góp ý. Yêu cầu (kind = issue) cần `choices`; bình luận thì bỏ qua. Lỗi kiểm lựa chọn (thiếu nhãn
 * research) ném trước khi khóa, để không để lại mục "Đang duyệt dở" vô cớ.
 */
export async function approveContribution(
  companyId: string,
  contribution: Contribution,
  choices: IssueApprovalChoices | null,
  deps: ApproveDeps = defaultApproveDeps,
): Promise<ApproveResult> {
  if (contribution.kind === 'issue') {
    if (!choices) throw new Error('approveContribution: thiếu lựa chọn duyệt cho yêu cầu');
    buildCreateBody({ ...choices, title: contribution.title ?? '', description: contribution.body ?? '' });
  }

  let approval: ContributionApproval;
  try {
    approval = await deps.approve(companyId, contribution.id);
  } catch (error) {
    // Duyệt lại sau khi bước đăng đã xong: server tìm thấy bản ghi, chuyển `approved` và trả 409 kèm mục. Đó là
    // thành công, không phải lỗi.
    const latest = contributionFromError(error);
    if (
      latest?.status === 'approved' &&
      error instanceof ApiError &&
      error.code &&
      ALREADY_APPROVED_CODES.has(error.code)
    ) {
      return { contribution: latest, alreadyPosted: true };
    }
    throw new ApproveError('lock', error);
  }
  const { materialize } = approval;

  await runStep('post', async () => {
    if (materialize.kind === 'issue') {
      if (!choices) throw new Error('approveContribution: thiếu lựa chọn duyệt cho yêu cầu');
      const body = buildCreateBody({
        ...choices,
        title: materialize.title,
        description: materialize.description ?? '',
        idempotencyKey: materialize.idempotencyKey,
        // Owner đã duyệt nội dung này: luôn tạo issue riêng, không gộp vào issue mở trùng tiêu đề.
        allowDuplicate: true,
      });
      await deps.createIssue(materialize.companyId, body);
    } else {
      await deps.addComment(materialize.issueId, materialize.body, materialize.clientRequestId);
    }
  });

  const done = await runStep('complete', () => deps.complete(companyId, contribution.id));
  return { contribution: done, alreadyPosted: false };
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
  'crew_contributions_unavailable',
  'crew_contribution_store_failed',
]);

/**
 * Khóa i18n (namespace contributions) cho lỗi của router góp ý (gửi, duyệt, từ chối), hoặc null khi nên hiện nguyên
 * văn câu server (lỗi của route stock ở bước đăng, lỗi mạng...). Câu server của router là tiếng Việt, nên mọi mã
 * đã biết đều đi qua i18n để UI tiếng Anh không hiện câu tiếng Việt.
 */
export function contributionErrorKey(error: unknown): string | null {
  const cause = error instanceof ApproveError ? error.cause : error;
  if (!(cause instanceof ApiError)) return null;
  // Mục đã chốt theo hướng từ chối: báo riêng, khác với "đã duyệt".
  if (cause.code === 'crew_contribution_decided' && contributionFromError(cause)?.status === 'rejected')
    return 'errors.alreadyRejected';
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
