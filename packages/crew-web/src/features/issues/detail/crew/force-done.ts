// Ép Done của owner: đóng yêu cầu bỏ qua cổng, có lý do. Không dùng PATCH stock (board gửi `done` thành Duyệt khi là
// người duyệt stage đang chờ, hoặc mở workflow khi chưa vào stage), mà gọi route board của plugin crew.core. Trước
// route, web hủy run đang chạy của chính yêu cầu (`done` không tự hủy run). Việc con owner chọn hủy chỉ bị hủy SAU khi
// yêu cầu đã đóng: hủy con cuối cùng khi cha còn mở thì route stock đánh thức assignee của cha
// (`issue_children_completed`), tức đánh thức đúng người đang giữ yêu cầu sắp bị ép.
import type { ForceDoneResult } from '@/api';

export const MIN_FORCE_REASON = 10;
export const MAX_FORCE_REASON = 1000;

const CLOSED = new Set(['done', 'cancelled']);
const ACTIVE_RUN = new Set(['running', 'queued']);
// Ký tự điều khiển C0/C1 trừ tab và xuống dòng: route từ chối (reason_invalid).
// biome-ignore lint/suspicious/noControlCharactersInRegex: đúng là cần bắt ký tự điều khiển
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

interface Principal {
  type?: string | null;
  agentId?: string | null;
  userId?: string | null;
}

interface ForceDoneIssue {
  status: string;
  executionPolicy?: { stages: { id: string; type: string }[] } | null;
  executionState?: {
    status?: string | null;
    currentStageId?: string | null;
    currentParticipant?: Principal | null;
    completedStageIds?: string[] | null;
  } | null;
}

export interface SkippedGate {
  stageId: string;
  type: string;
  /** Vị trí trong policy (0 là stage đầu). */
  index: number;
  /** Stage đang chờ người duyệt. */
  current: boolean;
  /** Người đang giữ stage đang chờ. */
  holder: { type: 'agent'; agentId: string } | { type: 'user'; userId: string } | null;
}

/** Nút Ép Done chỉ có khi yêu cầu chưa đóng; đã đóng thì phải Mở lại trước. */
export function forceDoneAvailable(issue: { status: string }): boolean {
  return !CLOSED.has(issue.status);
}

/** Stage theo policy chưa có trong `completedStageIds` của vòng hiện tại: các cổng mà Ép Done sẽ bỏ qua. */
export function skippedGates(issue: ForceDoneIssue): SkippedGate[] {
  const state = issue.executionState ?? null;
  const done = new Set(state?.completedStageIds ?? []);
  const pendingId = state?.status === 'pending' ? (state.currentStageId ?? null) : null;
  return (issue.executionPolicy?.stages ?? []).flatMap((stage, index) => {
    if (done.has(stage.id)) return [];
    const current = stage.id === pendingId;
    const p = current ? state?.currentParticipant : null;
    const holder =
      p?.type === 'agent' && p.agentId
        ? { type: 'agent' as const, agentId: p.agentId }
        : p?.type === 'user' && p.userId
          ? { type: 'user' as const, userId: p.userId }
          : null;
    return [{ stageId: stage.id, type: stage.type, index, current, holder }];
  });
}

/** Lý do sau khi bỏ khoảng trắng hai đầu: 10–1000 ký tự, không có ký tự điều khiển (như route kiểm). */
export function validReason(reason: string): boolean {
  const text = reason.trim();
  return text.length >= MIN_FORCE_REASON && text.length <= MAX_FORCE_REASON && !CONTROL.test(text);
}

/** Việc con chưa xong (chưa done/cancelled). */
export function openChildren<T extends { status: string }>(children: T[]): T[] {
  return children.filter((c) => !CLOSED.has(c.status));
}

export interface ForceDoneDeps {
  /** Đọc lại yêu cầu ngay trước khi làm (không dùng bản đang hiện trên trang). */
  getIssue: () => Promise<{ status: string }>;
  /** Danh sách con mới nhất. */
  listChildren: () => Promise<{ id: string; status: string }[]>;
  /** PATCH stock `{status:'cancelled'}` (board hủy thì run của con dừng theo). */
  cancelChild: (childId: string) => Promise<unknown>;
  /** Run của chính yêu cầu (live-runs). */
  listActiveRuns: () => Promise<{ id: string; status: string }[]>;
  cancelRun: (runId: string) => Promise<unknown>;
  /** Route Ép Done của plugin. */
  forceDone: (reason: string) => Promise<ForceDoneResult>;
}

export interface ChildFailure {
  id: string;
  message: string;
}

export type ForceDoneOutcome =
  | { kind: 'stale'; status: string }
  | { kind: 'done'; result: ForceDoneResult; childFailures: ChildFailure[] };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Hủy các con owner đã thấy trong dialog (`ids`) mà còn mở theo danh sách đọc lại; con không có trong `ids` (vd. tạo sau
 * khi trang tải) thì để nguyên. Không ném: con nào lỗi thì trả lại kèm lỗi để owner bấm hủy lại.
 */
export async function cancelShownChildren(
  deps: Pick<ForceDoneDeps, 'listChildren' | 'cancelChild'>,
  ids: readonly string[],
): Promise<ChildFailure[]> {
  if (ids.length === 0) return [];
  const shown = new Set(ids);
  let open: { id: string }[];
  try {
    open = openChildren(await deps.listChildren()).filter((c) => shown.has(c.id));
  } catch (error) {
    return ids.map((id) => ({ id, message: messageOf(error) }));
  }
  const failures: ChildFailure[] = [];
  for (const child of open) {
    try {
      await deps.cancelChild(child.id);
    } catch (error) {
      failures.push({ id: child.id, message: messageOf(error) });
    }
  }
  return failures;
}

/**
 * Chạy Ép Done theo thứ tự: đọc lại yêu cầu → hủy run đang chạy → route → hủy các con đã chọn. Lỗi trước khi route
 * xong thì dừng (ném lại nguyên lỗi), bấm lại chạy lại từ đầu an toàn. Lỗi khi hủy con (yêu cầu đã đóng) không ném mà
 * trả trong `childFailures`. Yêu cầu đã đóng khi đọc lại thì không làm gì (`stale`).
 */
export async function runForceDone(
  deps: ForceDoneDeps,
  input: { reason: string; childIds: readonly string[] },
): Promise<ForceDoneOutcome> {
  if (!validReason(input.reason)) throw new Error('reason_invalid');
  const reason = input.reason.trim();
  const fresh = await deps.getIssue();
  if (CLOSED.has(fresh.status)) return { kind: 'stale', status: fresh.status };
  for (const run of await deps.listActiveRuns()) {
    if (ACTIVE_RUN.has(run.status)) await deps.cancelRun(run.id);
  }
  const result = await deps.forceDone(reason);
  return { kind: 'done', result, childFailures: await cancelShownChildren(deps, input.childIds) };
}
