// Thêm việc con vào một yêu cầu gốc Crew từ web (owner hoặc thành viên ghi được).
//
// Web chỉ tạo việc con chưa giao ai (server gắn policy việc con: bước Reviewer) rồi bình luận trên yêu cầu gốc. Bình
// luận là đường đánh thức có sẵn của lõi (`issue_commented`): Trợ Lý (người giữ yêu cầu gốc) chạy, ghi một revision kế
// hoạch cho việc con đó rồi tự gắn marker, chọn executor và model ngay trên chính việc con. Owner không chọn gì.
//
// Chỉ mở khi yêu cầu gốc đang ở bước Trợ Lý (Cần làm, Đang làm, Bị chặn). Qua bước đó (Reviewer, Integrator, Owner
// duyệt) thì đường quay về Trợ Lý duy nhất là quyết định Yêu cầu sửa của người đang duyệt; chèn việc con giữa chừng thì
// bằng chứng merge/docs của Integrator đã cũ mà không ai đưa yêu cầu về lại Trợ Lý.
import type { Issue } from '@paperclipai/shared';

/** Trạng thái yêu cầu gốc mà Trợ Lý đang giữ việc. */
const ASSISTANT_STATUSES: ReadonlySet<string> = new Set(['todo', 'in_progress', 'blocked']);
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['done', 'cancelled']);
const DRAFT_STATUS = 'backlog';

/** Lý do chưa thêm được: `draft` yêu cầu còn là nháp; `review` yêu cầu đã qua bước Trợ Lý. */
export type AddChildBlock = 'draft' | 'review';

export type AddChildAvailability = { kind: 'hidden' } | { kind: 'blocked'; reason: AddChildBlock } | { kind: 'open' };

/** Phần yêu cầu gốc cần để quyết định và dựng body. */
export interface AddChildRoot {
  id: string;
  status: string;
  parentId?: string | null;
  projectId?: string | null;
  executionState?: { status?: string | null } | null;
}

/**
 * Nút chỉ có trên yêu cầu gốc Crew chưa xong và chưa hủy (`crewRoot` theo bản đồ Crew của plugin). Mở khi Trợ Lý đang
 * giữ việc và không có stage nào đang chờ; nháp và yêu cầu đã qua bước Trợ Lý thì nút vẫn hiện, dialog giải thích vì sao.
 */
export function addChildAvailability(root: AddChildRoot, crewRoot: boolean): AddChildAvailability {
  if (!crewRoot || root.parentId || CLOSED_STATUSES.has(root.status)) return { kind: 'hidden' };
  if (root.status === DRAFT_STATUS) return { kind: 'blocked', reason: 'draft' };
  if (ASSISTANT_STATUSES.has(root.status) && root.executionState?.status !== 'pending') return { kind: 'open' };
  return { kind: 'blocked', reason: 'review' };
}

export interface ChildBodyInput {
  root: Pick<AddChildRoot, 'id' | 'projectId'>;
  title: string;
  description: string;
  /** Khóa idempotent của route stock: gửi lại cùng khóa thì server trả việc con cũ, không tạo bản trùng. */
  idempotencyKey: string;
}

/**
 * Body tạo việc con: không assignee, không policy, không nhãn, không marker. Trợ Lý giao executor và ghi marker; server
 * gắn policy việc con. `allowDuplicate`: lõi mặc định trả lại issue mở cùng tiêu đề trong 48 giờ (có thể là issue khác
 * hẳn, không thuộc yêu cầu này); khóa idempotent vẫn chặn bản trùng khi gửi lại.
 */
export function buildChildBody(input: ChildBodyInput): Record<string, unknown> {
  const title = input.title.trim();
  if (!title) throw new Error('buildChildBody: title is empty');
  // Mô tả chỉ trim để kiểm rỗng; gửi nguyên văn để markdown mở đầu bằng khối thụt lề không hỏng.
  const description = input.description.trim() ? input.description : null;
  return {
    title,
    ...(description !== null ? { description } : {}),
    parentId: input.root.id,
    ...(input.root.projectId ? { projectId: input.root.projectId } : {}),
    status: 'todo',
    idempotencyKey: input.idempotencyKey,
    allowDuplicate: true,
  };
}

/** Yêu cầu gốc đã đổi trước khi gửi: không tạo gì. `closed` là gốc đã xong, đã hủy hoặc không còn là gốc Crew. */
export class AddChildStaleError extends Error {
  constructor(
    readonly reason: AddChildBlock | 'closed',
    readonly status: string,
  ) {
    super(`add_child_stale:${reason}:${status}`);
  }
}

/**
 * Tiến độ một lần thêm. Giữ qua các lần bấm của cùng một dialog: lỗi ở bước sau (upload, bình luận) thì lần bấm lại
 * chỉ làm bước còn thiếu, không tạo việc con thứ hai hay upload lại file đã lên.
 */
export interface AddChildProgress {
  child: Issue | null;
  failedUploads: string[] | null;
  notified: boolean;
}

export const newAddChildProgress = (): AddChildProgress => ({ child: null, failedUploads: null, notified: false });

export interface AddChildDeps {
  /** Đọc lại yêu cầu gốc ngay trước khi tạo. */
  getRoot: () => Promise<AddChildRoot>;
  create: (body: Record<string, unknown>) => Promise<Issue>;
  /** Trả tên các file upload lỗi; không ném. */
  upload: (issueId: string, files: readonly File[]) => Promise<string[]>;
  /** Bình luận trên yêu cầu gốc, `clientRequestId` làm lần gửi lại không tạo bình luận trùng. */
  comment: (body: string, clientRequestId: string) => Promise<unknown>;
}

export interface AddChildInput {
  title: string;
  description: string;
  files: readonly File[];
  idempotencyKey: string;
  commentRequestId: string;
  /** Nội dung bình luận báo Trợ Lý, dựng khi đã biết mã việc con. */
  commentBody: (child: Issue) => string;
}

export interface AddChildResult {
  child: Issue;
  failedUploads: string[];
}

/** Tạo việc con, upload đính kèm, rồi bình luận trên yêu cầu gốc để đánh thức Trợ Lý; bước nào xong thì không làm lại. */
export async function runAddChild(
  deps: AddChildDeps,
  input: AddChildInput,
  progress: AddChildProgress,
): Promise<AddChildResult> {
  if (!progress.child) {
    const fresh = await deps.getRoot();
    // Đã biết đây là gốc Crew; chỉ xét trạng thái mới nhất.
    const availability = addChildAvailability(fresh, true);
    if (availability.kind !== 'open') {
      throw new AddChildStaleError(availability.kind === 'blocked' ? availability.reason : 'closed', fresh.status);
    }
    progress.child = await deps.create(
      buildChildBody({
        root: fresh,
        title: input.title,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
      }),
    );
  }
  const child = progress.child;
  if (progress.failedUploads === null) progress.failedUploads = await deps.upload(child.id, input.files);
  if (!progress.notified) {
    await deps.comment(input.commentBody(child), input.commentRequestId);
    progress.notified = true;
  }
  return { child, failedUploads: progress.failedUploads };
}
